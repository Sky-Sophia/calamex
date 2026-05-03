# 环境变量清单

> 按 R-13.5.4：环境变量清单 MUST 在此登记；未登记 MUST NOT 使用。
> 按 R-4.3.2：VITE_* 变量 MUST 在 `src/types/env.d.ts` 同步声明。

---

## 变量清单

| 变量名 | 类型 | 默认值 | 环境 | 描述 | 登记人 |
|---|---|---|---|---|---|
| AGENT_MCP_UVX_PATH | string | 自动探测 | dev/staging/prod | Windows 下 uvx.exe 绝对路径，供 `git/time/hooks/sqlite` MCP 启动 | Copilot |
| AGENT_MCP_GIT_EXECUTABLE_PATH | string | 自动探测 | dev/staging/prod | Windows 下 git.exe 绝对路径，供 Git MCP 绑定 `GIT_PYTHON_GIT_EXECUTABLE` | Copilot |
| AGENT_MCP_MEMORY_FILE_PATH | string | `%USERPROFILE%/.xiaojianc/mcp-memory.jsonl` | dev/staging/prod | memory MCP 持久化文件路径 | Copilot |
| AGENT_MCP_LOCAL_TIMEZONE | string | Asia/Shanghai | dev/staging/prod | time MCP 本地时区参数 | Copilot |
| GITHUB_MCP_PAT | string(secret) | - | dev/staging/prod | GitHub MCP Server 访问令牌（Bearer） | Copilot |
| GITHUB_MCP_URL | string | https://api.githubcopilot.com/mcp/ | dev/staging/prod | GitHub MCP Server Streamable HTTP 地址 | Copilot |
| SQLITE_DB_PATH | string | - | dev/staging/prod | sqlite-mcp 连接的本地数据库绝对/相对路径 | Copilot |
| SQLITE_READ_ONLY | string(boolean) | true | dev/staging/prod | sqlite-mcp 只读模式开关 | Copilot |
| SQLITE_TIMEOUT | string(number) | 30 | dev/staging/prod | sqlite-mcp 查询超时秒数 | Copilot |
| TAVILY_API_KEY | string(secret) | - | dev/staging/prod | Tavily MCP 的 API Key | Copilot |

---

## 说明

- 所有 `VITE_*` 变量 **会** 打入前端产物，MUST NOT 含密钥/令牌/内部地址
- 非 `VITE_` 前缀的变量仅 Node 构建脚本可读，不进产物
- 密钥/凭证 MUST NOT 在此登记，MUST 存 CI Secret 或 Tauri stronghold
- ADR-20260422-window-resize-tearing 已审阅确认：本方案不新增环境变量

---

## 变量模板示例

```
VITE_APP_VERSION     = 1.0.0        # 应用版本展示
VITE_DEV_SERVER_PORT = 1420         # 开发服务器端口（仅 dev）
```

---

> 新增环境变量 MUST 在同一 PR 内同步更新本文件 + `src/types/env.d.ts`。
