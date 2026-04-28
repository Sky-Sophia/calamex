# ADR-20260428 Agent 自动编辑与可回滚体系

- **日期**：2026-04-28
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

现有 AI 写工具链只有 `propose_patch` 与 `apply_patch` 两个阶段：

- `propose_patch` 只生成 patch 预览。
- `apply_patch` 直接写工作区文件，失败时仅依赖内存中的原文回滚。

这条链路无法满足 AED 方案要求的三类能力：

- **授权升级**：用户一次授权后允许 Agent 在任务内自动写盘。
- **独立回滚**：回滚能力不能依赖 Git，也不能依赖编辑器原生 undo 栈。
- **本地历史**：必须提供 task-start / pre-tool / manual checkpoint 等本地快照时间线。

同时，AGENTS.md 已对架构、回滚、安全和审计提出强约束：

- R-7.4.*：写能力必须拆分独立 capability。
- R-9.* / R-20.4.*：IPC 契约必须类型化、运行时校验、错误归一化。
- R-14.5.*：高权限写操作必须进入审计事件清单。
- R-20.5.*：Rust 命令模块必须按领域拆分，不能继续把 AI 写盘逻辑压在现有 `ai_patch` 模块里。

## 决策

引入独立的 AED（Agent Edit & Rollback）子系统，采用「用户授权后自动写盘 + 随时可回滚」模型。

### 1. 领域边界

- Rust 侧新增 `src-tauri/src/ai_edit/` 子系统，负责授权门控、快照存储、写入流水线、回滚引擎、时间线检索、受保护路径策略。
- 前端新增 `src/types/ai-edit.ts` 与 `src/types/ai-edit.schema.ts` 作为 AED 单源类型与 schema。
- 写能力拆分为独立 capability `src-tauri/capabilities/ai-edit.json`，与只读 AI 工具隔离。

### 2. 回滚模型

AED 第一阶段必须同时支持以下粒度：

- Edit-level Undo
- Task Revert
- Snapshot Restore
- Per-file Revert
- Per-hunk Revert

快照与编辑日志统一存放于应用数据目录 `.notion-ide-ai/edits/`，不进入工作区，不污染 Git。

### 3. 授权模型

授权分三级：

- `manual`
- `per_task`
- `session`

默认等级固定为 `manual`。`per_task` 与 `session` 必须由用户显式升级，且 `session` 不跨进程持久化。

### 4. 写入流水线

所有自动写盘统一走十步流水线：

1. schema 校验
2. 路径合法性校验
3. beforeHash 校验
4. 授权门控
5. pre-edit snapshot
6. 原子写入（tmp + fsync + rename）
7. append-only journal
8. Monaco 文档刷新与光标恢复
9. Git 状态重算
10. 时间线事件推送

### 5. 审计与安全

- 受保护路径在任何授权等级下都必须强制二次确认。
- 审计事件只记录 hash、大小、授权等级和回滚粒度，不记录全文与 patch 文本。
- 回滚动作本身必须产生可再次撤销的反向快照。

## 考虑的备选

| 备选 | 否决原因 |
|---|---|
| 继续扩展现有 `ai_patch`，只补一个 task-level 回滚 | 无法满足 5 级回滚、授权升级、独立时间线三项核心目标 |
| 用 Git commit / stash 作为回滚底座 | 会污染用户仓库状态，违反 AED 明确约束 |
| 只依赖 Monaco undo 栈 | 关闭 tab 或 reload 后状态不可恢复，无法提供 Local History |

## 影响

- **正面**：AI 自动写盘具备可观测、可回滚、可审计能力，IDE 心智与 IDEA Local History / Undo / Revert 对齐。
- **代价**：Rust 与前端都要新增一层 AED 契约、状态和 UI；E2E 需要新增回滚场景套件。
- **关联规则**：R-7.4.*、R-9.*、R-14.5.*、R-20.4.*、R-AED.*

## 相关链接

- [AGENTS.md](../../AGENTS.md)
- [审计事件清单](../audit-events.md)
- [ADR-0007-ipc-acl-contract.md](./ADR-0007-ipc-acl-contract.md)

---

> 若未来推翻本 ADR，MUST 新建新 ADR，并在本文末尾标记 `superseded by ADR-XXXX`。