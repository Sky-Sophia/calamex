# 技术债务登记

> 按 R-17.3.5：`TODO`/`FIXME` MUST 带责任人 + 截止日期。
> 按 R-3.2.1：any 豁免 MUST 在此登记含截止日期。

---

## 格式

```
| ID | 描述 | 责任人 | 截止迭代 | ADR/规则 | 状态 |
```

---

## 活跃条目

> 行数类债务（R-20.1.\* / R-20.5.\* / R-20.6.\*）以 `scripts/baselines/file-size.json` 为机器校验真相源：`scripts/check-file-size.ts` 已改为全量扫描 `src/`、`src-tauri/src/`，超限且无豁免的文件会直接使 `pnpm guard` 失败。新增或变更豁免后请同步本表。

| ID      | 描述                                                                                                                    | 责任人    | 截止迭代   | 规则                                      | 状态        |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | --------- | ---------- | ----------------------------------------- | ----------- |
| TD-0001 | `useWorkbench.ts` 行数超 R-20.1.3 限(≤400)                                                                              | xiaojianc | 2026-06-30 | R-20.1.3                                  | 🔴 豁免期内 |
| TD-0002 | `ShellWorkbenchView.vue` `<script setup>` 超 R-20.1.4 限(≤120)                                                          | xiaojianc | 2026-06-30 | R-20.1.4                                  | 🔴 豁免期内 |
| TD-0003 | `useIntegratedTerminal.ts` 待按 R-20.2.1 拆分为 session + registry                                                      | xiaojianc | 2026-06-30 | R-20.2.\*                                 | 🔴 豁免期内 |
| TD-0004 | `main.ts` 内联 DOM 超 R-20.6.3 限(≤120)                                                                                 | xiaojianc | 2026-06-30 | R-20.6.3                                  | 🔴 豁免期内 |
| TD-0005 | `commands/mod.rs` 超 R-20.5.1 限(≤80)                                                                                   | xiaojianc | 2026-08-31 | R-20.5.1                                  | 🔴 豁免期内 |
| TD-0006 | `style-src 'unsafe-inline'` CSP 放宽，需迁移到 nonce(参见 ADR-0004)                                                     | xiaojianc | 2026-08-31 | R-7.5.2                                   | 🟡 已登记   |
| TD-0007 | 路由已按 ADR-20260423-welcome-smil-svg 受限启用（welcome/home），后续需持续防止业务路由无 ADR 膨胀                     | xiaojianc | 按需       | ADR-20260423-welcome-smil-svg             | 🟡 观察中   |
| TD-0008 | 若未来切换到无边框自绘标题栏，需替代 ADR-20260422 的原生边框底色治理路径并重新评估 resize 行为                          | xiaojianc | 按需       | ADR-20260422-window-resize-tearing        | 🟡 观察中   |
| TD-0009 | `pnpm lint` 仍存在既有 Vue `first-attribute-linebreak` 格式 warning，需独立格式化修复，避免混入 visual-hosting 原子提交 | xiaojianc | 2026-06-30 | G-5 / R-17.3.5                            | 🟡 已登记   |
| TD-0010 | 最大化 / 全屏态下无边框窗口 hit test 仍沿用系统默认路径，尚未覆盖 `HTMAXBUTTON`、Snap Layout 提示与边缘吸附等特例       | xiaojianc | 2026-07-31 | R-T.4.3 / R-17.3.5                        | 🟡 已登记   |
| TD-0011 | SMIL 弃用跟踪。若 Chrome / WebView2 公布下线路线图，需启动欢迎页 Lottie / WAAPI 迁移评估                                | xiaojianc | 2027-01-01 | ADR-20260423-welcome-smil-svg / RISK-W-01 | 🟡 已登记   |
| TD-0012 | 欢迎页浅色主题版本待美术交付；当前仅实现深色欢迎页                                                                      | xiaojianc | 2026-09-30 | ADR-20260423-welcome-smil-svg             | 🟡 已登记   |
| TD-0014 | `commands/search.rs` (~65KB) 超 R-20.5.\*(≤800)，灯下黑补登，待按 query/match/replace 子域拆分                          | xiaojianc | 2026-12-31 | R-20.5.\*                                 | 🔴 豁免期内 |
| TD-0015 | `commands/ssh.rs` (~63KB) 超 R-20.5.\*(≤800)，灯下黑补登，待按连接/传输/凭证拆分                                        | xiaojianc | 2026-12-31 | R-20.5.\*                                 | 🔴 豁免期内 |
| TD-0017 | `commands/lsp.rs` (~44KB) 超 R-20.5.\*(≤800)，灯下黑补登，待按生命周期/能力拆分                                         | xiaojianc | 2026-12-31 | R-20.5.\*                                 | 🔴 豁免期内 |
| TD-0018 | `services/tauri.ts` (~48KB) 前端 ACL facade 巨石，灯下黑补登，待按域 re-export 拆分                                     | xiaojianc | 2026-12-31 | R-20.1.\* / ADR-0007                      | 🔴 豁免期内 |
| TD-0019 | `store/editor.ts` (~32KB) 超 R-20.1.\*(≤400)，灯下黑补登，待按 state/actions 拆分                                       | xiaojianc | 2026-12-31 | R-20.1.\*                                 | 🔴 豁免期内 |
| TD-0020 | `store/aiAgent.ts` (~27KB) 超 R-20.1.\*(≤400)，灯下黑补登，待按会话/计划/执行拆分                                       | xiaojianc | 2026-12-31 | R-20.1.\*                                 | 🔴 豁免期内 |
| TD-0021 | `styles.css` (~115KB) 单文件 CSS 几乎无模块化，灯下黑补登，待按 @layer/组件样式拆分                                     | xiaojianc | 2026-12-31 | R-20.1.\*                                 | 🔴 豁免期内 |

---

## 已关闭条目

| ID      | 描述                                                                                              | 责任人    | 截止迭代   | 规则                                      | 状态      |
| ------- | ------------------------------------------------------------------------------------------------- | --------- | ---------- | ----------------------------------------- | --------- |
| TD-0013 | AED retention / prune 已落地，`ai.edit.pruned` 审计事件会在自动清理超出窗口的本地历史时触发       | xiaojianc | 2026-07-31 | ADR-20260428-agent-auto-edit-and-rollback / R-14.5.* | ✅ 已关闭 |
| TD-0016 | `commands/contracts.rs` (~52KB) IPC 契约耦合中心已按域拆为 `commands/contracts/`（secret/script/workspace/ssh/ai_chat/ai_config/ai_edit/ai_agent/agent_sidecar + mod re-export），公共路径 `commands::contracts::*` 与 specta 输出不变 | xiaojianc | 2026-06-02 | R-20.5.\* / ADR-0007                      | ✅ 已关闭 |
