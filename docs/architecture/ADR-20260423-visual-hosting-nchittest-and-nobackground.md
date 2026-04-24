# ADR-20260423-visual-hosting-nchittest-and-nobackground

- **日期**：2026-04-23
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

在 `ADR-20260423-vendor-wry-visual-hosting.md` 落地后，WebView2 已切到 Visual Hosting，`WRY_WEBVIEW = false` 与 `Chrome_WidgetWin_0 = 0x0` 说明内容面已不再由可见 child HWND 承载，但 resize 仍残留两个彼此独立的问题：

1. **Bug A：上 / 左边框拖动像在移动整窗。**
   静态追链后确认，真正参与无边框 resize 的不是前端标题栏，而是 `tauri-runtime-wry` 的 `TAURI_DRAG_RESIZE_BORDERS` 代理子窗口。该子窗口在把 `WM_NCLBUTTONDOWN` 转发回父窗口时，把 `LPARAM` 错传成了栈上 `POINTS*` 指针，而不是 Win32 约定的「屏幕坐标打包值」。右 / 下边缘容错更高，因此看起来“基本正常”；左 / 上边缘依赖锚点坐标决定哪一侧保持不动，错误 `LPARAM` 会表现为“整窗平移”。
2. **Bug B：向外拖大时新增区域先出 1~2 帧黑底。**
   静态追链后确认，`WS_EX_NOREDIRECTIONBITMAP` 并不是误设：它来自 `tao::WindowBuilderExtWindows::with_no_redirection_bitmap(true)`，在 Visual Hosting 下必须保留。真正缺口是 DComp tree 中只有 WebView2 swap chain visual；Chromium/WebView2 resize present 慢于宿主 HWND 尺寸变化时，新扩出的区域下方没有宿主稳定背景层，于是露出空 / 黑。

同时，直接把顶栏整段改成 Rust `HTCAPTION` 会吞掉现有 WebView 自定义标题栏按钮、菜单与工具区点击，属于 UI 回归，不符合“不要改 UI”的业务约束。

## 决策

采用「**真实 resize 入口修正 + Visual Hosting 黑底截断**」的组合方案：

1. **Bug A：修正 `TAURI_DRAG_RESIZE_BORDERS` 转发链。**
   - 在 `vendor/tauri-runtime-wry/src/undecorated_resizing.rs` 中，把转发给父窗口的 `WM_NCLBUTTONDOWN` `LPARAM` 改为正确的屏幕坐标打包值。
   - 保留 `TAURI_DRAG_RESIZE_BORDERS` 作为单一 resize 命中入口，不改前端标题栏 DOM / CSS。
   - debug 构建下保留 `nchittest:` 前缀日志，便于现场核对边缘命中结果。
2. **Bug B：Visual Hosting 场景保留 NoRedirectionBitmap，并补宿主 DComp 背景层。**
   - 主窗口在 Visual Hosting 下创建前设置 `WS_EX_NOREDIRECTIONBITMAP`，避免回退到 HWND redirection bitmap。
   - `vendor/wry/src/webview2/visual_host.rs` 在 WebView2 visual 下方新增 `background_visual -> IDCompositionVirtualSurface`。
   - 背景 surface 使用与 WebView2 相同 D3D11 device 的 immediate context 做 render-target clear，颜色继承窗口 / WebView 背景色，不走 GDI `GetDC`。
   - `vendor/wry/src/webview2/mod.rs` 在 `WM_WINDOWPOSCHANGING` 提前调用 `put_Bounds` / `NotifyParentWindowPositionChanged()`，`WM_SIZE` 保留兜底。
   - `WM_ERASEBKGND` 直接返回 `LRESULT(1)`，避免系统再擦黑底。
3. **宿主 `WM_NCHITTEST` 只接管外圈 resize 框，不接管标题栏拖动。**
   - Rust 侧仅兜住外圈 8 dip resize 边框与四角。
   - 标题栏中段继续沿用现有前端 `startDragging` 行为，避免 `HTCAPTION` 吞掉 WebView 顶部交互控件。
   - 这不是“靠前端补丁”，而是遵守当前应用已有的标题栏交互真源，Rust 只修正 resize 命中与宿主合成链。

## 考虑的备选

1. **把顶部 32 dip 整段都返回 `HTCAPTION`。**
   - 优点：实现简单。
   - 缺点：会拦截 WebView 内菜单、运行按钮、窗口按钮等顶部交互，属于明显 UI 回归。
   - 结论：拒绝。
2. **继续只在 Wry 父窗口里补 `WM_NCHITTEST`。**
   - 优点：看起来与问题描述接近。
   - 缺点：实际无边框 resize 入口是 `TAURI_DRAG_RESIZE_BORDERS` 子窗口；不修它的 `WM_NCLBUTTONDOWN` 转发参数，左 / 上边缘问题仍会残留。
   - 结论：拒绝。
3. **靠背景色 / CSS / 截图遮罩掩盖黑底。**
   - 优点：实现快。
   - 缺点：无法消除真实帧错位，只是隐藏观感。
   - 结论：拒绝。
4. **清除 `WS_EX_NOREDIRECTIONBITMAP` 回退到 HWND redirection bitmap。**
   - 优点：短期可能让新增区域有 GDI 背景可填。
   - 缺点：与 Visual Hosting 的 DComp 直合成目标冲突，会重新引入两套合成路径和 resize 不同步问题。
   - 结论：拒绝。

## 影响

- **直接影响文件**
  - `vendor/tauri-runtime-wry/src/undecorated_resizing.rs`
  - `vendor/tauri-runtime-wry/src/lib.rs`
  - `vendor/wry/src/webview2/mod.rs`
  - `vendor/wry/src/webview2/visual_host.rs`
- **正面影响**
  - 左 / 上边缘 resize 回到系统语义：固定对侧、缩放当前侧。
  - Visual Hosting 向外拖大时，即使 WebView2 swap chain 慢 1~3 帧，也会先露出宿主 DComp 背景层而不是黑底 / 桌面。
  - 顶部自定义标题栏交互保持不变。
- **风险**
  - `WS_EX_NOREDIRECTIONBITMAP` 与 Windows 11 圆角策略存在耦合，因此同时保留 `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` 请求，避免 UI 变方。

## 回滚方案

1. 回退 `vendor/tauri-runtime-wry/src/undecorated_resizing.rs` 中的 `LPARAM` 打包修复。
2. 回退 `vendor/wry/src/webview2/visual_host.rs` 中 background visual / virtual surface / D3D11 clear。
3. 回退 `vendor/wry/src/webview2/mod.rs` 中 `WM_WINDOWPOSCHANGING` / `WM_ERASEBKGND` / 外圈 hit test 逻辑。
4. 回退 `vendor/tauri-runtime-wry/src/lib.rs` 中 `WS_EX_NOREDIRECTIONBITMAP` 与圆角保留请求。
5. 若需完全退出 Visual Hosting，按 `ADR-20260423-vendor-wry-visual-hosting.md` 的回退步骤移除 vendor patch 并关闭 `visual-hosting` feature。

## 相关链接

- `docs/architecture/ADR-20260423-vendor-wry-visual-hosting.md`
- `RESIZE_NOTES.md`
- `docs/tech-debt.md`
