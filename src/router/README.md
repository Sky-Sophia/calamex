# router/index.ts — 当前状态：已启用（Active）

> **@status: active** | ADR: [ADR-20260423-welcome-smil-svg](../../docs/architecture/ADR-20260423-welcome-smil-svg.md)

## 当前用途

本项目于 2026-04-23 启用了受限路由能力，但范围仅限欢迎页启动过渡：

- `/welcome`：SMIL SVG 欢迎页
- `/home`：工作台路由锚点
- `App.vue` 仍负责窗口生命周期、工作台预挂载、ready handoff 与启动过渡

## 边界约束

- 路由 **不是** 工作台业务编排真源
- `ShellWorkbenchView.vue` 仍由 `App.vue` 协调挂载
- 新增业务路由前，必须继续遵守 ADR 中的范围限制与评审要求
