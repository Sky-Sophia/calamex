# ADR-20260423-standard-window-resize-redirection-bitmap

- **日期**：2026-04-23
- **状态**：`accepted`
- **决策者**：@xiaojianc
- **Supersedes**：`ADR-20260423-vendor-wry-visual-hosting.md` 中“主窗口默认启用 Visual Hosting 解决 resize”的方向

---

## 背景

WebView2 Visual Hosting 能消除可见 child HWND 与宿主 HWND 的部分不同步问题，但在无装饰整窗场景下也引入了新的宿主责任：整窗像素必须由 DirectComposition tree 自己完整兜底。实际验证中，Chromium/WebView2 在用户拖边时仍可能慢 1～3 帧 present；若底层没有与 UI 设计一致的稳定兜底，用户会看到黑底、透明穿透或整窗被背景层遮住。

本项目目标是达到 VSCode / Cursor / Windsurf 同级拖边观感，而不是追求 Chromium 架构下理论上的“绝对零漏底”。

## 决策

主窗口回到标准 WebView2 windowed hosting + Windows redirection bitmap 路径：

1. `visual-hosting` cargo feature 不再自动让 `label == "main"` 进入 Visual Hosting。
2. 不为标准路径设置 `WS_EX_NOREDIRECTIONBITMAP`，让 Windows redirection bitmap 在拖边期间提供硬件兜底像素。
3. 主窗口、HTML bootstrap、Tailwind 根背景统一到 chrome 主色 `#0d0f12`。
4. 保留无装饰窗口、前端自定义标题栏、Win11 DWM 圆角请求。
5. 保留 `TAURI_DRAG_RESIZE_BORDERS` 的 `WM_NCLBUTTONDOWN` 坐标打包修复，避免上 / 左边框变成整窗平移。
6. Rust WndProc 通过 WebView2 `ExecuteScript` 向前端广播 `shell-window-resize-start` / `shell-window-resize-end`；前端在拖边期间暂停 Monaco / xterm / ResizeObserver 重型 relayout，松手后统一补一次。

## 备选方案

1. **继续 Visual Hosting + DComp 背景层**
   - 优点：理论上更接近整窗 DComp 合成。
   - 缺点：实现复杂，仍要处理 z-order、圆角、输入、UIA、DPI、背景 surface present 等宿主责任。
   - 结论：拒绝作为当前主线。
2. **CSS 盖底色**
   - 优点：实现简单。
   - 缺点：无法解决透明穿透与渲染管线压力。
   - 结论：拒绝作为主修方案。
3. **拖边冻结 / 截图拉伸**
   - 优点：可能降低 live relayout 成本。
   - 缺点：UX 与 VSCode 类产品不一致，松手跳变明显。
   - 结论：拒绝。

## 影响

- 正面：
  - 透明穿透由 Windows redirection bitmap 兜底消除。
  - 漏底颜色融入应用 chrome，不再出现明显双色闪烁。
  - 拖边期间减少 Monaco / xterm / PTY resize 压力。
- 代价：
  - 标准 windowed hosting 仍允许 Chromium 内容比窗口边框慢极少量帧；本决策接受这一点。
  - `visual-hosting` 代码暂留 vendor fork，但不作为主窗口默认路径。

## 回滚

如未来上游 Wry/Tauri 提供成熟 Visual Hosting 或本项目重新选择 DComp 主线，可新建 ADR 恢复：

1. 恢复 `label == "main"` 自动启用 `visual-hosting` 的 feature gate。
2. 恢复 `WS_EX_NOREDIRECTIONBITMAP` 与 DComp background visual。
3. 重新执行 UIA、IME、DPI、输入转发和 240fps resize 验证矩阵。
