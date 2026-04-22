# 可观测性规范

> 按 R-14.*：生产 MUST 开启错误与性能监控；本文件为字段清单与责任人的单一事实来源。

---

## 错误监控

| 项 | 值 |
|---|---|
| 接入方案 | 待定（Sentry 或等效，发布阶段前 MUST 补齐） |
| 覆盖范围 | 未捕获异常 / unhandledrejection / Vue errorHandler / Router 错误钩子 / services AppError / Rust panic |
| 采样率 | 100%（初始） |
| PII 脱敏 | 用户路径不上报；Token/Key 字段黑名单过滤 |
| 上报阈值告警 | error_rate > 0.1% 通知负责人 |

---

## 日志字段清单

> 按 R-14.1.2：附加字段 MUST 在此登记。

### 必需字段（前端 + Rust）

| 字段 | 类型 | 说明 |
|---|---|---|
| `timestamp` | ISO-8601 | 事件时间 |
| `level` | `error\|warn\|info\|debug` | 级别 |
| `scope` | string | 模块/域标识 |
| `event` | string | 事件名 |
| `traceId` | UUIDv4/ULID | 请求-响应链追踪 ID |

### 可选字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `durationMs` | number | 操作耗时（IPC 调用必填）|
| `cmd` | string | IPC 命令名 |
| `errorCode` | string | AppError.code |
| `inputBytes` | number | 入参字节数 |
| `outputBytes` | number | 出参字节数 |

---

## RUM 指标

> 按 R-14.3.1

| 指标 | 上报方式 |
|---|---|
| 冷启动耗时 | 工作台首帧事件 |
| 首屏 TTI | 工作台挂载完成事件 |
| 关键操作 P95 | ShellCheck 分析 / shfmt 格式化 / Git 状态刷新 |
| JS 堆内存水位 | 每 5 分钟采样 |

---

## 面板与责任人

| 面板 | 链接 | 负责人 |
|---|---|---|
| 错误监控 | 待定 | xiaojianc |
| RUM 性能 | 待定 | xiaojianc |

---

## 审计日志

> 按 R-14.5.2：审计日志与运行日志分离存储，保留 ≥180 天。
> 事件清单详见 [audit-events.md](./audit-events.md)。
