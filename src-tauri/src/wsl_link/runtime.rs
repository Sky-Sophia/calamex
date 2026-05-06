use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{sync::watch, task::JoinHandle};

use super::{
    config::WslLinkTransportConfig,
    grpc_transport::WslLinkGrpcHeartbeatAck,
    manager::WslLinkManager,
    noise_material::WslLinkDesktopNoiseMaterial,
    primary_supervisor::WslLinkPrimarySupervisor,
    state_machine::WslLinkConnectionState,
    types::{now_unix_ms, WslLinkMetrics, WslLinkTransportKind, DEFAULT_PROTOCOL_VERSION},
};

pub const WSL_LINK_STATE_CHANGED_EVENT: &str = "wsl-link:state-changed";
const WSL_LINK_SUPERVISOR_CLIENT_ID: &str = "calamex-desktop";

struct WslLinkSupervisorTask {
    shutdown_tx: watch::Sender<bool>,
    task: JoinHandle<()>,
}

struct WslLinkRuntimeInner {
    manager: WslLinkManager,
    supervisor_task: Option<WslLinkSupervisorTask>,
    session_id: Option<String>,
    supervisor_started_at_unix_ms: Option<u64>,
    last_heartbeat_at_unix_ms: Option<u64>,
    next_retry_in_ms: Option<u64>,
}

impl Default for WslLinkRuntimeInner {
    fn default() -> Self {
        Self {
            manager: WslLinkManager::default(),
            supervisor_task: None,
            session_id: None,
            supervisor_started_at_unix_ms: None,
            last_heartbeat_at_unix_ms: None,
            next_retry_in_ms: None,
        }
    }
}

#[derive(Default)]
pub struct WslLinkRuntimeState {
    inner: Mutex<WslLinkRuntimeInner>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkStatusPayload {
    pub state: WslLinkConnectionState,
    pub maturity: &'static str,
    pub protocol_version: &'static str,
    pub primary_transport: WslLinkTransportKind,
    pub vsock_grpc_port: u32,
    pub supervisor_running: bool,
    pub session_id: Option<String>,
    pub supervisor_started_at_unix_ms: Option<u64>,
    pub last_heartbeat_at_unix_ms: Option<u64>,
    pub next_retry_in_ms: Option<u64>,
    pub metrics: WslLinkMetrics,
    pub note: &'static str,
}

impl WslLinkRuntimeState {
    pub fn start_supervisor(
        &self,
        app: AppHandle,
        desktop_material: WslLinkDesktopNoiseMaterial,
    ) -> Result<bool, String> {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let mut should_emit = false;
        let started = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());

            prune_finished_supervisor(&mut inner);
            if inner.supervisor_task.is_some() {
                false
            } else {
                inner
                    .manager
                    .begin_manual_connect_attempt()
                    .map_err(|error| error.to_string())?;
                inner.supervisor_started_at_unix_ms = Some(now_unix_ms());
                inner.last_heartbeat_at_unix_ms = None;
                inner.next_retry_in_ms = None;
                inner.session_id = None;
                let task_app = app.clone();
                let task = tokio::spawn(async move {
                    run_supervisor_loop(task_app, desktop_material, shutdown_rx).await;
                });
                inner.supervisor_task = Some(WslLinkSupervisorTask { shutdown_tx, task });
                should_emit = true;
                true
            }
        };

        if should_emit {
            self.emit_status(&app);
        }

        Ok(started)
    }

    pub fn stop_supervisor(&self, app: &AppHandle) -> Result<bool, String> {
        let stopped = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(task) = inner.supervisor_task.take() else {
                return Ok(false);
            };

            let _ = task.shutdown_tx.send(true);
            task.task.abort();
            inner.manager.stop().map_err(|error| error.to_string())?;
            inner.session_id = None;
            inner.supervisor_started_at_unix_ms = None;
            inner.last_heartbeat_at_unix_ms = None;
            inner.next_retry_in_ms = None;
            true
        };

        self.emit_status(app);
        Ok(stopped)
    }

    pub fn begin_connect_attempt(&self) -> Result<WslLinkTransportConfig, String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .begin_manual_connect_attempt()
            .map_err(|error| error.to_string())?;
        Ok(inner.manager.config())
    }

    pub fn record_connect_success(&self, transport: WslLinkTransportKind) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_handshake_ok(transport)
            .map_err(|error| error.to_string())
    }

    pub fn record_connect_failure(&self, error_message: String) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_connect_error(error_message)
            .map_err(|error| error.to_string())
    }

    fn record_supervisor_connecting(&self) -> Result<WslLinkTransportConfig, String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .begin_manual_connect_attempt()
            .map_err(|error| error.to_string())?;
        inner.next_retry_in_ms = None;
        Ok(inner.manager.config())
    }

    fn record_supervisor_connected(
        &self,
        session_id: String,
        transport: WslLinkTransportKind,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_handshake_ok(transport)
            .map_err(|error| error.to_string())?;
        inner.session_id = Some(session_id);
        inner.next_retry_in_ms = None;
        Ok(())
    }

    fn record_supervisor_heartbeat(
        &self,
        transport: WslLinkTransportKind,
        heartbeat: &WslLinkGrpcHeartbeatAck,
        rtt_ms: u64,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner
            .manager
            .record_heartbeat_ack(
                transport,
                heartbeat.ack_client_seq,
                heartbeat.server_seq,
                rtt_ms,
            )
            .map_err(|error| error.to_string())?;
        inner.last_heartbeat_at_unix_ms = Some(now_unix_ms());
        inner.next_retry_in_ms = None;
        Ok(())
    }

    fn record_supervisor_failure(
        &self,
        error_message: String,
        next_retry: Duration,
    ) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = inner.manager.mark_heartbeat_miss();
        let _ = inner.manager.mark_heartbeat_dead();
        inner
            .manager
            .record_connect_error(error_message)
            .map_err(|error| error.to_string())?;
        inner.session_id = None;
        inner.next_retry_in_ms = Some(duration_ms(next_retry));
        Ok(())
    }

    pub fn snapshot(&self) -> WslLinkStatusPayload {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        prune_finished_supervisor(&mut inner);
        let config = inner.manager.config();
        let metrics = inner.manager.metrics();

        WslLinkStatusPayload {
            state: inner.manager.state(),
            maturity: "yellow",
            protocol_version: DEFAULT_PROTOCOL_VERSION,
            primary_transport: config.primary_transport(),
            vsock_grpc_port: config.vsock_grpc_port,
            supervisor_running: inner
                .supervisor_task
                .as_ref()
                .is_some_and(|task| !task.task.is_finished()),
            session_id: inner.session_id.clone(),
            supervisor_started_at_unix_ms: inner.supervisor_started_at_unix_ms,
            last_heartbeat_at_unix_ms: inner.last_heartbeat_at_unix_ms,
            next_retry_in_ms: inner.next_retry_in_ms,
            metrics,
            note: "WSL Link 当前收敛为单通道：AF_HYPERV/AF_VSOCK + tonic gRPC + HTTP/2 keepalive + Noise_KKpsk2 握手。已接入 WSL agent、用户态安装/启动、主通道探测、后台 supervisor 重连 loop、默认脚本执行和默认 WSL2 smoke；交互终端切流仍需验证。",
        }
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit(WSL_LINK_STATE_CHANGED_EVENT, self.snapshot());
    }
}

async fn run_supervisor_loop(
    app: AppHandle,
    desktop_material: WslLinkDesktopNoiseMaterial,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let config = WslLinkTransportConfig::default();
    let mut supervisor = WslLinkPrimarySupervisor::new(WSL_LINK_SUPERVISOR_CLIENT_ID, config);

    loop {
        if *shutdown_rx.borrow() {
            return;
        }

        let state = app.state::<WslLinkRuntimeState>();
        let config = match state.record_supervisor_connecting() {
            Ok(config) => config,
            Err(error) => {
                let delay = supervisor.record_connect_failure();
                let _ = state.record_supervisor_failure(error, delay);
                state.emit_status(&app);
                if wait_or_shutdown(delay, &mut shutdown_rx).await {
                    return;
                }
                continue;
            }
        };
        state.emit_status(&app);

        let open_started_at = Instant::now();
        match supervisor.open_noise_connection(&desktop_material).await {
            Ok(mut connection) => {
                let session_id = connection.session.session_id.clone();
                let transport = connection.session.transport;
                if let Err(error) = state.record_supervisor_connected(session_id, transport) {
                    let delay = supervisor.record_connect_failure();
                    let _ = state.record_supervisor_failure(error, delay);
                    state.emit_status(&app);
                    if wait_or_shutdown(delay, &mut shutdown_rx).await {
                        return;
                    }
                    continue;
                }
                state.emit_status(&app);

                loop {
                    if wait_or_shutdown(config.grpc_keepalive_interval, &mut shutdown_rx).await {
                        return;
                    }

                    let heartbeat_started_at = Instant::now();
                    match supervisor.heartbeat(&mut connection).await {
                        Ok(heartbeat) => {
                            let rtt_ms = duration_ms(heartbeat_started_at.elapsed());
                            let state = app.state::<WslLinkRuntimeState>();
                            let _ =
                                state.record_supervisor_heartbeat(transport, &heartbeat, rtt_ms);
                            state.emit_status(&app);
                        }
                        Err(error) => {
                            let delay = supervisor.record_connect_failure();
                            let state = app.state::<WslLinkRuntimeState>();
                            let _ = state.record_supervisor_failure(error.to_string(), delay);
                            state.emit_status(&app);
                            if wait_or_shutdown(delay, &mut shutdown_rx).await {
                                return;
                            }
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                let delay = supervisor.record_connect_failure();
                let state = app.state::<WslLinkRuntimeState>();
                let elapsed_ms = duration_ms(open_started_at.elapsed());
                let message = format!("{error}；握手耗时 {elapsed_ms} ms。");
                let _ = state.record_supervisor_failure(message, delay);
                state.emit_status(&app);
                if wait_or_shutdown(delay, &mut shutdown_rx).await {
                    return;
                }
            }
        }
    }
}

async fn wait_or_shutdown(duration: Duration, shutdown_rx: &mut watch::Receiver<bool>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        changed = shutdown_rx.changed() => changed.is_ok() && *shutdown_rx.borrow(),
    }
}

fn prune_finished_supervisor(inner: &mut WslLinkRuntimeInner) {
    if inner
        .supervisor_task
        .as_ref()
        .is_some_and(|task| task.task.is_finished())
    {
        inner.supervisor_task = None;
        inner.session_id = None;
        inner.supervisor_started_at_unix_ms = None;
        inner.last_heartbeat_at_unix_ms = None;
        inner.next_retry_in_ms = None;
    }
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}
