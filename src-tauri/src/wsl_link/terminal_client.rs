use thiserror::Error;
use tonic::Request;

use super::{
    config::WslLinkTransportConfig,
    grpc_transport::WslLinkGrpcTransportError,
    noise_material::WslLinkDesktopNoiseMaterial,
    primary_supervisor::{WslLinkPrimarySupervisor, WslLinkPrimarySupervisorError},
    protocol::v1::ClientFrame,
    terminal_exec::{
        decode_terminal_server_payload, encode_terminal_client_payload,
        WslLinkTerminalClientPayload, WslLinkTerminalExecError, WslLinkTerminalRunScriptRequest,
        WslLinkTerminalServerPayload,
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
