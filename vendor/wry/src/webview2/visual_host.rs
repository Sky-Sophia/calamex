// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

#![cfg(all(windows, feature = "visual-hosting"))]

use std::{cell::Cell, rc::Rc, sync::mpsc};

use webview2_com::{Microsoft::Web::WebView2::Win32::*, *};
use windows::{
  core::Interface,
  Win32::{
    Foundation::*,
    Graphics::{
      Direct3D::D3D_DRIVER_TYPE_HARDWARE,
      Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11RenderTargetView,
        ID3D11Resource, ID3D11Texture2D, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
      },
      DirectComposition::{
        DCompositionCreateDevice, IDCompositionDevice, IDCompositionRectangleClip,
        IDCompositionTarget, IDCompositionVirtualSurface, IDCompositionVisual,
      },
      Dxgi::{
        Common::{DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM},
        IDXGIDevice,
      },
      Gdi::ScreenToClient,
    },
    UI::{
      Accessibility::IRawElementProviderSimple,
      Input::Pointer::{
        GetPointerInfo, GetPointerPenInfo, GetPointerTouchInfo, POINTER_INFO, POINTER_PEN_INFO,
        POINTER_TOUCH_INFO,
      },
      WindowsAndMessaging::{GetClientRect, PT_PEN, PT_TOUCH, PT_TOUCHPAD},
    },
  },
};

use crate::Result;

use super::util;

#[derive(Clone)]
pub(crate) struct VisualHost {
  pub hwnd: HWND,
  #[allow(dead_code)]
  pub d3d: ID3D11Device,
  pub d3d_context: ID3D11DeviceContext,
  pub dcomp: IDCompositionDevice,
  #[allow(dead_code)]
  pub target: IDCompositionTarget,
  pub root_visual: IDCompositionVisual,
  #[allow(dead_code)]
  pub background_visual: IDCompositionVisual,
  pub background_surface: IDCompositionVirtualSurface,
  pub background_color: Rc<Cell<Option<(u8, u8, u8, u8)>>>,
  #[allow(dead_code)]
  pub webview_visual: IDCompositionVisual,
  pub clip: IDCompositionRectangleClip,
  pub env3: ICoreWebView2Environment3,
  pub comp_controller: ICoreWebView2CompositionController,
  pub controller: ICoreWebView2Controller,
  pub automation_provider: Option<IRawElementProviderSimple>,
}

impl VisualHost {
  pub(crate) unsafe fn create(
    hwnd: HWND,
    env: &ICoreWebView2Environment,
    incognito: bool,
    background_color: Option<(u8, u8, u8, u8)>,
    bounds: RECT,
  ) -> Result<Self> {
    let mut d3d = None;
    let mut d3d_context = None;
    // SAFETY: Called on the UI thread during WebView creation; WebView2 visual hosting requires
    // a BGRA-capable D3D11 device that stays alive for the lifetime of the composition tree.
    D3D11CreateDevice(
      None,
      D3D_DRIVER_TYPE_HARDWARE,
      HMODULE::default(),
      D3D11_CREATE_DEVICE_BGRA_SUPPORT,
      None,
      D3D11_SDK_VERSION,
      Some(&mut d3d),
      None,
      Some(&mut d3d_context),
    )?;
    let d3d = d3d.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
    let d3d_context = d3d_context.ok_or_else(|| windows::core::Error::from(E_POINTER))?;

    let dxgi: IDXGIDevice = d3d.cast()?;
    // SAFETY: The DXGI device remains alive via `d3d`, satisfying DirectComposition's device lifetime.
    let dcomp: IDCompositionDevice = DCompositionCreateDevice(&dxgi)?;
    let target = dcomp.CreateTargetForHwnd(hwnd, false)?;
    let root_visual = dcomp.CreateVisual()?;
    let background_visual = dcomp.CreateVisual()?;
    let webview_visual = dcomp.CreateVisual()?;
    let clip = dcomp.CreateRectangleClip()?;
    let controller_background_color = background_color;
    let background_surface = dcomp.CreateVirtualSurface(
      surface_extent(bounds.right - bounds.left),
      surface_extent(bounds.bottom - bounds.top),
      DXGI_FORMAT_B8G8R8A8_UNORM,
      DXGI_ALPHA_MODE_IGNORE,
    )?;
    let background_color = Rc::new(Cell::new(normalize_background_color(
      controller_background_color,
    )));

    root_visual.SetClip(&clip)?;
    target.SetRoot(&root_visual)?;
    background_visual.SetContent(&background_surface.cast::<windows::core::IUnknown>()?)?;
    root_visual.AddVisual(&background_visual, false, None)?;
    root_visual.AddVisual(&webview_visual, true, Some(&background_visual))?;

    let env3 = env.cast::<ICoreWebView2Environment3>()?;
    let comp_controller =
      create_composition_controller(env, hwnd, incognito, controller_background_color)?;
    let controller: ICoreWebView2Controller = comp_controller.cast()?;
    comp_controller.SetRootVisualTarget(&webview_visual.cast::<windows::core::IUnknown>()?)?;
    let automation_provider = comp_controller
      .cast::<ICoreWebView2CompositionController2>()
      .ok()
      .and_then(|controller2| controller2.AutomationProvider().ok())
      .and_then(|provider| provider.cast::<IRawElementProviderSimple>().ok());

    let host = Self {
      hwnd,
      d3d,
      d3d_context,
      dcomp,
      target,
      root_visual,
      background_visual,
      background_surface,
      background_color,
      webview_visual,
      clip,
      env3,
      comp_controller,
      controller,
      automation_provider,
    };

    host.set_bounds(bounds)?;

    Ok(host)
  }

  pub(crate) unsafe fn resize(&self, width: i32, height: i32) -> Result<()> {
    self.set_bounds(RECT {
      left: 0,
      top: 0,
      right: width.max(0),
      bottom: height.max(0),
    })
  }

  pub(crate) unsafe fn set_bounds(&self, bounds: RECT) -> Result<()> {
    let width = (bounds.right - bounds.left).max(0) as f32;
    let height = (bounds.bottom - bounds.top).max(0) as f32;

    self.controller.SetBounds(bounds)?;
    self
      .background_surface
      .Resize(surface_extent(bounds.right - bounds.left), surface_extent(bounds.bottom - bounds.top))?;
    self.paint_background(width as i32, height as i32)?;
    self.root_visual.SetOffsetX2(bounds.left as f32)?;
    self.root_visual.SetOffsetY2(bounds.top as f32)?;
    self.clip.SetLeft2(0.0)?;
    self.clip.SetTop2(0.0)?;
    self.clip.SetRight2(width)?;
    self.clip.SetBottom2(height)?;
    self.dcomp.Commit()?;
    let _ = self.controller.NotifyParentWindowPositionChanged();

    Ok(())
  }

  pub(crate) unsafe fn set_background_color(&self, background_color: (u8, u8, u8, u8)) -> Result<()> {
    self
      .background_color
      .set(normalize_background_color(Some(background_color)));

    let mut client_rect = RECT::default();
    GetClientRect(self.hwnd, &mut client_rect)?;
    self
      .background_surface
      .Resize(surface_extent(client_rect.right - client_rect.left), surface_extent(client_rect.bottom - client_rect.top))?;
    self.paint_background(client_rect.right - client_rect.left, client_rect.bottom - client_rect.top)?;
    self.dcomp.Commit()?;

    Ok(())
  }

  unsafe fn paint_background(&self, width: i32, height: i32) -> Result<()> {
    let Some((r, g, b, _a)) = self.background_color.get() else {
      return Ok(());
    };

    let draw_width = width.max(1);
    let draw_height = height.max(1);
    let update_rect = RECT {
      left: 0,
      top: 0,
      right: draw_width,
      bottom: draw_height,
    };
    let mut update_offset = POINT::default();
    let texture = self
      .background_surface
      .BeginDraw::<ID3D11Texture2D>(Some(&update_rect), &mut update_offset)?;

    let draw_result = (|| -> Result<()> {
      let resource: ID3D11Resource = texture.cast()?;
      let mut render_target: Option<ID3D11RenderTargetView> = None;
      self
        .d3d
        .CreateRenderTargetView(&resource, None, Some(&mut render_target))?;
      let render_target = render_target.ok_or_else(|| windows::core::Error::from(E_POINTER))?;
      self.d3d_context.ClearRenderTargetView(
        &render_target,
        &[
          f32::from(r) / 255.0,
          f32::from(g) / 255.0,
          f32::from(b) / 255.0,
          1.0,
        ],
      );

      Ok(())
    })();

    let _ = self.background_surface.EndDraw();
    draw_result
  }

  pub(crate) unsafe fn on_dpi_changed(&self) -> Result<()> {
    if let Ok(controller3) = self.controller.cast::<ICoreWebView2Controller3>() {
      controller3.SetRasterizationScale(util::dpi_to_scale_factor(util::hwnd_dpi(self.hwnd)))?;
    }
    let _ = self.controller.NotifyParentWindowPositionChanged();

    Ok(())
  }

  pub(crate) unsafe fn create_pointer_info(
    &self,
    pointer_id: u32,
  ) -> Result<ICoreWebView2PointerInfo> {
    let mut info = POINTER_INFO::default();
    GetPointerInfo(pointer_id, &mut info)?;

    let mut client_rect = RECT::default();
    GetClientRect(self.hwnd, &mut client_rect)?;

    let pixel_location = screen_point_to_client(self.hwnd, info.ptPixelLocation)?;
    let pixel_location_raw = screen_point_to_client(self.hwnd, info.ptPixelLocationRaw)?;

    let pointer_info = self.env3.CreateCoreWebView2PointerInfo()?;
    pointer_info.SetPointerKind(info.pointerType.0 as u32)?;
    pointer_info.SetPointerId(info.pointerId)?;
    pointer_info.SetFrameId(info.frameId)?;
    pointer_info.SetPointerFlags(info.pointerFlags.0)?;
    pointer_info.SetDisplayRect(client_rect)?;
    pointer_info.SetPointerDeviceRect(client_rect)?;
    pointer_info.SetPixelLocation(pixel_location)?;
    pointer_info.SetPixelLocationRaw(pixel_location_raw)?;
    pointer_info.SetTime(info.dwTime)?;
    pointer_info.SetHistoryCount(info.historyCount)?;
    pointer_info.SetInputData(info.InputData)?;
    pointer_info.SetKeyStates(info.dwKeyStates)?;
    pointer_info.SetPerformanceCount(info.PerformanceCount)?;
    pointer_info.SetButtonChangeKind(info.ButtonChangeType.0)?;

    match info.pointerType {
      PT_TOUCH | PT_TOUCHPAD => {
        let mut touch_info = POINTER_TOUCH_INFO::default();
        if GetPointerTouchInfo(pointer_id, &mut touch_info).is_ok() {
          pointer_info.SetTouchFlags(touch_info.touchFlags)?;
          pointer_info.SetTouchMask(touch_info.touchMask)?;
          pointer_info.SetTouchContact(screen_rect_to_client(self.hwnd, touch_info.rcContact)?)?;
          pointer_info
            .SetTouchContactRaw(screen_rect_to_client(self.hwnd, touch_info.rcContactRaw)?)?;
          pointer_info.SetTouchOrientation(touch_info.orientation)?;
          pointer_info.SetTouchPressure(touch_info.pressure)?;
        }
      }
      PT_PEN => {
        let mut pen_info = POINTER_PEN_INFO::default();
        if GetPointerPenInfo(pointer_id, &mut pen_info).is_ok() {
          pointer_info.SetPenFlags(pen_info.penFlags)?;
          pointer_info.SetPenMask(pen_info.penMask)?;
          pointer_info.SetPenPressure(pen_info.pressure)?;
          pointer_info.SetPenRotation(pen_info.rotation)?;
          pointer_info.SetPenTiltX(pen_info.tiltX)?;
          pointer_info.SetPenTiltY(pen_info.tiltY)?;
        }
      }
      _ => {}
    }

    Ok(pointer_info)
  }
}

#[inline]
fn surface_extent(value: i32) -> u32 {
  value.max(1) as u32
}

#[inline]
fn normalize_background_color(
  background_color: Option<(u8, u8, u8, u8)>,
) -> Option<(u8, u8, u8, u8)> {
  match background_color {
    Some((_, _, _, 0)) => None,
    Some((r, g, b, _)) => Some((r, g, b, 255)),
    None => Some((255, 255, 255, 255)),
  }
}

unsafe fn create_composition_controller(
  env: &ICoreWebView2Environment,
  hwnd: HWND,
  incognito: bool,
  background_color: Option<(u8, u8, u8, u8)>,
) -> Result<ICoreWebView2CompositionController> {
  let (tx, rx) = mpsc::channel();

  let handler = CreateCoreWebView2CompositionControllerCompletedHandler::create(Box::new(
    move |error_code, controller| {
      let result = (|| {
        error_code?;
        controller.ok_or_else(|| windows::core::Error::from(E_POINTER).into())
      })();
      tx.send(result)
        .map_err(|_| windows::core::Error::from(E_UNEXPECTED))
    },
  ));

  if let Ok(env10) = env.cast::<ICoreWebView2Environment10>() {
    let controller_opts = env10.CreateCoreWebView2ControllerOptions()?;

    if let Some((r, g, b, mut a)) = background_color {
      if let Ok(opts3) = controller_opts.cast::<ICoreWebView2ControllerOptions3>() {
        if a != 0 {
          a = 255;
        }
        opts3.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
          R: r,
          G: g,
          B: b,
          A: a,
        })?;
      }
    }

    controller_opts.SetIsInPrivateModeEnabled(incognito)?;
    env10.CreateCoreWebView2CompositionControllerWithOptions(hwnd, &controller_opts, &handler)?;
  } else {
    let env3 = env.cast::<ICoreWebView2Environment3>()?;
    env3.CreateCoreWebView2CompositionController(hwnd, &handler)?;
  }

  webview2_com::wait_with_pump(rx)?
}

unsafe fn screen_point_to_client(hwnd: HWND, mut point: POINT) -> Result<POINT> {
  if !ScreenToClient(hwnd, &mut point).as_bool() {
    return Err(windows::core::Error::from_win32().into());
  }
  Ok(point)
}

unsafe fn screen_rect_to_client(hwnd: HWND, rect: RECT) -> Result<RECT> {
  let mut top_left = POINT {
    x: rect.left,
    y: rect.top,
  };
  let mut bottom_right = POINT {
    x: rect.right,
    y: rect.bottom,
  };

  if !ScreenToClient(hwnd, &mut top_left).as_bool() {
    return Err(windows::core::Error::from_win32().into());
  }
  if !ScreenToClient(hwnd, &mut bottom_right).as_bool() {
    return Err(windows::core::Error::from_win32().into());
  }

  Ok(RECT {
    left: top_left.x,
    top: top_left.y,
    right: bottom_right.x,
    bottom: bottom_right.y,
  })
}
