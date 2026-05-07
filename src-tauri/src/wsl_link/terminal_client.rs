use thiserror::Error;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::Request;

use super::{
    config::WslLinkTransportConfig,
    grpc_transport::WslLinkGrpcTransportError,
    noise_material::WslLinkDesktopNoiseMaterial,
    primary_supervisor::{WslLinkPrimarySupervisor, WslLinkPrimarySupervisorError},
    protocol::v1::ClientFrame,
    terminal_exec::{
        decode_terminal_server_payload, encode_terminal_client_payload,
        WslLinkTerminalClientPayload, WslLinkTerminalExecError, WslLinkTerminalInteractiveClose,
        WslLinkTerminalInteractiveInput, WslLinkTerminalInteractiveResize,
        WslLinkTerminalOpenInteractiveRequest, WslLinkTerminalRunInput,
        WslLinkTerminalRunScriptRequest, WslLinkTerminalServerPayload,
        WslLinkTerminalSignalProcess,
    },
    types::now_unix_ms,
};

#[derive(Debug, Error)]
pub enum WslLinkTerminalClientError {
    #[error("WSL Link terminal gRPC 失败：{0}")]
    Grpc(#[from] WslLinkGrpcTransportError),
    #[error("WSL Link terminal supervisor 失败：{0}")]
    Supervisor(#[from] WslLinkPrimarySupervisorError),
    #[error("WSL Link terminal stream 失败：{0}")]
    Status(#[from] tonic::Status),
    #[error("WSL Link terminal payload 失败：{0}")]
    Payload(#[from] WslLinkTerminalExecError),
    #[error("WSL Link terminal 响应 session 不匹配。")]
    SessionMismatch,
    #[error("WSL Link interactive command channel 已关闭。")]
    CommandChannelClosed,
}

#[derive(Debug)]
enum WslLinkInteractiveTerminalCommand {
    Input(WslLinkTerminalInteractiveInput),
    Resize(WslLinkTerminalInteractiveResize),
    Close(WslLinkTerminalInteractiveClose),
}

#[derive(Debug, Clone)]
pub struct WslLinkInteractiveTerminalHandle {
    session_id: String,
    command_tx: mpsc::UnboundedSender<WslLinkInteractiveTerminalCommand>,
}

impl WslLinkInteractiveTerminalHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn write_input(&self, data: String) -> Result<(), WslLinkTerminalClientError> {
        self.command_tx
            .send(WslLinkInteractiveTerminalCommand::Input(
                WslLinkTerminalInteractiveInput {
                    session_id: self.session_id.clone(),
                    data,
                },
            ))
            .map_err(|_| WslLinkTerminalClientError::CommandChannelClosed)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), WslLinkTerminalClientError> {
        self.command_tx
            .send(WslLinkInteractiveTerminalCommand::Resize(
                WslLinkTerminalInteractiveResize {
                    session_id: self.session_id.clone(),
                    cols,
                    rows,
                },
            ))
            .map_err(|_| WslLinkTerminalClientError::CommandChannelClosed)
    }

    pub fn close(&self) -> Result<(), WslLinkTerminalClientError> {
        self.command_tx
            .send(WslLinkInteractiveTerminalCommand::Close(
                WslLinkTerminalInteractiveClose {
                    session_id: self.session_id.clone(),
                },
            ))
            .map_err(|_| WslLinkTerminalClientError::CommandChannelClosed)
    }
}

pub async fn run_terminal_script_over_wsl_link<F>(
    desktop_material: &WslLinkDesktopNoiseMaterial,
    request: WslLinkTerminalRunScriptRequest,
    mut on_event: F,
) -> Result<(), WslLinkTerminalClientError>
where
    F: FnMut(WslLinkTerminalServerPayload),
{
    request.validate()?;
    let mut supervisor = WslLinkPrimarySupervisor::new(
        "calamex-desktop-terminal",
        WslLinkTransportConfig::default(),
    );
    let mut connection = supervisor.open_noise_connection(desktop_material).await?;
    let session_id = connection.session.session_id.clone();
    let client_seq = supervisor.allocate_client_seq();
    let trace_id = format!("wsl-link-terminal-{}", now_unix_ms());
    let payload =
        encode_terminal_client_payload(&WslLinkTerminalClientPayload::RunScript(request.clone()))?;
    let frame = ClientFrame {
        session_id: session_id.clone(),
        request_id: request.run_id,
        idempotency_key: format!("terminal-run-{client_seq}"),
        client_seq,
        ack_server_seq: supervisor.last_ack_server_seq(),
        payload,
        trace_id,
    };

    let response = connection
        .client
        .duplex(Request::new(tokio_stream::iter([frame])))
        .await?;
    let mut stream = response.into_inner();
    while let Some(frame) = stream.message().await? {
        if frame.session_id != session_id {
            return Err(WslLinkTerminalClientError::SessionMismatch);
        }
        let payload = decode_terminal_server_payload(&frame.payload)?;
        let is_finished = matches!(
            &payload,
            WslLinkTerminalServerPayload::RunCompleted(_)
                | WslLinkTerminalServerPayload::RunError(_)
        );
        on_event(payload);
        if is_finished {
            break;
        }
    }

    Ok(())
}

pub async fn open_interactive_terminal_over_wsl_link<F>(
    desktop_material: &WslLinkDesktopNoiseMaterial,
    request: WslLinkTerminalOpenInteractiveRequest,
    mut on_event: F,
) -> Result<WslLinkInteractiveTerminalHandle, WslLinkTerminalClientError>
where
    F: FnMut(WslLinkTerminalServerPayload) + Send + 'static,
{
    request.validate()?;
    let terminal_session_id = request.session_id.clone();
    let mut supervisor = WslLinkPrimarySupervisor::new(
        "calamex-desktop-interactive-terminal",
        WslLinkTransportConfig::default(),
    );
    let mut connection = supervisor.open_noise_connection(desktop_material).await?;
    let wsl_link_session_id = connection.session.session_id.clone();
    let (frame_tx, frame_rx) = mpsc::channel::<ClientFrame>(32);
    let response = connection
        .client
        .duplex(Request::new(ReceiverStream::new(frame_rx)))
        .await?;
    send_terminal_payload_frame(
        &mut supervisor,
        &frame_tx,
        &wsl_link_session_id,
        format!("interactive-open-{terminal_session_id}"),
        WslLinkTerminalClientPayload::OpenInteractive(request),
    )
    .await?;

    let (command_tx, mut command_rx) =
        mpsc::unbounded_channel::<WslLinkInteractiveTerminalCommand>();
    let handle = WslLinkInteractiveTerminalHandle {
        session_id: terminal_session_id,
        command_tx,
    };
    let task_session_id = handle.session_id.clone();
    tokio::spawn(async move {
        let mut stream = response.into_inner();

        loop {
            tokio::select! {
                command = command_rx.recv() => {
                    let Some(command) = command else {
                        break;
                    };
                    let (request_id, payload) = match command {
                        WslLinkInteractiveTerminalCommand::Input(payload) => (
                            format!("interactive-input-{}-{}", payload.session_id, now_unix_ms()),
                            WslLinkTerminalClientPayload::InteractiveInput(payload),
                        ),
                        WslLinkInteractiveTerminalCommand::Resize(payload) => (
                            format!("interactive-resize-{}-{}", payload.session_id, now_unix_ms()),
                            WslLinkTerminalClientPayload::InteractiveResize(payload),
                        ),
                        WslLinkInteractiveTerminalCommand::Close(payload) => (
                            format!("interactive-close-{}-{}", payload.session_id, now_unix_ms()),
                            WslLinkTerminalClientPayload::InteractiveClose(payload),
                        ),
                    };
                    if send_terminal_payload_frame(
                        &mut supervisor,
                        &frame_tx,
                        &wsl_link_session_id,
                        request_id,
                        payload,
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
                message = stream.message() => {
                    let frame = match message {
                        Ok(Some(frame)) => frame,
                        Ok(None) => break,
                        Err(_) => break,
                    };
                    if frame.session_id != wsl_link_session_id {
                        break;
                    }
                    supervisor.apply_server_frame_ack(frame.server_seq, frame.ack_client_seq);
                    let Ok(payload) = decode_terminal_server_payload(&frame.payload) else {
                        break;
                    };
                    let is_finished = matches!(
                        &payload,
                        WslLinkTerminalServerPayload::InteractiveClosed(_)
                            | WslLinkTerminalServerPayload::InteractiveError(_)
                    );
                    on_event(payload);
                    if is_finished {
                        break;
                    }
                }
            }
        }

        drop(frame_tx);
        let _ = task_session_id;
    });

    Ok(handle)
}

pub async fn signal_terminal_process_over_wsl_link(
    desktop_material: &WslLinkDesktopNoiseMaterial,
    request: WslLinkTerminalSignalProcess,
) -> Result<(), WslLinkTerminalClientError> {
    request.validate()?;
    let mut supervisor = WslLinkPrimarySupervisor::new(
        "calamex-desktop-terminal-signal",
        WslLinkTransportConfig::default(),
    );
    let mut connection = supervisor.open_noise_connection(desktop_material).await?;
    let session_id = connection.session.session_id.clone();
    let client_seq = supervisor.allocate_client_seq();
    let trace_id = format!("wsl-link-terminal-signal-{}", now_unix_ms());
    let payload =
        encode_terminal_client_payload(&WslLinkTerminalClientPayload::SignalProcess(request))?;
    let frame = ClientFrame {
        session_id: session_id.clone(),
        request_id: format!("terminal-signal-{client_seq}"),
        idempotency_key: format!("terminal-signal-{client_seq}"),
        client_seq,
        ack_server_seq: supervisor.last_ack_server_seq(),
        payload,
        trace_id,
    };

    let response = connection
        .client
        .duplex(Request::new(tokio_stream::iter([frame])))
        .await?;
    let mut stream = response.into_inner();
    while let Some(frame) = stream.message().await? {
        if frame.session_id != session_id {
            return Err(WslLinkTerminalClientError::SessionMismatch);
        }
        let payload = decode_terminal_server_payload(&frame.payload)?;
        if matches!(
            payload,
            WslLinkTerminalServerPayload::InteractiveAck(_)
                | WslLinkTerminalServerPayload::InteractiveError(_)
        ) {
            break;
        }
    }

    Ok(())
}

pub async fn write_terminal_run_input_over_wsl_link(
    desktop_material: &WslLinkDesktopNoiseMaterial,
    request: WslLinkTerminalRunInput,
) -> Result<(), WslLinkTerminalClientError> {
    request.validate()?;
    let mut supervisor = WslLinkPrimarySupervisor::new(
        "calamex-desktop-terminal-run-input",
        WslLinkTransportConfig::default(),
    );
    let mut connection = supervisor.open_noise_connection(desktop_material).await?;
    let session_id = connection.session.session_id.clone();
    let client_seq = supervisor.allocate_client_seq();
    let trace_id = format!("wsl-link-terminal-run-input-{}", now_unix_ms());
    let payload =
        encode_terminal_client_payload(&WslLinkTerminalClientPayload::RunInput(request.clone()))?;
    let frame = ClientFrame {
        session_id: session_id.clone(),
        request_id: format!("terminal-run-input-{}-{client_seq}", request.run_id),
        idempotency_key: format!("terminal-run-input-{client_seq}"),
        client_seq,
        ack_server_seq: supervisor.last_ack_server_seq(),
        payload,
        trace_id,
    };

    let response = connection
        .client
        .duplex(Request::new(tokio_stream::iter([frame])))
        .await?;
    let mut stream = response.into_inner();
    while let Some(frame) = stream.message().await? {
        if frame.session_id != session_id {
            return Err(WslLinkTerminalClientError::SessionMismatch);
        }
        let payload = decode_terminal_server_payload(&frame.payload)?;
        if matches!(
            payload,
            WslLinkTerminalServerPayload::InteractiveAck(_)
                | WslLinkTerminalServerPayload::InteractiveError(_)
        ) {
            break;
        }
    }

    Ok(())
}

async fn send_terminal_payload_frame(
    supervisor: &mut WslLinkPrimarySupervisor,
    frame_tx: &mpsc::Sender<ClientFrame>,
    session_id: &str,
    request_id: String,
    payload: WslLinkTerminalClientPayload,
) -> Result<(), WslLinkTerminalClientError> {
    let client_seq = supervisor.allocate_client_seq();
    let trace_id = format!("wsl-link-terminal-{}", now_unix_ms());
    let payload = encode_terminal_client_payload(&payload)?;
    frame_tx
        .send(ClientFrame {
            session_id: session_id.to_string(),
            request_id,
            idempotency_key: format!("terminal-frame-{client_seq}"),
            client_seq,
            ack_server_seq: supervisor.last_ack_server_seq(),
            payload,
            trace_id,
        })
        .await
        .map_err(|_| WslLinkTerminalClientError::CommandChannelClosed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_request_validation_rejects_empty_run_id() {
        let request = WslLinkTerminalRunScriptRequest {
            run_id: String::new(),
            working_directory: "/tmp".to_string(),
            execution_path: "/tmp/test.sh".to_string(),
            script_content: Some("echo hi".to_string()),
            cleanup_paths: vec![],
            cols: 120,
            rows: 40,
        };

        assert!(request.validate().is_err());
    }
}
