# ADR 索引

本目录存放所有架构决策记录（Architecture Decision Record）。

遵循规则：[AGENTS.md R-17.2](../../AGENTS.md)

> **使用规范**
>
> - 新增 ADR 按 `ADR-YYYYMMDD-<slug>.md` 命名，但序号以下表为准。
> - `accepted` 状态的 ADR **禁止**就地修改；推翻须新建 ADR 并标注 `superseded by`。
> - 偏离 AGENTS.md 的决策 MUST 以 ADR 形式沉淀，MUST NOT 仅存 PR 描述。

---

## ADR 清单

| 序号                                                                          | 标题                                                             | 状态         | 日期       | 关联任务      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------ | ---------- | ------------- |
| [ADR-0001](./ADR-0001-startup-single-source.md)                               | 启动真源选 B（App.vue 协调）                                     | `accepted`   | 2026-04-21 | T-1.2 / T-2.7 |
| [ADR-0002](./ADR-0002-dependency-baseline.md)                                 | 依赖基线一次性补齐                                               | `accepted`   | 2026-04-21 | T-1.3         |
| [ADR-0003](./ADR-0003-static-guards-exemptions.md)                            | 静态守卫与存量豁免机制                                           | `accepted`   | 2026-04-21 | T-1.4 / T-1.5 |
| [ADR-0004](./ADR-0004-csp-strategy.md)                                        | CSP 策略（dev/prod 双套）                                        | `accepted`   | 2026-04-21 | T-1.7         |
| [ADR-0005](./ADR-0005-capability-domain-split.md)                             | Tauri capability 按 5 域拆分                                     | `accepted`   | 2026-04-21 | T-1.8         |
| [ADR-0006](./ADR-0006-router-dormant.md)                                      | `src/router/` 休眠处置                                           | `superseded` | 2026-04-21 | T-1.8         |
| [ADR-0007](./ADR-0007-ipc-acl-contract.md)                                    | IPC 反腐层契约                                                   | `proposed`   | 2026-04-21 | T-3.1 / T-3.2 |
| [ADR-0008](./ADR-0008-session-restore.md)                                     | Session Restore（SR）落地                                        | `proposed`   | 2026-04-22 | SR            |
| [ADR-20260422](./ADR-20260422-window-resize-tearing.md)                       | 窗口 resize 底色与重绘抑制缓解                                   | `proposed`   | 2026-04-22 | Window resize |
| [ADR-20260423](./ADR-20260423-vendor-wry-visual-hosting.md)                   | Vendor Wry/Tauri runtime 接入 WebView2 visual hosting            | `accepted`   | 2026-04-23 | Window resize |
| [ADR-20260423-B](./ADR-20260423-visual-hosting-nchittest-and-nobackground.md) | Visual Hosting resize 链路修复：边框命中与 DComp 背景层          | `accepted`   | 2026-04-23 | Window resize |
| [ADR-20260423-C](./ADR-20260423-standard-window-resize-redirection-bitmap.md) | 回到标准 windowed hosting：redirection bitmap + 前端 resize 减载 | `accepted`   | 2026-04-23 | Window resize |
| [ADR-20260423-W](./ADR-20260423-welcome-smil-svg.md)                          | 欢迎页改为 SMIL SVG + 受限 welcome 路由                          | `accepted`   | 2026-04-23 | Welcome       |
| [ADR-20260425](./ADR-20260425-terminal-dual-pty.md)                           | 终端双 PTY 模型                                                  | `superseded` | 2026-04-25 | Terminal      |
| [ADR-20260506](./ADR-20260506-wsl-link-vsock-grpc-quic.md)                   | WSL Link 单通道可靠连接                                          | `proposed`   | 2026-05-06 | WSL Link      |

---

_模板：[\_TEMPLATE.md](./_TEMPLATE.md)_
