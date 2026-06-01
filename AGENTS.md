# AGENTS.md · Calamex

> 面向 Windows 的 Linux Shell 脚本编辑器 / 轻量 IDE，编辑在本地、执行统一下沉到 **WSL2**。
> 栈：Tauri 2 + Vue 3.5(TS strict) + CodeMirror 6 · Rust(2021) 后端 · pnpm workspace。
> 本文件是给人与 AI 协作者的「规则速查」；产品细节见 `README.md`，深度规范见 `docs/`。

## 架构（依赖严格单向，禁止反向）

```
Vue 视图(views/components)
  → composables / store(Pinia) / services
  → services/ 反腐层(ACL)  ← I/O 唯一出口
  → tauri-specta 生成的强类型 IPC
  → Rust 后端 commands(editor·terminal·lsp·git·ssh·search·workspace·ai·wsl_link)
  → vsock + gRPC(tonic/prost) → WSL2 执行环境(agent-sidecar)
```

## 目录速览

- `src/` 前端：`components` `composables` `store` `services`(ACL) `views` `terminal` `themes` `bindings`+`generated`(自动生成) `main.ts`
- `src-tauri/` 桌面/Rust：`src/commands`(按域拆分) `src/terminal` `src/ai` `src/agent_sidecar` `capabilities/`(能力清单) `tauri.conf.json`
- `agent-sidecar/` WSL Link Agent（Mastra）· `docs/` 架构/ADR/可观测性/性能预算 · `e2e/` Playwright · `scripts/` 构建辅助

## 红线（不可违反）

- 组件**不得**直接 `fetch` / `invoke` / 读写存储；所有 I/O 经 `src/services/`。
- 禁用 `any` / `@ts-ignore` / 非空断言 `!`；外部输入用 **Zod** 校验。
- IPC 类型由 `tauri-specta` 生成（`src/bindings`、`src/generated`、`tauri.contracts.ts`），**不手改**。
- 敏感数据走 keyring，**禁入** `localStorage`。
- CSP 禁用 `unsafe-inline`/`unsafe-eval`；能力清单按域**最小授权**；文件操作必须经 Rust 命令。
- 不改对外 IPC/API 契约、状态机/协议规则；改动同步处理资源清理（关闭/退出）路径。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm tauri:dev` | 桌面应用开发（含环境自检） |
| `pnpm dev` | 仅前端调试（无原生能力） |
| `pnpm tauri:build` | 打包 Windows 安装包(NSIS) |
| `pnpm lint` / `pnpm format` | Biome 检查 / 自动修复 |
| `pnpm typecheck` | `vue-tsc` 类型检查 |
| `pnpm test` / `pnpm test:coverage` | Vitest 单测 / 覆盖率 |
| `pnpm test:e2e` | Playwright 端到端 + a11y |
| `pnpm guard` | 运行全部工程守护 |
| `pnpm size-limit` | 产物体积守护 |

Rust 侧：`cd src-tauri && cargo test && cargo clippy`。

## 质量门槛

- 覆盖率：全局 ≥ **80%**，核心域 ≥ **90%**。
- 性能改动需附前后对比数据，遵循 `docs/performance-budget.md`。
- 按域拆分模块，避免「上帝文件」；只实现需求范围内功能，不过度设计。
- 提交前本地跑通：`lint` + `typecheck` + `test`（必要时 `guard`）。

## 协作约定

- 分支：trunk-based，统一在 `main` 协作；合入用 **squash**。
- 提交：Conventional Commits（commitlint + lefthook 钩子强制）。
- 关键决策沉淀为 ADR（`docs/adr/`）；已 `accepted` 的 ADR 不就地重写。
- 冲突优先级：**安全 > 类型安全 > 可测性 > 可维护性 > 性能 > 风格**。
- 存在歧义先停下确认，不靠猜测；编码前列清前提与方案取舍。
