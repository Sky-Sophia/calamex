# ADR-20260506 WSL Link 单通道可靠连接

- **日期**：2026-05-06
- **状态**：`proposed`
- **决策者**：Calamex maintainers

---

## 背景

当前桌面端通过 `wsl.exe`、PTY 与 Tauri Event 承载 WSL2 终端和脚本执行。该模型可用，但在高频命令、长会话、休眠恢复和 WSL 重启时，会暴露三个问题：

- 冷启动或反复 spawn 的固定开销不可忽略，影响首包延迟与连续操作吞吐。
- 终端字节流、命令请求和状态事件缺少统一的 session / seq / ack 语义。
- 现有链路缺少常驻 agent、主通道心跳、指数退避重连和可观测的握手探测。

不做决策的代价是：后续 AI 执行、长任务、终端恢复和跨 WSL2 边界的高性能交互会继续绑定在 `wsl.exe` 生命周期上，无法达到“常驻、低延迟、可恢复”的产品体验。

## 决策

采用 **WSL Link** 作为新的 WSL2 通信层，并收敛为一条主链路：

1. **唯一传输通道**：Windows Tauri Rust 侧通过 Hyper-V Socket / `AF_HYPERV` 连接 WSL2 agent，WSL2 Linux 侧以 `AF_VSOCK` 接入，业务协议使用 `tonic` gRPC over HTTP/2。
2. **心跳与断线识别**：gRPC client / server 均开启 HTTP/2 keepalive；心跳失败后进入 `Degraded / Reconnecting / Backoff`。
3. **重连策略**：断线后只走主通道指数退避 + 抖动重连，默认 `base=200ms`、`cap=5s`、`jitter=0.3`。
4. **请求幂等边界**：写请求必须携带 `client_seq`；agent 端按 `(session_id, client_seq)` 缓存响应并去重，重复 seq 只返回首次结果。
5. **恢复边界**：进程内 session 可通过 `ResumeSession(session_id, last_ack_server_seq, last_client_seq)` 恢复；崩溃恢复不在 WSL Link 内做 WAL，交由 AED 快照 / 时间线模型处理。
6. **协议契约**：`proto/wsl-link/v1/wsl_link.proto` 承载 session / seq / ack / trace 字段；`idempotency_key` 暂保留用于兼容与审计，不作为 agent 去重主键。
7. **状态权威**：Rust 侧维护 `Idle / Connecting / Ready / Degraded / Reconnecting / Resuming / Backoff / Closed` 状态机，前端只镜像状态和指标。
8. **观测指标**：登记 `wsl_link_rtt_ms`、`wsl_link_reconnects_total`、`wsl_link_inflight_requests`、`wsl_link_active_transport`。
9. **安全边界**：vsock 通道必须完成应用层握手。安全方案选定为 `Noise_KKpsk2_25519_ChaChaPoly_BLAKE2s`，PSK 位置固定为 2；静态密钥和 PSK 不得进入前端 store。桌面端密钥材料使用系统 keyring 保存，PSK 使用 OS CSPRNG 生成，agent 端材料通过受控配置分发进入 WSL。

明确不推进以下能力：

- mirrored networking / localhost QUIC fallback；
- WAL outbox；
- 双通道 hedged；
- 围绕 fallback 的熔断降级。

当前已完成：协议生成、WSL agent gRPC 服务、Noise 配对材料与 keyring 存储、agent 用户态安装 / 启动、Linux artifact 构建、Windows `AF_HYPERV` 地址 / VM GUID 解析、WinSock 非阻塞 connect、tonic Channel connector、`OpenNoiseSession` server proof 校验、`probe_wsl_link_primary` 主通道握手 + heartbeat 探测、主通道 supervisor 后台 loop、状态事件推送、前端连接 / 停止入口、脚本执行 Duplex 通路默认切到 WSL Link、旧 `wsl.exe` per-run rPTY 执行器删除，以及本机默认 WSL2 发行版 smoke。

## 考虑的备选

| 备选 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 继续 `wsl.exe` per request | 改动最小 | spawn 成本高；缺少 session / seq / ack | 否决 |
| SSH over TCP | 调试简单，生态成熟 | 凭据管理复杂；不适合作为本机 WSL2 主链路 | 否决 |
| mirrored localhost + gRPC / QUIC | 易落地 | 仍走网络栈；会引入第二套通道治理 | 不推进 |
| AF_VSOCK + gRPC only | 延迟低，架构清晰，复杂度可控 | 主通道异常时只能重连 | 采纳 |
| AF_VSOCK + gRPC + QUIC fallback + WAL + hedged | 备援语义完整 | 依赖和实现复杂度明显过高；与 AED 快照职责重叠 | 放弃 |

## 影响

- **正面影响**：
  - WSL agent 常驻，降低首包延迟和连续操作开销。
  - gRPC HTTP/2 keepalive 提供明确断线识别。
  - 单通道重连路径更短，风险集中在 `AF_HYPERV` / `AF_VSOCK` 适配层。
  - `(session_id, client_seq)` 去重能避免重连重发导致写请求重复执行。
  - 崩溃恢复交给 AED 快照，职责边界更清楚。
- **负面影响 / 代价**：
  - 主通道异常时没有 QUIC 备援，必须依赖指数退避、清晰错误提示和人工重试。
  - 仍需要维护 WSL agent binary、用户态安装、Noise 密钥材料分发和日志脱敏。
  - 新增 Rust 运行时依赖：`tonic`、`tonic-prost`、`prost`、`snow`、`getrandom`、`windows-sys`、`hyper-util`，以及 Linux target-specific `tokio-vsock`；复用既有 `keyring` 保存桌面侧密钥材料；build 依赖 `tonic-prost-build` 与 `protoc-bin-vendored` 用于可复现 proto 生成。
- **关联规则**：R-0.2、R-1.2、R-7.4、R-7.7、R-7.10、R-9.3、R-14、R-20.4、R-20.9
- **关联任务**：WSL Link P0/P1/P2/P3

## 迁移计划

1. **P0 协议核心**：状态机、指数退避、proto 契约、session / seq / ack 类型；不替换现有终端链路。已完成。
2. **P1 主通道骨架**：接入 `tonic` / `prost` generated proto、HTTP/2 keepalive、平台 adapter 边界和状态查询。已完成。
3. **P2 WSL agent**：新增 Rust WSL agent 二进制，支持 `OpenSession / OpenNoiseSession / ResumeSession / Heartbeat / Duplex`，并按 `(session_id, client_seq)` 去重。已完成服务实现、启动参数解析、Linux artifact 构建、用户态安装和本机 `AF_VSOCK` listener smoke。
4. **P3 主通道真机化**：Windows 接入 `AF_HYPERV` adapter；Linux agent 接入 `AF_VSOCK` listener；主通道 Noise + OpenSession 探测命令接入运行侧栏。已完成本机默认 WSL2 smoke，待补多发行版、休眠恢复、WSL 重启和并发压测矩阵。
5. **P4 重连管理**：主通道 supervisor 已接入后台运行 loop，能保留握手后的 tonic client、维护 `last_client_seq / last_ack_server_seq`、发送 session heartbeat RPC、应用 ack、计算指数退避 delay、推送 `wsl-link:state-changed` 状态事件，并支持显式停止清理。已完成，待补休眠恢复、WSL 重启和并发压测矩阵。
6. **P5 终端 / 脚本切流**：脚本执行入口已默认通过 `Duplex(ClientFrame/ServerFrame)` 发送 `terminal.runScript.v1` payload，由 WSL agent 在 Linux 内写临时脚本并流式返回 started / chunk / completed。旧 `wsl.exe` per-run rPTY 执行器、临时脚本写入分支和 feature flag 已删除；交互终端长期 PTY session 尚未切流。
7. **P6 观测与安全**：接入日志脱敏、指标面板、压力测试和断线恢复 E2E。

## 相关链接

- [AGENTS.md](../../AGENTS.md)
- [Microsoft Learn: Hyper-V sockets integration services](https://learn.microsoft.com/en-us/virtualization/hyper-v-on-windows/user-guide/make-integration-service)
- [Linux manual page: vsock(7)](https://man7.org/linux/man-pages/man7/vsock.7.html)
