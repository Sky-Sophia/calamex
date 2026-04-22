# ADR-0007 IPC 反腐层契约

- **日期**：2026-04-21
- **状态**：`proposed`
- **决策者**：@xiaojianc

---

## 背景

当前 `src/services/tauri.ts` 是对 `@tauri-apps/api/core` `invoke` 的轻量封装，缺少：

- 入参 / 出参 Zod schema 校验
- `safeParse` 失败后的 `AppError` 归一化
- 结构化调用日志（含 traceId）
- 超时与取消语义（AbortSignal）
- snake_case → camelCase 字段映射

这违反了 AGENTS.md R-20.4.1 ～ R-20.4.7（服务层作为系统边界/Anti-Corruption Layer）。

## 决策

将 `services/tauri.ts` 升级为真正的契约边界（将在迭代 3 T-3.2 落地）：

### 每个 IPC 命令由以下要素定义

| 要素 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | Rust 命令名（snake_case） |
| `inSchema` | `z.ZodType` | 入参 Zod schema |
| `outSchema` | `z.ZodType` | 出参 Zod schema（含 camelCase 映射） |
| `timeoutMs` | `number` | 超时毫秒，默认 10000 |
| `idempotent` | `boolean` | 是否幂等（决定重试策略） |
| `audit` | `'none' \| 'info' \| 'sensitive'` | 审计等级 |

### safeParse 失败策略

- 一律抛出 `AppError({ scope: 'validation', code: 'ipc.contract-violation' })`
- 记录 traceId + 原始 payload 摘要到结构化日志
- UI 层提示「IPC 契约不一致，已记录 traceId=…」
- **禁止**默默降级或静默回退

### traceId 规则

- 每次 IPC 调用由前端 services 层生成 UUIDv4 或 ULID
- 通过命令 payload 保留字段 `_traceId` 下发到 Rust（或通过 `tauri::State` 注入）
- 日志与错误上报均携带 traceId

### 取消语义

- 通过 `AbortSignal` 传递；组件卸载时 MUST 自动取消进行中的 IPC
- Rust 侧命令 MUST 响应取消（通过 Tauri `tauri::ipc::Channel` 或 `CancellationToken`）

### AppError 结构（统一前后端）

```typescript
interface IAppError {
  code: string       // 业务错误码，如 'ipc.timeout'、'fs.not-found'
  message: string    // 面向用户的中文消息
  scope: 'http' | 'ipc' | 'validation' | 'unknown'
  traceId: string    // UUIDv4 或 ULID
  cause?: unknown    // 原始错误，仅日志
  timestamp: string  // ISO-8601
}
```

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 继续使用裸 `invoke` | 无类型保证；无运行时校验；系统边界模糊 |
| 用 `tauri-specta` 生成类型但不加 Zod | 缺少运行时校验；TS 类型仅编译期有效 |
| 引入第三方 RPC 框架 | 引入额外运行时；与 Tauri plugin 体系不符 |

## 影响

- **正面**：前端与 Rust 之间有清晰契约边界；运行时数据不符合预期立刻可见；便于测试（可注入 fake）。
- **代价**：每个 IPC 命令需要维护入参 / 出参 schema；初期有一定工作量。
- **关联规则**：R-20.4.1 ～ R-20.4.7、R-9.5.*、R-7.2.*
- **关联任务**：T-3.1（本 ADR）、T-3.2（落地实现）

## 相关链接

- [AGENTS.md §9.5 IPC 封装](../../AGENTS.md)
- [AGENTS.md §20.4 服务层作为系统边界](../../AGENTS.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
