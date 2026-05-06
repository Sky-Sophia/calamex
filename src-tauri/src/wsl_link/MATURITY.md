---
status: yellow
owner: xiaojianc
updated: 2026-05-06
---

# WSL Link 成熟度

## 当前状态

`yellow`：WSL Link 已收敛为单通道方案，当前只推进 `AF_HYPERV` / `AF_VSOCK` + tonic gRPC、HTTP/2 keepalive、Noise_KKpsk2 握手、指数退避重连、session / client_seq 去重和 AED 快照边界。QUIC fallback、WAL outbox 与双通道 hedged 不再作为路线目标。

当前阶段只允许提供状态机、退避策略、协议契约、gRPC keepalive 配置、WSL agent 协议服务、agent 启动配置解析、agent 用户目录安装计划、分发命令规格、stdin payload 执行器、`install_wsl_link_agent` / `start_wsl_link_agent` 显式确认入口、`get_wsl_link_agent_artifact_status` artifact 诊断入口、`probe_wsl_link_primary` 握手探测入口、`start_wsl_link_supervisor` / `stop_wsl_link_supervisor` 常驻连接入口、`wsl-link:state-changed` 状态事件、Windows Hyper-V socket 地址构造、connect timeout、tonic 自定义 connector、OpenSession 请求 / 响应校验、Noise 密钥材料生成 / 桌面侧存储、只读环境探测、状态 UI，以及默认 WSL Link 脚本执行通路。交互终端长期 PTY session 尚未切流，不得伪装为已替换。

## 关键缺口

- Windows `AF_HYPERV` 主通道已完成 Service GUID 映射、`SOCKADDR_HV` 构造、VM GUID 文本解析、`hcsdiag list` 输出解析、WinSock socket 创建、非阻塞 connect、timeout、Tokio stream 转换、tonic Channel connector，以及 Noise + OpenSession 请求 / 响应校验和执行器；`probe_wsl_link_primary` 会实际发起主通道 Noise_KKpsk2 + tonic OpenSession 握手，并追加一次 session heartbeat RPC，成功后将 runtime 状态推进到 Ready 或 Backoff。当前机器默认 WSL2 发行版已完成一次真实 smoke：用户态安装、后台启动、`AF_VSOCK` listener、Windows `AF_HYPERV` 连接、server proof 校验和 heartbeat ack 均通过。尚未完成多发行版、休眠恢复、WSL 重启、并发压测和生产切流矩阵。
- Linux WSL agent 已新增 `src/bin/wsl_link_agent.rs` 入口、`OpenSession / OpenNoiseSession / ResumeSession / Heartbeat / Duplex` 服务实现，以及默认配置路径 / 环境变量 / `--noise-config` 启动解析；agent 端写请求去重主键已收敛为 `(session_id, client_seq)`。桌面侧已补用户态分发计划，使用 `~/.local/share/calamex/wsl-link` 与 `~/.config/calamex/wsl-link`，支持 prepare / 写 agent binary / 写 Noise config / verify / 后台 start 的 `wsl.exe -- sh -lc` 命令规格、stdin payload 执行器、`install_wsl_link_agent` 显式确认入口、`start_wsl_link_agent` 后台启动入口和 `get_wsl_link_agent_artifact_status` artifact 诊断入口。已新增 `pnpm wsl-link:agent:build` 从 WSL 内构建 Linux agent artifact，并通过 `wsl-link-agent` Cargo feature 避免 Linux agent 构建拉入 Tauri / GTK / OpenSSL 桌面链路；当前已产出并安装真机 artifact。
- `check_wsl_link_environment` 已提供只读自检，覆盖 WSL 版本、默认发行版、发行版列表和 `vmcompute` 服务；`.wslconfig` mirrored networking 只作为信息字段返回，不再影响 WSL Link 单通道可用性。运行侧栏已接入状态 / 环境 / artifact / 安装 / agent 启动 / 常驻连接启动停止入口，并通过 `wsl-link:state-changed` 镜像后台心跳状态；仍需多场景真机矩阵记录。
- 自动重连 loop 已接入 yellow 阶段运行时：supervisor 会保留握手后的 tonic client、维护 `last_client_seq / last_ack_server_seq`、按 keepalive 周期发送 session heartbeat RPC、应用 ack、记录 RTT、失败后按指数退避重连，并在停止时清理后台任务。
- 脚本执行已默认切到 WSL Link Duplex 通路：桌面端复用既有 `dispatch_script_to_terminal` 入口，把 `terminal.runScript.v1` payload 发送给 agent；agent 在 Linux 内写临时脚本、启动 `/usr/bin/setsid --wait /bin/bash --noprofile --norc`，并以 `RunStarted / RunChunk / RunCompleted / RunError` 事件回填现有终端事件。RunStarted 会记录 agent 侧 pid，取消操作会按进程组发 `TERM` / `KILL`。当前已通过默认 WSL2 真机 smoke，包含中文输出和 exit code 断言。旧 `wsl.exe` per-run rPTY 执行器、临时脚本写入分支和 feature flag 已删除；交互终端 PTY session 尚未切流。

## 升级条件

- 单通道主链路通过多发行版、休眠恢复、WSL 重启和并发压测矩阵。
- 自动重连 loop 与状态事件通过休眠恢复、WSL 重启和 agent kill E2E 断线恢复测试。
- 终端 / 脚本执行通过多发行版、休眠恢复、WSL 重启、连续运行和取消场景回归。
- 交互终端长期 PTY session 可通过 WSL Link 切换，并补齐 stdin / resize / cancel 等运行期能力。
- WSL 用户态安装入口、桌面 keyring 存储和日志脱敏通过审查。
