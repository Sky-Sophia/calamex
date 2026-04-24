# Resize Hosting Notes

## 当前实现

Windows 主窗口当前使用 **标准 WebView2 windowed hosting + Windows redirection bitmap** 路径，不再把 `visual-hosting` cargo feature 作为主窗口 resize 方案自动启用。

- `vendor/tauri-runtime/src/webview.rs` 只尊重显式配置的 `config.visual_hosting`；`--features visual-hosting` 不再自动让 `label == "main"` 进入 DComp Visual Hosting。
- `src-tauri/tauri.conf.json` 不写 `visualHosting` 自定义字段，避免 Tauri 官方 schema 校验失败。
- 主窗口保留无装饰窗口、前端自定义标题栏、Win11 DWM 圆角请求。
- 主窗口 / HTML bootstrap / Tailwind 基底色统一为 chrome 主色 `#0d0f12`，减少 WebView 清屏或 redirection bitmap 兜底时的双色闪烁。

## 已知症状 → 根因 → 修复

| 症状 | 根因 | 修复 |
|---|---|---|
| 拖上 / 左边框时像在移动整窗，右 / 下边框相对正常 | `TAURI_DRAG_RESIZE_BORDERS` 子窗口把 `WM_NCLBUTTONDOWN` 的 `LPARAM` 错传成了 `POINTS*` 指针，左 / 上边缘依赖锚点坐标更容易暴露 | `vendor/tauri-runtime-wry/src/undecorated_resizing.rs` 改为传递正确的屏幕坐标打包值 |
| 向外拖大时透明穿透 / 黑底明显 | Visual Hosting 让整窗像素依赖 DComp/WebView2 present，Chromium resize 慢帧会直接露出底层 | 放弃主窗口 Visual Hosting 自动启用，回到标准 windowed hosting，让系统 redirection bitmap 兜底 |
| 漏底一两帧与 UI 颜色不一致 | 原 bootstrap / Tailwind 基底曾使用 `#1e1e1e` 灰色，与应用 chrome 主色不一致 | 将窗口配置、HTML 非 splash 背景、Tailwind `html/body/#app` 背景统一到 `#0d0f12` |
| 拖边期间内容慢半拍、CPU 高、终端可能反复 PTY resize | Monaco / xterm / ResizeObserver 在每个 resize tick 里重复 relayout / fit / PTY resize，阻塞 Chromium present | Rust WndProc 在 `WM_ENTERSIZEMOVE` / `WM_EXITSIZEMOVE` 向前端发 resize begin/end；前端拖边期间暂停重型 relayout，结束后统一补一次 |

## Resize begin/end 事件

Wry 父窗口 subclass 在标准 windowed hosting 下通过 WebView2 `ExecuteScript` 分发 DOM 事件：

```text
shell-window-resize-start
shell-window-resize-end
```

前端消费点：

- `src/composables/useWindowResizeState.ts`：维护 `html.is-resizing`。
- `src/layouts/AppShellLayout.vue`：拖边期间暂停布局过渡与终端视口同步。
- `src/components/editor/ScriptEditor.vue`：拖边期间暂停 Monaco `layout()`，结束后补一次。
- `src/composables/useShellWorkbenchView.ts`：拖边期间暂停 diagnostics overlay 尺寸计算，结束后补一次。
- `src/terminal/session.ts`：拖边期间暂停 xterm `fit()` 与 PTY resize，结束后补一次。

## 验证

1. 使用标准路径启动：

   ```powershell
   npm run tauri:dev
   ```

2. 拖四边与四角：
   - 不应出现透明穿透。
   - 若 WebView 内容慢 1 帧，漏底应为 `#0d0f12` chrome 色。
   - 上 / 左边框应是 resize，不是整窗平移。

3. 终端回归：
   - 拖边期间终端不应持续触发 PTY resize。
   - 松手后终端尺寸应一次性对齐。

4. UI 回归：
   - 顶栏菜单、运行按钮、窗口控制按钮点击不应被 `HTCAPTION` 吞掉。
   - Win11 圆角应保留。

## 非目标

- 不追求 Chromium 架构下绝对零漏底。
- 不使用截图遮罩或冻结拉伸。
- 不重写现有 UI。
