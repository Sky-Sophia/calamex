# 环境变量清单

> 按 R-13.5.4：环境变量清单 MUST 在此登记；未登记 MUST NOT 使用。
> 按 R-4.3.2：VITE_* 变量 MUST 在 `src/types/env.d.ts` 同步声明。

---

## 变量清单

| 变量名 | 类型 | 默认值 | 环境 | 描述 | 登记人 |
|---|---|---|---|---|---|
| （当前暂无 VITE_* 环境变量）| - | - | - | - | - |

---

## 说明

- 所有 `VITE_*` 变量 **会** 打入前端产物，MUST NOT 含密钥/令牌/内部地址
- 非 `VITE_` 前缀的变量仅 Node 构建脚本可读，不进产物
- 密钥/凭证 MUST NOT 在此登记，MUST 存 CI Secret 或 Tauri stronghold

---

## 变量模板示例

```
VITE_APP_VERSION     = 1.0.0        # 应用版本展示
VITE_DEV_SERVER_PORT = 1420         # 开发服务器端口（仅 dev）
```

---

> 新增环境变量 MUST 在同一 PR 内同步更新本文件 + `src/types/env.d.ts`。
