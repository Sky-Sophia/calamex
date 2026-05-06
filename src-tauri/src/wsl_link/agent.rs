use std::{
    collections::HashMap,
    process::Stdio,
    sync::{Arc, Mutex},
};

use tokio::io::{AsyncRead, AsyncReadExt};
use tonic::{Request, Response, Status};

use super::{
    noise::{
        build_responder, into_transport_mode, read_empty_handshake_message,
        write_empty_handshake_message, WslLinkNoiseHandshakeConfig,
    },
    noise_material::WslLinkAgentNoiseMaterial,
    protocol::v1::{
        wsl_link_server::WslLink, ClientFrame, HeartbeatRequest, HeartbeatResponse,
        OpenNoiseSessionRequest, OpenNoiseSessionResponse, OpenSessionRequest, OpenSessionResponse,
        ResumeSessionRequest, ResumeSessionResponse, ServerFrame, TransportKind,
    },
    terminal_exec::{
        decode_terminal_client_payload, encode_terminal_server_payload,
        resolve_agent_working_directory, WslLinkTerminalClientPayload, WslLinkTerminalRunChunk,
        WslLinkTerminalRunCompleted, WslLinkTerminalRunError, WslLinkTerminalRunScriptRequest,
        WslLinkTerminalRunStarted, WslLinkTerminalServerPayload, WslLinkUtf8ChunkDecoder,
    },
    types::{noise_server_proof_payload, now_unix_ms, DEFAULT_PROTOCOL_VERSION},
};

type DuplexStream =
    tonic::codegen::tokio_stream::wrappers::ReceiverStream<Result<ServerFrame, Status>>;

#[derive(Debug, Clone)]
struct AgentSession {
    session_id: String,
    server_seq: u64,
    ack_client_seq: u64,
    response_cache_by_client_seq: HashMap<u64, Vec<ServerFrame>>,
}

impl AgentSession {
    fn new(session_id: String, last_client_seq: u64) -> Self {
        Self {
            session_id,
            server_seq: 1,
            ack_client_seq: last_client_seq,
            response_cache_by_client_seq: HashMap::new(),
        }
    }

    fn next_server_seq(&mut self) -> u64 {
        let current = self.server_seq;
        self.server_seq = self.server_seq.saturating_add(1);
        current
    }

    fn ack_client_seq(&mut self, client_seq: u64) {
        self.ack_client_seq = self.ack_client_seq.max(client_seq);
    }
}

#[derive(Debug, Default)]
struct AgentState {
    next_session_seq: u64,
    sessions: HashMap<String, AgentSession>,
}

impl AgentState {
    fn create_session(&mut self, last_client_seq: u64) -> (AgentSession, u64) {
        self.next_session_seq = self.next_session_seq.saturating_add(1);
        let session_id = format!("wsl-link-session-{}", self.next_session_seq);
        let mut session = AgentSession::new(session_id.clone(), last_client_seq);
        let initial_server_seq = session.next_server_seq();
        self.sessions.insert(session_id, session.clone());
        (session, initial_server_seq)
    }

    fn get_session_mut(&mut self, session_id: &str) -> Option<&mut AgentSession> {
        self.sessions.get_mut(session_id)
    }
}

#[derive(Debug, Clone, Default)]
pub struct WslLinkAgentService {
    state: Arc<Mutex<AgentState>>,
    noise_material: Option<Arc<WslLinkAgentNoiseMaterial>>,
}

impl WslLinkAgentService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_noise_material(noise_material: WslLinkAgentNoiseMaterial) -> Self {
        Self {
            state: Arc::new(Mutex::new(AgentState::default())),
            noise_material: Some(Arc::new(noise_material)),
        }
    }

    pub fn noise_responder_config(&self) -> Option<WslLinkNoiseHandshakeConfig> {
        self.noise_material
            .as_ref()
            .map(|material| material.responder_config())
    }

    pub fn handle_client_frame(&self, frame: ClientFrame) -> Result<ServerFrame, Status> {
        build_server_frame_with_state(&self.state, frame)
            .unwrap_or_else(|| Err(Status::internal("WSL Link agent 状态锁已损坏。")))
    }

    fn open_session_response(
        &self,
        request: OpenSessionRequest,
    ) -> Result<OpenSessionResponse, Status> {
        if request.client_id.trim().is_empty() {
            return Err(Status::invalid_argument("client_id 不能为空。"));
        }
        if request.protocol_version != DEFAULT_PROTOCOL_VERSION {
            return Err(Status::failed_precondition("WSL Link 协议版本不匹配。"));
        }
        if request.trace_id.trim().is_empty() {
            return Err(Status::invalid_argument("trace_id 不能为空。"));
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let (session, server_seq) = state.create_session(request.last_client_seq);

        Ok(OpenSessionResponse {
            session_id: session.session_id,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            transport: TransportKind::VsockGrpc as i32,
        })
    }
}

#[tonic::async_trait]
impl WslLink for WslLinkAgentService {
    async fn open_session(
        &self,
        request: Request<OpenSessionRequest>,
    ) -> Result<Response<OpenSessionResponse>, Status> {
        Ok(Response::new(
            self.open_session_response(request.into_inner())?,
        ))
    }

    async fn open_noise_session(
        &self,
        request: Request<OpenNoiseSessionRequest>,
    ) -> Result<Response<OpenNoiseSessionResponse>, Status> {
        let request = request.into_inner();
        let open_request = request
            .open_session
            .ok_or_else(|| Status::invalid_argument("open_session 不能为空。"))?;
        if request.handshake_message.is_empty() {
            return Err(Status::invalid_argument("handshake_message 不能为空。"));
        }

        let config = self
            .noise_responder_config()
            .ok_or_else(|| Status::failed_precondition("WSL Link Noise agent 材料未加载。"))?;
        let trace_id = open_request.trace_id.clone();
        let mut responder = build_responder(&config).map_err(|error| {
            Status::internal(format!("WSL Link Noise responder 创建失败：{error}"))
        })?;

        read_empty_handshake_message(&mut responder, &request.handshake_message).map_err(
            |error| Status::unauthenticated(format!("WSL Link Noise 握手失败：{error}")),
        )?;
        let response_message = write_empty_handshake_message(&mut responder).map_err(|error| {
            Status::unauthenticated(format!("WSL Link Noise 握手失败：{error}"))
        })?;

        let open_session = self.open_session_response(open_request)?;
        let proof = noise_server_proof_payload(&trace_id, &open_session.session_id);
        let mut transport = into_transport_mode(responder).map_err(|error| {
            Status::unauthenticated(format!("WSL Link Noise 握手失败：{error}"))
        })?;
        let encrypted_server_proof = transport
            .encrypt_frame(&proof)
            .map_err(|error| Status::internal(format!("WSL Link Noise proof 加密失败：{error}")))?;

        Ok(Response::new(OpenNoiseSessionResponse {
            open_session: Some(open_session),
            handshake_message: response_message,
            encrypted_server_proof,
        }))
    }

    async fn resume_session(
        &self,
        request: Request<ResumeSessionRequest>,
    ) -> Result<Response<ResumeSessionResponse>, Status> {
        let request = request.into_inner();
        if request.session_id.trim().is_empty() {
            return Err(Status::invalid_argument("session_id 不能为空。"));
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let Some(session) = state.get_session_mut(&request.session_id) else {
            return Ok(Response::new(ResumeSessionResponse {
                accepted: false,
                server_seq: 0,
                ack_client_seq: 0,
                reason: "session 不存在，需要重新 OpenSession。".to_string(),
            }));
        };

        session.ack_client_seq(request.last_client_seq);
        let server_seq = session
            .server_seq
            .max(request.last_ack_server_seq.saturating_add(1));
        session.server_seq = server_seq.saturating_add(1);

        Ok(Response::new(ResumeSessionResponse {
            accepted: true,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            reason: "已恢复。".to_string(),
        }))
    }

    async fn heartbeat(
        &self,
        request: Request<HeartbeatRequest>,
    ) -> Result<Response<HeartbeatResponse>, Status> {
        let request = request.into_inner();
        let mut state = self
            .state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let Some(session) = state.get_session_mut(&request.session_id) else {
            return Err(Status::not_found("session 不存在。"));
        };

        session.ack_client_seq(request.client_seq);
        let server_seq = session.next_server_seq();

        Ok(Response::new(HeartbeatResponse {
            session_id: request.session_id,
            server_seq,
            ack_client_seq: session.ack_client_seq,
            received_at_unix_ms: now_unix_ms().min(i64::MAX as u64) as i64,
        }))
    }

    type DuplexStream = DuplexStream;

    async fn duplex(
        &self,
        request: Request<tonic::Streaming<ClientFrame>>,
    ) -> Result<Response<Self::DuplexStream>, Status> {
        let mut inbound = request.into_inner();
        let state = Arc::clone(&self.state);
        let (tx, rx) = tokio::sync::mpsc::channel(16);

        tokio::spawn(async move {
            loop {
                let frame = match inbound.message().await {
                    Ok(Some(frame)) => frame,
                    Ok(None) => break,
                    Err(error) => {
                        let _ = tx
                            .send(Err(Status::internal(format!(
                                "读取 WSL Link duplex frame 失败：{error}"
                            ))))
                            .await;
                        break;
                    }
                };

                if handle_terminal_duplex_frame(&state, frame.clone(), &tx).await {
                    continue;
                }

                match build_server_frame_with_state(&state, frame) {
                    Some(response) => {
                        if tx.send(response).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = tx
                            .send(Err(Status::internal("WSL Link agent 状态锁已损坏。")))
                            .await;
                        break;
                    }
                }
            }
        });

        Ok(Response::new(
            tonic::codegen::tokio_stream::wrappers::ReceiverStream::new(rx),
        ))
    }
}

fn build_server_frame_with_state(
    state: &Arc<Mutex<AgentState>>,
    frame: ClientFrame,
) -> Option<Result<ServerFrame, Status>> {
    let mut state = state.lock().ok()?;
    Some(build_server_frame(&mut state, frame))
}

fn build_server_frame(state: &mut AgentState, frame: ClientFrame) -> Result<ServerFrame, Status> {
    if frame.session_id.trim().is_empty() {
        return Err(Status::invalid_argument("session_id 不能为空。"));
    }
    if frame.request_id.trim().is_empty() {
        return Err(Status::invalid_argument("request_id 不能为空。"));
    }
    // 写请求的幂等边界固定为同一个 session 内的 client_seq。
    // idempotency_key 仍保留在协议里，供上层审计或未来兼容旧客户端。
    if frame.client_seq == 0 {
        return Err(Status::invalid_argument("client_seq 必须从 1 开始。"));
    }

    let Some(session) = state.get_session_mut(&frame.session_id) else {
        return Err(Status::not_found("session 不存在。"));
    };
    if let Some(cached) = session
        .response_cache_by_client_seq
        .get(&frame.client_seq)
        .cloned()
    {
        session.ack_client_seq(frame.client_seq);
        let Some(mut response) = cached.first().cloned() else {
            return Err(Status::internal("WSL Link agent 去重缓存为空。"));
        };
        response.ack_client_seq = session.ack_client_seq;
        return Ok(response);
    }

    session.ack_client_seq(frame.client_seq);
    let server_seq = session.next_server_seq();

    let response = ServerFrame {
        session_id: frame.session_id,
        request_id: frame.request_id,
        server_seq,
        ack_client_seq: session.ack_client_seq,
        payload: frame.payload,
        trace_id: frame.trace_id,
    };
    session
        .response_cache_by_client_seq
        .insert(frame.client_seq, vec![response.clone()]);

    Ok(response)
}

#[derive(Debug, Clone)]
struct TerminalFrameMeta {
    session_id: String,
    request_id: String,
    trace_id: String,
    client_seq: u64,
}

async fn handle_terminal_duplex_frame(
    state: &Arc<Mutex<AgentState>>,
    frame: ClientFrame,
    tx: &tokio::sync::mpsc::Sender<Result<ServerFrame, Status>>,
) -> bool {
    let payload = match decode_terminal_client_payload(&frame.payload) {
        Ok(payload) => payload,
        Err(_) => return false,
    };

    match payload {
        WslLinkTerminalClientPayload::RunScript(request) => {
            let result = run_terminal_script_frame(state, frame, request, tx).await;
            if let Err(error) = result {
                let _ = tx.send(Err(error)).await;
            }
            true
        }
    }
}

async fn run_terminal_script_frame(
    state: &Arc<Mutex<AgentState>>,
    frame: ClientFrame,
    request: WslLinkTerminalRunScriptRequest,
    tx: &tokio::sync::mpsc::Sender<Result<ServerFrame, Status>>,
) -> Result<(), Status> {
    let session_id = frame.session_id.clone();
    let client_seq = frame.client_seq;
    let meta = begin_terminal_run_frame(state, frame, &request)?;
    let Some(meta) = meta else {
        return replay_cached_terminal_frames(state, &session_id, client_seq, tx).await;
    };

    if let Some(content) = request.script_content.as_ref() {
        tokio::fs::write(&request.execution_path, content)
            .await
            .map_err(|error| Status::internal(format!("写入 WSL Link 临时脚本失败：{error}")))?;
        set_private_file_permissions(&request.execution_path).await?;
    }

    let working_directory = resolve_agent_working_directory(&request.working_directory)
        .map_err(|error| Status::invalid_argument(error.to_string()))?;
    let mut command = tokio::process::Command::new("/usr/bin/setsid");
    command
        .arg("--wait")
        .arg("/usr/bin/env")
        .arg("LANG=C.UTF-8")
        .arg("LC_ALL=C.UTF-8")
        .arg("TERM=xterm-256color")
        .arg("/bin/bash")
        .arg("--noprofile")
        .arg("--norc")
        .arg(&request.execution_path)
        .current_dir(working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| Status::internal(format!("启动 WSL Link 脚本失败：{error}")))?;
    let pid = child.id().unwrap_or(0);
    send_terminal_event(
        state,
        &meta,
        WslLinkTerminalServerPayload::RunStarted(WslLinkTerminalRunStarted {
            run_id: request.run_id.clone(),
            pid,
            started_at_unix_ms: now_unix_ms_i64(),
        }),
        tx,
    )
    .await?;

    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TerminalProcessEvent>(32);
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(read_process_stream(stdout, event_tx.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(read_process_stream(stderr, event_tx.clone()));
    }
    tokio::spawn(async move {
        let exit = child
            .wait()
            .await
            .map(|status| status.code())
            .map_err(|error| error.to_string());
        let _ = event_tx.send(TerminalProcessEvent::Exit(exit)).await;
    });

    let mut exit_code = None;
    let mut wait_error = None;
    while let Some(event) = event_rx.recv().await {
        match event {
            TerminalProcessEvent::Chunk(data) => {
                send_terminal_event(
                    state,
                    &meta,
                    WslLinkTerminalServerPayload::RunChunk(WslLinkTerminalRunChunk {
                        run_id: request.run_id.clone(),
                        data,
                    }),
                    tx,
                )
                .await?;
            }
            TerminalProcessEvent::Exit(Ok(code)) => {
                exit_code = code;
            }
            TerminalProcessEvent::Exit(Err(error)) => {
                wait_error = Some(error);
            }
        }
    }

    cleanup_terminal_run_files(&request.cleanup_paths).await;

    if let Some(error) = wait_error {
        send_terminal_event(
            state,
            &meta,
            WslLinkTerminalServerPayload::RunError(WslLinkTerminalRunError {
                run_id: request.run_id,
                message: format!("等待 WSL Link 脚本结束失败：{error}"),
                exit_code,
                finished_at_unix_ms: now_unix_ms_i64(),
            }),
            tx,
        )
        .await?;
        return Ok(());
    }

    send_terminal_event(
        state,
        &meta,
        WslLinkTerminalServerPayload::RunCompleted(WslLinkTerminalRunCompleted {
            run_id: request.run_id,
            exit_code,
            finished_at_unix_ms: now_unix_ms_i64(),
        }),
        tx,
    )
    .await
}

fn begin_terminal_run_frame(
    state: &Arc<Mutex<AgentState>>,
    frame: ClientFrame,
    request: &WslLinkTerminalRunScriptRequest,
) -> Result<Option<TerminalFrameMeta>, Status> {
    request
        .validate()
        .map_err(|error| Status::invalid_argument(error.to_string()))?;
    if frame.session_id.trim().is_empty() {
        return Err(Status::invalid_argument("session_id 不能为空。"));
    }
    if frame.request_id.trim().is_empty() {
        return Err(Status::invalid_argument("request_id 不能为空。"));
    }
    if frame.client_seq == 0 {
        return Err(Status::invalid_argument("client_seq 必须从 1 开始。"));
    }

    let mut state = state
        .lock()
        .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
    let Some(session) = state.get_session_mut(&frame.session_id) else {
        return Err(Status::not_found("session 不存在。"));
    };
    if session
        .response_cache_by_client_seq
        .contains_key(&frame.client_seq)
    {
        session.ack_client_seq(frame.client_seq);
        return Ok(None);
    }

    session.ack_client_seq(frame.client_seq);
    session
        .response_cache_by_client_seq
        .insert(frame.client_seq, Vec::new());

    Ok(Some(TerminalFrameMeta {
        session_id: frame.session_id,
        request_id: frame.request_id,
        trace_id: frame.trace_id,
        client_seq: frame.client_seq,
    }))
}

async fn replay_cached_terminal_frames(
    state: &Arc<Mutex<AgentState>>,
    session_id: &str,
    client_seq: u64,
    tx: &tokio::sync::mpsc::Sender<Result<ServerFrame, Status>>,
) -> Result<(), Status> {
    let frames = {
        let mut state = state
            .lock()
            .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
        let Some(session) = state.get_session_mut(session_id) else {
            return Err(Status::not_found("session 不存在。"));
        };
        session
            .response_cache_by_client_seq
            .get(&client_seq)
            .cloned()
            .unwrap_or_default()
    };

    for frame in frames {
        if tx.send(Ok(frame)).await.is_err() {
            return Ok(());
        }
    }
    Ok(())
}

async fn send_terminal_event(
    state: &Arc<Mutex<AgentState>>,
    meta: &TerminalFrameMeta,
    payload: WslLinkTerminalServerPayload,
    tx: &tokio::sync::mpsc::Sender<Result<ServerFrame, Status>>,
) -> Result<(), Status> {
    let frame = build_terminal_server_frame(state, meta, payload)?;
    tx.send(Ok(frame))
        .await
        .map_err(|_| Status::cancelled("WSL Link terminal duplex 已关闭。"))
}

fn build_terminal_server_frame(
    state: &Arc<Mutex<AgentState>>,
    meta: &TerminalFrameMeta,
    payload: WslLinkTerminalServerPayload,
) -> Result<ServerFrame, Status> {
    let mut state = state
        .lock()
        .map_err(|_| Status::internal("WSL Link agent 状态锁已损坏。"))?;
    let Some(session) = state.get_session_mut(&meta.session_id) else {
        return Err(Status::not_found("session 不存在。"));
    };
    let server_seq = session.next_server_seq();
    let frame = ServerFrame {
        session_id: meta.session_id.clone(),
        request_id: meta.request_id.clone(),
        server_seq,
        ack_client_seq: session.ack_client_seq,
        payload: encode_terminal_server_payload(&payload)
            .map_err(|error| Status::internal(error.to_string()))?,
        trace_id: meta.trace_id.clone(),
    };
    session
        .response_cache_by_client_seq
        .entry(meta.client_seq)
        .or_default()
        .push(frame.clone());
    Ok(frame)
}

enum TerminalProcessEvent {
    Chunk(String),
    Exit(Result<Option<i32>, String>),
}

async fn read_process_stream<R>(mut reader: R, tx: tokio::sync::mpsc::Sender<TerminalProcessEvent>)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = [0_u8; 16 * 1024];
    let mut decoder = WslLinkUtf8ChunkDecoder::default();
    let mut output = String::new();

    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(size) => {
                output.clear();
                decoder.decode_into(&buffer[..size], &mut output, false);
                if !output.is_empty() {
                    let _ = tx.send(TerminalProcessEvent::Chunk(output.clone())).await;
                }
            }
            Err(error) => {
                let _ = tx
                    .send(TerminalProcessEvent::Chunk(format!(
                        "读取 WSL Link 脚本输出失败：{error}\n"
                    )))
                    .await;
                break;
            }
        }
    }

    output.clear();
    decoder.decode_into(&[], &mut output, true);
    if !output.is_empty() {
        let _ = tx.send(TerminalProcessEvent::Chunk(output)).await;
    }
}

async fn cleanup_terminal_run_files(paths: &[String]) {
    for path in paths.iter().filter(|path| path.starts_with("/tmp/")) {
        let _ = tokio::fs::remove_file(path).await;
    }
}

async fn set_private_file_permissions(path: &str) -> Result<(), Status> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        tokio::fs::set_permissions(path, permissions)
            .await
            .map_err(|error| {
                Status::internal(format!("设置 WSL Link 临时脚本权限失败：{error}"))
            })?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

fn now_unix_ms_i64() -> i64 {
    now_unix_ms().min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use tonic::Request;

    use super::*;

    fn open_request() -> OpenSessionRequest {
        OpenSessionRequest {
            client_id: "desktop".to_string(),
            protocol_version: DEFAULT_PROTOCOL_VERSION.to_string(),
            last_client_seq: 2,
            trace_id: "trace-1".to_string(),
        }
    }

    #[tokio::test]
    async fn open_session_returns_vsock_transport_and_ack() {
        let service = WslLinkAgentService::new();

        let response = service
            .open_session(Request::new(open_request()))
            .await
            .expect("open session should work")
            .into_inner();

        assert_eq!(response.ack_client_seq, 2);
        assert_eq!(response.transport, TransportKind::VsockGrpc as i32);
        assert!(!response.session_id.is_empty());
    }

    #[tokio::test]
    async fn resume_unknown_session_is_rejected_without_error() {
        let service = WslLinkAgentService::new();

        let response = service
            .resume_session(Request::new(ResumeSessionRequest {
                session_id: "missing".to_string(),
                last_ack_server_seq: 0,
                last_client_seq: 3,
                trace_id: "trace-2".to_string(),
            }))
            .await
            .expect("resume should return structured response")
            .into_inner();

        assert!(!response.accepted);
    }

    #[tokio::test]
    async fn heartbeat_advances_server_seq_and_ack() {
        let service = WslLinkAgentService::new();
        let open = service
            .open_session(Request::new(open_request()))
            .await
            .expect("open session should work")
            .into_inner();

        let heartbeat = service
            .heartbeat(Request::new(HeartbeatRequest {
                session_id: open.session_id,
                client_seq: 7,
                ack_server_seq: 0,
                sent_at_unix_ms: 1,
            }))
            .await
            .expect("heartbeat should work")
            .into_inner();

        assert_eq!(heartbeat.ack_client_seq, 7);
        assert!(heartbeat.server_seq > open.server_seq);
    }

    #[test]
    fn duplicate_duplex_frame_with_same_seq_returns_cached_response() {
        let mut state = AgentState::default();
        let (session, _) = state.create_session(0);
        let frame = ClientFrame {
            session_id: session.session_id.clone(),
            request_id: "r1".to_string(),
            idempotency_key: "idem-1".to_string(),
            client_seq: 1,
            ack_server_seq: 0,
            payload: b"payload".to_vec(),
            trace_id: "trace-3".to_string(),
        };

        let first = build_server_frame(&mut state, frame.clone()).expect("first frame should work");
        let second = build_server_frame(&mut state, frame).expect("second frame should work");

        assert_eq!(first.payload, b"payload");
        assert_eq!(second.payload, b"payload");
        assert_eq!(second.server_seq, first.server_seq);
        assert_eq!(second.ack_client_seq, 1);
    }

    #[test]
    fn duplicate_duplex_frame_ignores_changed_idempotency_key_when_seq_matches() {
        let mut state = AgentState::default();
        let (session, _) = state.create_session(0);
        let mut frame = ClientFrame {
            session_id: session.session_id.clone(),
            request_id: "r1".to_string(),
            idempotency_key: "idem-1".to_string(),
            client_seq: 1,
            ack_server_seq: 0,
            payload: b"payload".to_vec(),
            trace_id: "trace-3".to_string(),
        };

        let first = build_server_frame(&mut state, frame.clone()).expect("first frame should work");
        frame.idempotency_key = "idem-2".to_string();
        frame.payload = b"changed".to_vec();
        let second = build_server_frame(&mut state, frame).expect("second frame should work");

        assert_eq!(second.server_seq, first.server_seq);
        assert_eq!(second.payload, b"payload");
    }

    #[test]
    fn service_exposes_noise_responder_config_when_material_is_loaded() {
        let material = super::super::noise_material::generate_pairing_material()
            .expect("pairing material should generate");
        let service = WslLinkAgentService::with_noise_material(material.agent);

        assert!(service.noise_responder_config().is_some());
    }
}
