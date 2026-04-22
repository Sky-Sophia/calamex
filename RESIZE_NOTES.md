# Resize Visual Hosting Notes

## 当前实现

Windows 主窗口通过本地 `vendor/wry` fork 启用 WebView2 Visual/Composition hosting：

- `src-tauri/tauri.conf.json` 主窗口字段：`"visualHosting": true`
- `src-tauri/Cargo.toml` 直接启用：`wry = { version = "0.54.4", features = ["visual-hosting"] }`
- 工作区根 `Cargo.toml` 通过 `[patch.crates-io]` 指向 `vendor/wry`、`vendor/tauri-runtime`、`vendor/tauri-runtime-wry`、`vendor/tauri-utils`

## 如何切换

1. 保留编译能力但关闭运行时路径：把 `src-tauri/tauri.conf.json` 中 `"visualHosting": false`。
2. 完全回退到 crates.io Wry：移除工作区根 `Cargo.toml` 的 `wry` patch，并从 `src-tauri/Cargo.toml` 移除直接 `wry` 依赖，然后执行 `cargo update -p wry`。

## Spy++ / Win32 验证

验证目标不是颜色是否一致，而是确认 WebView 内容不再由可见 child HWND 承载：

1. 启动 `target/debug/sh-editor.exe`。
2. 找到主窗口 class `Tauri Window`。
3. 展开子窗口：
   - 不应出现 `WRY_WEBVIEW` 容器。
   - 允许出现 WebView2 runtime 创建的 `Chrome_WidgetWin_0`，但它必须是 `0x0` 尺寸；该窗口不是内容合成面。
   - `TAURI_DRAG_RESIZE_BORDERS` 是 Tauri 无边框 resize 命中测试窗口，非 WebView 内容。

本机验证结果：快速 `SetWindowPos` resize 后进程仍响应；`Chrome_WidgetWin_0` 子窗口尺寸为 `0x0`，WebView 内容走 DirectComposition visual。