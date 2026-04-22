# router/index.ts — 当前状态：休眠（Dormant）

> **@status: dormant** | ADR: [ADR-0006](../../docs/architecture/ADR-0006-router-dormant.md)

## 为什么保留但不使用

本项目当前采用「单窗口无路由」形态（见 ADR-0006 与 R-18.2.1）：

- `App.vue` 是窗口与工作台编排的唯一协调器
- `ShellWorkbenchView.vue` 直接挂载，无需路由分派
- Vue Router **未** 在 `main.ts` 中注册（`app.use(router)` 不存在）

## 业务代码限制

> **R-20.8.2**：dormant 模块的业务代码 `MUST NOT` `import` 本目录内任何符号。
>
> CI 脚本 `scripts/check-dormant-modules.ts` 会扫描违规 import，违规即失败。

## 如何启用路由

若未来引入多页面路由，**MUST**：

1. 新建 ADR（格式：`docs/architecture/ADR-YYYYMMDD-enable-router.md`），说明分页策略与影响面
2. 在 ADR 中将 ADR-0006 状态更新为 `superseded by <新 ADR>`
3. 经 Code Owner 批准 ADR 后，在 `main.ts` 挂载路由
4. 同步将 `// @status: dormant` 更新为 `// @status: active`
5. 删除或更新本 README

## 注意事项

- 当前代码仅保留以备将来激活，功能上等同于未存在
- `scripts/check-router-disabled.ts` 确保不会意外挂载
- 激活路由后 `ShellWorkbenchView.vue` **MUST** 同步拆解聚合职责（R-18.2.3）
