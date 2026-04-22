# 审计事件清单

> 按 R-14.5.3：审计事件清单 MUST 维护于本文件。
> 审计日志与运行日志分离存储，保留 ≥180 天，仅安全/运维可读。

---

## 格式

```
| 事件名 | 触发条件 | 关键字段 | 审计级别 |
```

---

## git 域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `git.commit` | 用户执行提交 | `traceId`, `message_length`, `staged_count`, `workspace_path` | HIGH |
| `git.stage` | 暂存文件 | `traceId`, `file_count`, `workspace_path` | MEDIUM |
| `git.unstage` | 取消暂存 | `traceId`, `file_count` | MEDIUM |

---

## 设置/配置域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `settings.workspace_changed` | 工作区根路径变更 | `traceId`, `new_path_hash` | HIGH |
| `settings.theme_changed` | 主题切换 | `traceId`, `from_mode`, `to_mode` | LOW |

---

## 窗口/会话域

| 事件名 | 触发条件 | 关键字段 | 级别 |
|---|---|---|---|
| `app.startup` | 应用启动 | `traceId`, `version`, `platform` | MEDIUM |
| `app.shutdown` | 应用退出（正常）| `traceId`, `session_duration_s` | MEDIUM |
| `terminal.session_create` | PTY 会话创建 | `traceId`, `session_id` | MEDIUM |
| `terminal.session_close` | PTY 会话关闭 | `traceId`, `session_id`, `exit_code` | MEDIUM |

---

> 新增高权限操作 MUST 在同一 PR 内将审计事件补充到本表。
