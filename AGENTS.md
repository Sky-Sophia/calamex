# AGENTS.md

Calamex：Windows 上的 Shell 脚本编辑器/轻 IDE。前端 Tauri 2 + Vue 3(TS strict)，后端 Rust，脚本执行下沉 WSL2。

## 启动
- `pnpm install`
- `pnpm tauri:dev`（桌面，含环境自检）｜`pnpm dev`（仅前端）

## 改完必跑（绿了才提交）
`pnpm lint` · `pnpm typecheck` · `pnpm test`；动 Rust 再在 `src-tauri/` 跑 `cargo clippy && cargo test`；大改跑 `pnpm guard`。

## 必须遵守
- 前端 I/O 只走 `src/services/`；组件禁止直接 `invoke`/`fetch`/读写存储。
- 禁 `any`、`@ts-ignore`、`!` 非空断言；外部输入用 Zod 校验。
- `src/bindings`、`src/generated`、`tauri.contracts.ts` 由 tauri-specta 生成，**禁手改**——改 Rust 命令后重新生成。
- 文件操作必经 Rust 命令；密钥走 keyring，不进 `localStorage`；能力清单 `capabilities/` 按域最小授权。
- 不动对外 IPC 契约与状态机；改动同步资源清理路径与受影响的测试。

## 质量
- 覆盖率：全局 ≥ 80%，核心域 ≥ 90%。
- 性能改动附前后对比数据，守 `docs/performance-budget.md`。
- 按域拆模块，拒绝上帝文件；只做需求内的事，不过度设计。

## 提交
- 单分支 `main`（trunk-based），squash 合入。
- Conventional Commits（lefthook + commitlint 强制）。
- 关键决策写 ADR（`docs/adr/`），已 accepted 不重写。
- 取舍优先级：安全 > 类型安全 > 可测性 > 可维护性 > 性能 > 风格。有歧义先停下确认。

延伸：`README.md`（产品/技术栈）、`docs/`（架构、可观测性、安全例外）。
