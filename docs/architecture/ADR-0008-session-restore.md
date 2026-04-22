# ADR-0008 Session Restore（SR）落地

- **日期**：2026-04-22
- **状态**：`proposed`
- **决策者**：@xiaojianc

---

## 背景

当前工作台重启后不会恢复上次会话状态（工作区、tab、激活项、Monaco 视图态），与 SR 方案目标不一致。

同时需满足：

- R-8.5.1：持久化必须通过 `pinia-plugin-persistedstate`
- R-9.1.1：存储访问必须经 services 单一出口
- R-18.11.1 / R-20.1.2：恢复编排必须在 `useWorkbench` façade
- R-3.2.2 / R-3.8.1：外部输入（会话文件）必须运行时校验

## 决策

1. 会话最终存储后端采用 `@tauri-apps/plugin-store` + `tauri-plugin-store`。
2. 新增 `src/services/sessionStore.ts` 作为会话读写唯一出口。
3. 使用 `pinia-plugin-persistedstate` + `src/store/plugins/tauriSessionStorage.ts` 异步适配器：
   - 启动前 `hydrateSessionStorage()` 预读缓存
   - `setItem` 防抖落盘
4. `useEditorStore` 新增 `sessionSnapshot` 并仅持久化该字段。
5. `useWorkbench` 新增 `restoreSession()` / `flushSession()`：
   - 恢复工作区合法性
   - 过滤失效 tab
   - 回退激活 tab
6. `ScriptEditor.vue` 在组件内完成 Monaco `saveViewState/restoreViewState`。
7. 关闭应用前在生命周期中执行 1 秒超时 flush，失败不阻塞退出。
8. 新增 capability：`src-tauri/capabilities/session.json`，授予 store 精确权限。

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 直接 `localStorage` 持久化 session | 违反 R-7.7.2 / SR 约束 |
| 组件内直接调用 store plugin | 违反 R-9.1.1 单一出口 |
| 在视图层编排恢复流程 | 违反 R-20.1.1 / R-18.11.1 |

## 影响

- **正面**：启动可恢复会话；恢复失败可降级；会话读写边界清晰。
- **代价**：新增 store 插件依赖与 capability；增加少量启动读取开销。
- **关联规则**：R-3.8.1、R-8.5.1、R-9.1.1、R-18.11.1、R-20.1.2

## 相关链接

- [SR 实施方案](../../reports/ai-polish-2026-04-20.md)
- [AGENTS.md](../../AGENTS.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
