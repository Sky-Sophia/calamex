#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(rust_2024_compatibility)]

mod agent_sidecar;
mod ai;
mod assets;
#[macro_use]
mod commands;
mod tauri_bindings;
mod terminal;

use ai::edit::AiEditState;
use commands::WorkspaceWatcher;
use commands::LspManager;
use commands::{shutdown_all_terminal_sessions, TerminalSessionState};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ICON_ID: &str = "main-tray";
const TRAY_MENU_SHOW_ID: &str = "tray.show-main-window";
const TRAY_MENU_QUIT_ID: &str = "tray.quit-app";
const TRAY_TOOLTIP: &str = "Calamex";

// === 启动日志 ============================================================

fn elapsed_ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

fn emit_startup_event(event: &str, app_started_at: Instant) {
    eprintln!(
        "{}",
        serde_json::json!({
            "level": "info",
            "scope": "startup",
            "event": event,
            "elapsedMs": elapsed_ms(app_started_at),
        })
    );
}

fn emit_startup_step(event: &str, app_started_at: Instant, step_started_at: Instant) {
    eprintln!(
        "{}",
        serde_json::json!({
            "level": "info",
            "scope": "startup",
            "event": event,
            "elapsedMs": elapsed_ms(app_started_at),
            "durationMs": elapsed_ms(step_started_at),
        })
    );
}

macro_rules! timed_step {
    ($event:expr, $app_started_at:expr, $body:block) => ({
        let __step_started_at = std::time::Instant::now();
        let __result = $body;
        emit_startup_step($event, $app_started_at, __step_started_at);
        __result
    });
}

// === 生命周期 ============================================================

#[derive(Default)]
struct AppLifecycleState {
    is_quitting: AtomicBool,
}

impl AppLifecycleState {
    fn mark_quitting(&self) {
        self.is_quitting.store(true, Ordering::SeqCst);
    }

    fn is_quitting(&self) -> bool {
        self.is_quitting.load(Ordering::SeqCst)
    }
}

fn reveal_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn request_app_exit<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    app_handle.state::<AppLifecycleState>().mark_quitting();
    let terminal_state = app_handle.state::<TerminalSessionState>();
    if let Err(error) = shutdown_all_terminal_sessions(terminal_state.inner()) {
        eprintln!("failed to shutdown terminal sessions: {error}");
    }
    app_handle.exit(0);
}

// === 系统托盘 ============================================================

fn setup_system_tray<R: tauri::Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id(TRAY_MENU_SHOW_ID, "显示主窗口").build(app)?;
    let quit_item = MenuItemBuilder::with_id(TRAY_MENU_QUIT_ID, "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let Some(icon) = app.default_window_icon().cloned() else {
        eprintln!("missing default window icon, tray setup skipped");
        return Ok(());
    };

    TrayIconBuilder::with_id(TRAY_ICON_ID)
        .icon(icon)
        .tooltip(TRAY_TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => reveal_main_window(app_handle),
            TRAY_MENU_QUIT_ID => request_app_exit(app_handle),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// === WebView 平台相关 ====================================================

#[cfg(windows)]
fn disable_webview_default_context_menu<R: tauri::Runtime>(
    webview_window: &tauri::WebviewWindow<R>,
) {
    let label = webview_window.label().to_string();
    let label_for_inner = label.clone();
    let access_result = webview_window.with_webview(move |webview| unsafe {
        let outcome = webview
            .controller()
            .CoreWebView2()
            .and_then(|core| core.Settings())
            .and_then(|settings| settings.SetAreDefaultContextMenusEnabled(false));
        if let Err(error) = outcome {
            eprintln!(
                "failed to disable default WebView2 context menu for window {label_for_inner}: {error}"
            );
        }
    });
    if let Err(error) = access_result {
        eprintln!("failed to access platform webview for window {label}: {error}");
    }
}

#[cfg(not(windows))]
fn disable_webview_default_context_menu<R: tauri::Runtime>(
    _webview_window: &tauri::WebviewWindow<R>,
) {
}

// === 随包资源 ============================================================

/// 打包后把「随包资源」的绝对路径注入进进程环境变量,供 sidecar / LSP / shfmt 复用。
/// 这些解析器(agent_sidecar、commands::lsp、commands::shell_tools)都已支持相应的
/// 环境变量覆盖,因此无需改动它们即可让生产环境优先使用安装目录内自带的运行时。
/// 仅在对应文件 / 目录真实存在时设置(开发模式下资源目录不存在则整体跳过),
/// 且不覆盖用户已显式设置的同名环境变量。
fn prime_bundled_resource_env<R: tauri::Runtime>(app: &tauri::App<R>) {
    let Ok(resource_dir) = app.path().resource_dir() else {
        return;
    };
    let bundle = resource_dir.join("resources-bundle");
    if !bundle.is_dir() {
        return;
    }

    let set_if_present = |key: &str, path: std::path::PathBuf, require_dir: bool| {
        if std::env::var_os(key).is_some() {
            return;
        }
        let exists = if require_dir { path.is_dir() } else { path.is_file() };
        if exists {
            std::env::set_var(key, &path);
        }
    };

    let node_exe = if cfg!(windows) { "node.exe" } else { "node" };
    let shellcheck_exe = if cfg!(windows) { "shellcheck.exe" } else { "shellcheck" };
    let shfmt_exe = if cfg!(windows) { "shfmt.exe" } else { "shfmt" };

    set_if_present(
        "XIAOJIANC_AGENT_SIDECAR_ROOT",
        bundle.join("agent-sidecar"),
        true,
    );
    set_if_present(
        "XIAOJIANC_NODE_EXE",
        bundle.join("node").join(node_exe),
        false,
    );
    set_if_present(
        "XIAOJIANC_SHELLCHECK_EXE",
        bundle.join(shellcheck_exe),
        false,
    );
    set_if_present("SHFMT_BIN", bundle.join(shfmt_exe), false);
    set_if_present(
        "XIAOJIANC_LSP_CLI_JS",
        bundle
            .join("lsp")
            .join("node_modules")
            .join("bash-language-server")
            .join("out")
            .join("cli.js"),
        false,
    );
}

// === main ================================================================

fn main() {
    let app_started_at = Instant::now();
    emit_startup_event("tauri.main.start", app_started_at);

    // specta 绑定 builder 在 debug / release 都需要构造(用于 mount_events);
    // 仅在 debug 模式 export TS 文件
    let specta_bindings = tauri_bindings::builder();

    #[cfg(debug_assertions)]
    tauri_bindings::export(&specta_bindings);

    let builder_started_at = Instant::now();
    let app = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("favicon", |context, request, responder| {
            let app_handle = context.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let response = assets::favicon::handle_protocol_request(&app_handle, request).await;
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AiEditState::default())
        .manage(AppLifecycleState::default())
        .manage(TerminalSessionState::default())
        .manage(WorkspaceWatcher::default())
        .manage(LspManager::new())
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            let app_handle = window.app_handle();
            if app_handle.state::<AppLifecycleState>().is_quitting() {
                return;
            }
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("failed to hide main window to tray: {error}");
            }
        })
        .invoke_handler(specta_bindings.invoke_handler())
        .setup(move |app| {
            let setup_started_at = Instant::now();
            emit_startup_event("tauri.setup.start", app_started_at);

            // 打包环境:把随包运行时/二进制路径注入环境变量(须在任何 sidecar / LSP 解析前完成)。
            prime_bundled_resource_env(app);

            // 挂载 specta 强类型事件;让前端 events.workspaceFsEvent.listen(...) 拿到 typed payload
            specta_bindings.mount_events(app);

            timed_step!("tauri.setup.terminal-events-attached", app_started_at, {
                terminal::registry::registry()
                    .event_bus
                    .attach_app(app.handle().clone());
            });

            let tray_started_at = Instant::now();
            setup_system_tray(app)?;
            emit_startup_step("tauri.setup.tray-ready", app_started_at, tray_started_at);

            timed_step!("tauri.setup.webview-settings-ready", app_started_at, {
                for webview_window in app.webview_windows().into_values() {
                    disable_webview_default_context_menu(&webview_window);
                }
            });

            timed_step!("tauri.setup.window-state-ready", app_started_at, {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.unminimize();
                }
            });

            emit_startup_step("tauri.setup.done", app_started_at, setup_started_at);
            Ok(())
        });

    emit_startup_step("tauri.builder.ready", app_started_at, builder_started_at);

    emit_startup_event("tauri.run.start", app_started_at);
    if let Err(error) = app.run(tauri::generate_context!()) {
        eprintln!("failed to run SH editor: {error}");
        std::process::exit(1);
    }
}
