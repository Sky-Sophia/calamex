# ADR-0001 启动真源选 B（App.vue 协调）

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

当前启动流程存在**双实现**：

1. `src/main.ts`（约 344 行）在 Vue 挂载之前，用命令式 DOM 构建了 Bootstrap Splash 动画及品牌样式，内联 DOM/CSS 字符串超过 120 行（违反 R-20.6.3）。
2. `src/components/common/SplashScreen.vue` 在 Vue 侧提供了同功能的 Splash 组件。
3. 窗口阶段切换逻辑散布在 `main.ts` 与 `App.vue` 两处（违反 R-20.6.4）。

这导致：视觉逻辑维护成本翻倍；品牌动画改一处另一处遗漏；阶段枚举无统一真源。

关联规则：R-18.1.1、R-18.1.2、R-20.6.1 ～ R-20.6.6。

## 决策

选择**方案 B**：`App.vue` 为启动协调真源。

- `main.ts` 职责收敛为：
  1. 最早期全局错误处理器注册（`window.onerror` / `unhandledrejection`）。
  2. 同步主题注入（R-6.5.12 规定的唯一允许内联脚本，需 CSP nonce）。
  3. Vue 挂载失败兜底（DOM 错误覆盖层）。
  4. 总行数目标 ≤ 120 行。
- `SplashScreen.vue` 是品牌动画/Bootstrap Splash 的唯一实现，由 `App.vue` 按阶段渲染。
- 四阶段（`transparent-welcome` → `bootstrap` → `workbench-ready` → `workbench`）统一由 Rust `apply_window_stage` 指令驱动；前端 MUST NOT 直接调用 `WebviewWindow.setDecorations` / `show` / `hide` / `setSize`。
- 阶段枚举单源定义于前端 `src/types/app.ts`（`EWindowStage`），与 Rust 侧结构经 `tauri-specta` 或 CI 比对保持一致。

## 考虑的备选

| 备选 | 优点 | 缺点 | 否决原因 |
|------|------|------|----------|
| 方案 A：`main.ts` DOM 为真源，Vue 侧禁 Splash | `main.ts` 可在 Vue 挂载前 100% 控制首帧 | 主题变更需改两处；Vue 组件化失去意义 | 与 Vue 组件化趋势相悖；代码量仍集中于 `main.ts` |
| 方案 B（本决策）：`App.vue` 为真源 | 单一组件生命周期；可视觉回归测试 | Splash 移除时机需精确（首帧 ready 事件驱动） | 无否决原因，为选定方案 |

## 影响

- **正面**：`main.ts` 行数大幅减少；启动流程可用 Playwright E2E 覆盖；不存在 FOUC。
- **负面 / 代价**：需重构 `main.ts` 内联 DOM（T-2.7 落地）；Rust 侧 `apply_window_stage` 需处理四阶段枚举。
- **关联规则**：R-18.1.1、R-18.1.2、R-18.1.3、R-20.6.1～R-20.6.6
- **关联任务**：T-1.2（本 ADR）、T-2.7（实际落地）

## 相关链接

- [AGENTS.md §18.1 窗口与启动生命周期](../../AGENTS.md)
- [AGENTS.md §20.6 启动链路单源化](../../AGENTS.md)

## 迁移计划

1. **本 ADR 阶段（T-1.2）**：冻结 main.ts 内联 DOM，不再扩展；`SplashScreen.vue` 不再扩展。
2. **T-2.7 阶段**：
   - 收缩 `main.ts` → ≤ 120 行。
   - 将 Bootstrap Splash DOM 从 `main.ts` 移除，完全交 `SplashScreen.vue`。
   - 新增 Playwright E2E：断言启动无 FOUC、Splash 随首帧同步移除。

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
