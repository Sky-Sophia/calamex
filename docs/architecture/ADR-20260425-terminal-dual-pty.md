# ADR-20260425 终端双 PTY 模型

- **日期**：2026-04-25
- **状态**：`accepted`
- **决策者**：Calamex maintainers

---

## 背景

Windows + WSL2 环境下，原有集成终端把交互 shell 与脚本运行 child 共享同一对 PTY slave。该模型导致：

- run 完成后 prompt 与光标位置依赖交互 shell 的异步 repaint，容易出现“输出后必须按 Enter 才回 prompt”和中间空白行。
- 运行完成曾依赖 OSC marker / 字节流 marker，在 ConPTY 互操作链路上不可靠。
- iPTY 当前目录、环境变量、控制字符可能污染 run；Ctrl+C 作用范围也不清晰。
- resize 后 iPTY repaint 会把 sudo 提示、prompt 等历史视觉帧重新混入 xterm 视觉面。

不做改造的代价是：终端视觉流、RunReport 语义流和状态机继续互相污染，后续无法稳定承载取消、连续运行、HMR 重连和真机回归矩阵。

## 决策

采用双 PTY 模型：

1. **xterm 单例不变**：前端仍只维护一个 xterm 实例，符合 R-18.4.1。
2. **iPTY 长寿命**：交互 bash 为 login + interactive，跨前端 epoch 存活，前端重连不重复 spawn。
3. **rPTY per-run**：每次运行新建独立 rPTY，完成后销毁；同一时刻最多一个 active rPTY。
4. **rPTY shell**：使用 `bash --noprofile --norc` 执行临时脚本，避免 MOTD / rc 污染。
5. **完成判定**：只看 Rust 侧 `child.wait()` / rPTY wait 结果，不再写入或解析 OSC marker。
6. **状态权威**：Rust 维护 `Booting / IdleInteractive / SwitchingToRun / Running / SwitchingToIdle` 五态状态机，前端只镜像 `terminal:state-changed`。
7. **双通道事件**：
   - `terminal:data`：xterm 视觉流，可包含 run 输出、reset、separator、prompt。
   - `terminal:run-chunk`：RunReport 语义流，只包含脚本 stdout/stderr 字节。
8. **视觉注入隔离**：ANSI reset 与可选 separator 只走视觉流，不进入 RunReport。
9. **run 隔离**：cwd 固定为工作区根；env 显式构造并强制 `LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color`，不继承 iPTY export / cwd。
10. **取消语义**：run 取消只作用于当前 rPTY child 进程组。
11. **resize 语义**：resize 同步到 iPTY 与当前 rPTY；WSL rPTY 额外用 sideband `stty rows/cols` 修正 `/dev/pts/*` winsize。

固定 IPC / 事件名：

- `terminal:data`
- `terminal:run-chunk`
- `terminal:run-started`
- `terminal:run-completed`
- `terminal:interactive-ready`
- `terminal:interactive-exited`
- `terminal:state-changed`

## 考虑的备选

| 备选 | 优点 | 缺点 | 否决原因 |
|------|------|------|----------|
| 继续单 PTY + marker | 改动少 | ConPTY 下 OSC / shell integration 不可靠；视觉与语义仍污染 | 无法稳定修复 prompt 错位、空白行、RunReport 污染 |
| 单 PTY + 前端视觉补丁 | UI 可短期变好 | 根因仍在共享 PTY 和异步 repaint；resize / HMR 易回归 | 属于掩盖真实事件流问题 |
| 双 xterm + 双 PTY | 隔离更直观 | 破坏 xterm 单例契约，滚动/焦点/主题复杂度高 | 违反 R-18.4.1 |
| 双 PTY + xterm 单例 | 状态隔离强，视图契约不变 | Rust 编排复杂度上升 | 采纳 |

## 影响

- **正面影响**：
  - prompt 由 Rust 在 `running → idle` 收口时注入视觉流，避免 run 后“按 Enter 才回 prompt”。
  - RunReport 只来自 `terminal:run-chunk`，不含 reset / separator / prompt。
  - iPTY 的 cwd/env 与 run 隔离，连续运行不累积污染。
  - Ctrl+C / cancel 收敛到当前 run 范围。
  - resize 后 suppress iPTY repaint，避免 sudo 提示和 prompt 垃圾帧回灌。
- **负面影响 / 代价**：
  - Rust 侧维护 PTY registry、状态机、rPTY lifecycle，复杂度高于单 PTY。
  - iPTY 异常退出后暂不自动重启，需要 UI 提示用户手动重连。
  - switching 瞬态期间输入可能被 200ms 缓冲后丢弃。
- **关联规则**：R-18.4.x、R-20.4、R-20.9、R-13.1
- **关联任务**：终端双 PTY 改造阶段 A/B/C

## R-18.4 条目收敛

| 条目 | 决议 |
| --- | --- |
| R-18.4.1 | xterm 单例不变 |
| R-18.4.2 | 运行入口统一为 `dispatch_script_to_terminal`，完成由 Rust child wait 收口 |
| R-18.4.3 | 命令清单：`ensure_terminal_session`、`dispatch_script_to_terminal`、`cancel_terminal_run`、`write_terminal_input`、`resize_terminal_session`、`close_terminal_session` |
| R-18.4.4 | resize debounce 不低于 100ms |
| R-18.4.5 | session close 释放 PTY |
| R-18.4.6 | RunReport 仅基于 `terminal:run-chunk` |
| R-18.4.7 | ANSI reset 只进 `terminal:data`，不进 RunReport |
| R-18.4.8 | 1 iPTY 长寿命 + N rPTY per-run，rPTY 使用 `bash --noprofile --norc` |
| R-18.4.9 | Rust 维护 run_id ↔ rPTY child 1:1 映射，同一时刻最多一个 active rPTY |
| R-18.4.10 | Rust 维护五态状态机，前端镜像 |
| R-18.4.11 | idle 输入进 iPTY，running 输入进当前 rPTY，switching 输入短暂缓冲 |
| R-18.4.12 | rPTY child 独立 process group |
| R-18.4.13 | run env 显式构造并强制 locale，不继承 iPTY export |
| R-18.4.14 | run cwd = 工作区根，不继承 iPTY cwd |
| R-18.4.15 | iPTY 跨前端 epoch 存活，前端重连不重复 MOTD |

## 相关链接

- [AGENTS.md](../../AGENTS.md)
- [DESIGN.md](../../DESIGN.md)
- 外部 SSoT：`https://www.notion.so/ec8a91a6674946409602cd1a50d2160b`

## 迁移计划

1. 阶段 A：Rust 双 PTY 骨架与类型落地，feature flag off。
2. 阶段 B：前端双通道接入、RunReport 隔离、视觉 separator 开关、状态镜像。
3. 阶段 C：双 PTY 默认启用，删除 feature flag 与旧单 PTY run child 路径。
4. 阶段 D：观测指标与技术债闭环。

---

> 如需推翻本 ADR，MUST 新建新 ADR 并在本文末尾标注 `superseded by ADR-XXXX`，**禁止**就地修改历史决策。

superseded by [ADR-20260506](./ADR-20260506-wsl-link-vsock-grpc-quic.md)：2026-05-06 起，脚本执行的 per-run PTY 路径由 WSL Link gRPC 流式通道取代；本文仅保留历史决策记录和交互 iPTY 背景。
