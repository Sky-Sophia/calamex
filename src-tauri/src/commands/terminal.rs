use super::{configure_std_command_for_background, find_command_path};
use chrono::Utc;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering as AtomicOrdering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const WSL_TEMP_DIRECTORY: &str = "/tmp";
const TERMINAL_DISPATCH_RUNNER_PREFIX: &str = "/tmp/sh-editor-dispatch";
const TERMINAL_RUN_MARKER_PREFIX: &str = "\u{001b}]SH_EDITOR:";
const TERMINAL_RUN_MARKER_SUFFIX: char = '\u{0007}';
const TERMINAL_RUN_MARKER_ESCAPED_PREFIX: &str = "\\033]SH_EDITOR:";
const TERMINAL_RUN_MARKER_ESCAPED_SUFFIX: &str = "\\007";
const TERMINAL_RUN_START_MARKER_PREFIX: &str = "SH_EDITOR_RUN_BEGIN:";
const TERMINAL_RUN_END_MARKER_PREFIX: &str = "SH_EDITOR_RUN_END:";
const TERMINAL_READ_BUFFER_SIZE: usize = 64 * 1024;
const TERMINAL_EVENT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const TERMINAL_EVENT_FLUSH_THRESHOLD: usize = 64 * 1024;
const TERMINAL_SNAPSHOT_MAX_LENGTH: usize = 160 * 1024;

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static WSL_COMMAND_PATH_CACHE: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureTerminalSessionRequest {
    session_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionPayload {
    session_id: String,
    cwd: String,
    shell_label: String,
    created: bool,
    initial_output: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTerminalScriptRequest {
    session_id: String,
    path: Option<String>,
    content: String,
    is_dirty: bool,
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchTerminalScriptPayload {
    session_id: String,
    cwd: String,
    command_line: String,
    used_temp_file: bool,
    started_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalSessionRequest {
    session_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalRunOutputEvent {
    session_id: String,
    run_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalRunCompleteEvent {
    session_id: String,
    run_id: String,
    exit_code: Option<i32>,
    finished_at: String,
}

struct TerminalPreparedScript {
    execution_path: String,
    working_directory: String,
    used_temp_file: bool,
    should_cleanup_execution_path: bool,
    should_materialize_inline_content: bool,
}

struct TerminalDispatchCommand {
    raw_command: String,
    display_command: String,
    used_temp_file: bool,
}

struct TerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    working_directory: String,
}

#[derive(Default)]
struct TerminalRunStreamParser {
    buffer: String,
    active_run_id: Option<String>,
}

struct TerminalRunStreamUpdate {
    messages: Vec<TerminalEmitterMessage>,
}

struct TerminalMarkerChunk<'a> {
    before: &'a str,
    marker_token: Option<&'a str>,
    remainder: &'a str,
}

enum TerminalRunMarkerToken<'a> {
    Start(&'a str),
    End {
        run_id: &'a str,
        exit_code: Option<i32>,
    },
    Unknown,
}

#[derive(Default)]
struct TerminalUtf8ChunkDecoder {
    pending: Vec<u8>,
}

enum TerminalEmitterMessage {
    VisibleOutput(String),
    RunOutput(TerminalRunOutputEvent),
    RunComplete(TerminalRunCompleteEvent),
    Close,
}

impl TerminalRunStreamUpdate {
    fn new() -> Self {
        Self {
            messages: Vec::new(),
        }
    }

    fn push_visible_output(&mut self, value: &str) {
        if value.is_empty() {
            return;
        }

        self.messages
            .push(TerminalEmitterMessage::VisibleOutput(value.to_string()));
    }

    fn push_run_output(&mut self, session_id: &str, run_id: String, data: String) {
        if data.is_empty() {
            return;
        }

        self.messages
            .push(TerminalEmitterMessage::RunOutput(TerminalRunOutputEvent {
                session_id: session_id.to_string(),
                run_id,
                data,
            }));
    }

    fn push_completed_run(&mut self, session_id: &str, run_id: String, exit_code: Option<i32>) {
        self.messages.push(TerminalEmitterMessage::RunComplete(
            TerminalRunCompleteEvent {
                session_id: session_id.to_string(),
                run_id,
                exit_code,
                finished_at: Utc::now().to_rfc3339(),
            },
        ));
    }
}

#[derive(Clone, Default)]
pub struct TerminalSessionState {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    snapshots: Arc<Mutex<HashMap<String, String>>>,
    creation_guard: Arc<Mutex<()>>,
}

#[tauri::command]
pub fn ensure_terminal_session(
    app: AppHandle,
    state: State<TerminalSessionState>,
    payload: EnsureTerminalSessionRequest,
) -> Result<TerminalSessionPayload, String> {
    let terminal_state = state.inner().clone();
    let (child, reader, terminal_cwd) = {
        let _creation_guard = terminal_state
            .creation_guard
            .lock()
            .map_err(|_| "终端会话创建锁已损坏。".to_string())?;

        if let Some(existing_session) = get_terminal_session(&terminal_state, &payload.session_id)?
        {
            if payload.cwd.is_none() && should_recreate_terminal_session(existing_session.as_ref())
            {
                remove_terminal_session(&terminal_state, &payload.session_id)?;
                remove_terminal_snapshot(&terminal_state, &payload.session_id)?;
                terminate_terminal_session(existing_session.as_ref())?;
            } else {
                resize_session_master(existing_session.as_ref(), payload.cols, payload.rows)?;
                let initial_output = get_terminal_snapshot(&terminal_state, &payload.session_id)?;

                return Ok(TerminalSessionPayload {
                    session_id: payload.session_id,
                    cwd: existing_session.working_directory.clone(),
                    shell_label: "WSL2".into(),
                    created: false,
                    initial_output: (!initial_output.is_empty()).then_some(initial_output),
                });
            }
        }

        let wsl_command_path = resolve_wsl_command_path()?;
        let working_directory = resolve_terminal_start_directory(payload.cwd.as_deref())?;
        let terminal_cwd = working_directory
            .as_ref()
            .map(|path| to_wsl_path(path.as_path()))
            .transpose()?
            .or_else(|| resolve_wsl_home_directory(&wsl_command_path))
            .unwrap_or_else(|| "~".to_string());
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(normalize_pty_size(payload.cols, payload.rows))
            .map_err(|error| format!("创建终端会话失败：{error}"))?;

        let mut command = CommandBuilder::new(wsl_command_path.to_string_lossy().as_ref());
        command.arg("--cd");
        command.arg(&terminal_cwd);
        command.arg("--");
        command.arg("/bin/bash");
        command.arg("-il");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pty_pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("启动 WSL2 终端失败：{error}"))?;
        let killer = child.clone_killer();
        drop(pty_pair.slave);

        let reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("初始化终端读通道失败：{error}"))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|error| format!("初始化终端写通道失败：{error}"))?;

        let session = Arc::new(TerminalSession {
            master: Mutex::new(pty_pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            working_directory: terminal_cwd.clone(),
        });

        {
            let mut sessions = lock_terminal_sessions(&terminal_state)?;
            sessions.insert(payload.session_id.clone(), Arc::clone(&session));
        }

        set_terminal_snapshot(&terminal_state, &payload.session_id, String::new())?;

        (child, reader, terminal_cwd)
    };

    spawn_terminal_reader(
        app.clone(),
        terminal_state.clone(),
        payload.session_id.clone(),
        reader,
    );
    spawn_terminal_waiter(app, terminal_state, payload.session_id.clone(), child);

    Ok(TerminalSessionPayload {
        session_id: payload.session_id,
        cwd: terminal_cwd,
        shell_label: "WSL2".into(),
        created: true,
        initial_output: None,
    })
}

#[tauri::command]
pub fn write_terminal_input(
    state: State<TerminalSessionState>,
    payload: TerminalInputRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在。".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "终端写入通道已损坏。".to_string())?;

    writer
        .write_all(payload.data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("写入终端输入失败：{error}"))
}

#[tauri::command]
pub fn resize_terminal_session(
    state: State<TerminalSessionState>,
    payload: TerminalResizeRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在。".to_string())?;

    resize_session_master(session.as_ref(), payload.cols, payload.rows)
}

#[tauri::command]
pub fn close_terminal_session(
    state: State<TerminalSessionState>,
    payload: CloseTerminalSessionRequest,
) -> Result<(), String> {
    let terminal_state = state.inner().clone();
    let removed_session = remove_terminal_session(&terminal_state, &payload.session_id)?;
    remove_terminal_snapshot(&terminal_state, &payload.session_id)?;

    let Some(session) = removed_session else {
        return Ok(());
    };

    terminate_terminal_session(session.as_ref())
}

#[tauri::command]
pub fn dispatch_script_to_terminal(
    state: State<TerminalSessionState>,
    payload: DispatchTerminalScriptRequest,
) -> Result<DispatchTerminalScriptPayload, String> {
    let terminal_state = state.inner().clone();
    let session = get_terminal_session(&terminal_state, &payload.session_id)?
        .ok_or_else(|| "目标终端会话不存在，请先打开集成终端。".to_string())?;
    let started_at = Utc::now();
    let command = build_terminal_run_command(&payload, &session.working_directory)?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "终端写入通道已损坏。".to_string())?;

    writer
        .write_all(command.raw_command.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|error| format!("发送脚本到终端失败：{error}"))?;

    Ok(DispatchTerminalScriptPayload {
        session_id: payload.session_id,
        cwd: session.working_directory.clone(),
        command_line: command.display_command,
        used_temp_file: command.used_temp_file,
        started_at: started_at.to_rfc3339(),
    })
}

fn lock_terminal_sessions(
    state: &TerminalSessionState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, Arc<TerminalSession>>>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "终端会话状态已损坏。".to_string())
}

fn get_terminal_session(
    state: &TerminalSessionState,
    session_id: &str,
) -> Result<Option<Arc<TerminalSession>>, String> {
    let sessions = lock_terminal_sessions(state)?;
    Ok(sessions.get(session_id).cloned())
}

fn remove_terminal_session(
    state: &TerminalSessionState,
    session_id: &str,
) -> Result<Option<Arc<TerminalSession>>, String> {
    let mut sessions = lock_terminal_sessions(state)?;
    Ok(sessions.remove(session_id))
}

fn lock_terminal_snapshots(
    state: &TerminalSessionState,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, String>>, String> {
    state
        .snapshots
        .lock()
        .map_err(|_| "终端快照状态已损坏。".to_string())
}

fn get_terminal_snapshot(state: &TerminalSessionState, session_id: &str) -> Result<String, String> {
    let snapshots = lock_terminal_snapshots(state)?;
    Ok(snapshots.get(session_id).cloned().unwrap_or_default())
}

fn set_terminal_snapshot(
    state: &TerminalSessionState,
    session_id: &str,
    value: String,
) -> Result<(), String> {
    let mut snapshots = lock_terminal_snapshots(state)?;
    snapshots.insert(session_id.to_string(), value);
    Ok(())
}

fn remove_terminal_snapshot(state: &TerminalSessionState, session_id: &str) -> Result<(), String> {
    let mut snapshots = lock_terminal_snapshots(state)?;
    snapshots.remove(session_id);
    Ok(())
}

fn advance_char_boundary(value: &str, index: usize) -> usize {
    if index >= value.len() {
        return value.len();
    }

    let mut next_index = index;
    while next_index < value.len() && !value.is_char_boundary(next_index) {
        next_index += 1;
    }
    next_index
}

fn trim_terminal_snapshot(snapshot: &mut String) {
    if snapshot.len() <= TERMINAL_SNAPSHOT_MAX_LENGTH {
        return;
    }

    let overflow = snapshot.len() - TERMINAL_SNAPSHOT_MAX_LENGTH;
    let trim_index = snapshot[overflow..]
        .find('\n')
        .map(|index| overflow + index + 1)
        .unwrap_or(overflow);
    let safe_trim_index = advance_char_boundary(snapshot, trim_index);
    snapshot.drain(..safe_trim_index);
}

fn append_terminal_snapshot(
    state: &TerminalSessionState,
    session_id: &str,
    chunk: &str,
) -> Result<(), String> {
    if chunk.is_empty() {
        return Ok(());
    }

    let mut snapshots = lock_terminal_snapshots(state)?;
    let snapshot = snapshots.entry(session_id.to_string()).or_default();
    snapshot.push_str(chunk);
    trim_terminal_snapshot(snapshot);
    Ok(())
}

fn normalize_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn resize_session_master(session: &TerminalSession, cols: u16, rows: u16) -> Result<(), String> {
    let master = session
        .master
        .lock()
        .map_err(|_| "终端尺寸通道已损坏。".to_string())?;

    master
        .resize(normalize_pty_size(cols, rows))
        .map_err(|error| format!("同步终端尺寸失败：{error}"))
}

fn should_recreate_terminal_session(session: &TerminalSession) -> bool {
    let cwd = session.working_directory.trim();
    cwd.is_empty()
        || cwd.contains('\\')
        || cwd.contains(':')
        || (!cwd.starts_with('/') && cwd != "~")
}

fn terminate_terminal_session(session: &TerminalSession) -> Result<(), String> {
    let mut killer = session
        .killer
        .lock()
        .map_err(|_| "终端结束通道已损坏。".to_string())?;
    match killer.kill() {
        Ok(()) => Ok(()),
        Err(error) => {
            let message = error.to_string();
            if message.contains("os error 0") {
                Ok(())
            } else {
                Err(format!("关闭 WSL2 终端失败：{error}"))
            }
        }
    }
}

fn resolve_terminal_start_directory(path: Option<&str>) -> Result<Option<PathBuf>, String> {
    if let Some(path) = path {
        let directory = PathBuf::from(path)
            .canonicalize()
            .map_err(|error| format!("读取终端工作目录失败：{error}"))?;

        if !directory.is_dir() {
            return Err("终端工作目录不是有效目录。".into());
        }

        return Ok(Some(directory));
    }

    Ok(None)
}

fn resolve_wsl_home_directory(wsl_command_path: &Path) -> Option<String> {
    let mut command = StdCommand::new(wsl_command_path);
    configure_std_command_for_background(&mut command);
    let output = command.args(["--cd", "~", "--", "pwd"]).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_wsl_command_path() -> Result<PathBuf, String> {
    {
        let cached_path = WSL_COMMAND_PATH_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(path) = cached_path.as_ref().filter(|path| path.exists()) {
            return Ok(path.clone());
        }
    }

    let resolved_path = find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"])
        .ok_or_else(|| "当前系统未发现可用的 wsl.exe，请先安装或启用 WSL2。".to_string())?;
    let mut cached_path = WSL_COMMAND_PATH_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cached_path = Some(resolved_path.clone());
    Ok(resolved_path)
}

fn write_wsl_file(path: &str, content: &[u8]) -> Result<(), String> {
    let wsl_command_path = resolve_wsl_command_path()?;
    let shell_command = format!(
        "umask 077 && cat > {} && chmod 600 {}",
        bash_quote(path),
        bash_quote(path),
    );
    let mut command = StdCommand::new(wsl_command_path);
    configure_std_command_for_background(&mut command);
    command
        .args(["--", "sh", "-lc", &shell_command])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("写入 WSL 临时文件失败：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "WSL 写入通道不可用。".to_string())?;
    stdin
        .write_all(content)
        .map_err(|error| format!("写入 WSL 临时文件失败：{error}"))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 WSL 临时文件写入完成失败：{error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("写入 WSL 临时文件失败。".into())
    } else {
        Err(format!("写入 WSL 临时文件失败：{stderr}"))
    }
}

fn build_terminal_dispatch_runner_path() -> Result<String, String> {
    let suffix = build_temp_file_suffix()?;

    Ok(format!("{TERMINAL_DISPATCH_RUNNER_PREFIX}-{suffix}.sh"))
}

pub(crate) fn build_temp_file_suffix() -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_micros();
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, AtomicOrdering::Relaxed);

    Ok(format!("{stamp}-{sequence}"))
}

fn build_terminal_temp_script_path(original_name: &str) -> Result<String, String> {
    let suffix = build_temp_file_suffix()?;
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("untitled");

    Ok(format!("{WSL_TEMP_DIRECTORY}/{stem}-{suffix}.tmp.sh"))
}

fn emit_terminal_data(app: &AppHandle, payload: TerminalDataEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:data", payload);
    }
}

fn emit_terminal_run_output(app: &AppHandle, payload: TerminalRunOutputEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:run-output", payload);
    }
}

fn emit_terminal_exit(app: &AppHandle, payload: TerminalExitEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:exit", payload);
    }
}

fn emit_terminal_run_complete(app: &AppHandle, payload: TerminalRunCompleteEvent) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("terminal:run-complete", payload);
    }
}

fn flush_terminal_data_buffer(
    app: &AppHandle,
    state: &TerminalSessionState,
    session_id: &str,
    buffer: &mut String,
) {
    if buffer.is_empty() {
        return;
    }

    let chunk = std::mem::take(buffer);
    let _ = append_terminal_snapshot(state, session_id, &chunk);

    emit_terminal_data(
        app,
        TerminalDataEvent {
            session_id: session_id.to_string(),
            data: chunk,
        },
    );
}

fn flush_terminal_run_output_buffer(
    app: &AppHandle,
    state: &TerminalSessionState,
    session_id: &str,
    buffer: &mut Option<TerminalRunOutputEvent>,
) {
    if let Some(payload) = buffer.take() {
        let _ = append_terminal_snapshot(state, session_id, &payload.data);
        emit_terminal_run_output(app, payload);
    }
}

fn spawn_terminal_event_emitter(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    receiver: mpsc::Receiver<TerminalEmitterMessage>,
) {
    thread::spawn(move || {
        let mut visible_output_buffer = String::new();
        let mut run_output_buffer: Option<TerminalRunOutputEvent> = None;

        loop {
            match receiver.recv_timeout(TERMINAL_EVENT_FLUSH_INTERVAL) {
                Ok(TerminalEmitterMessage::VisibleOutput(chunk)) => {
                    flush_terminal_run_output_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut run_output_buffer,
                    );
                    visible_output_buffer.push_str(&chunk);
                    if visible_output_buffer.len() >= TERMINAL_EVENT_FLUSH_THRESHOLD {
                        flush_terminal_data_buffer(
                            &app,
                            &state,
                            &session_id,
                            &mut visible_output_buffer,
                        );
                    }
                }
                Ok(TerminalEmitterMessage::RunOutput(payload)) => {
                    flush_terminal_data_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut visible_output_buffer,
                    );
                    match run_output_buffer.as_mut() {
                        Some(buffer) if buffer.run_id == payload.run_id => {
                            buffer.data.push_str(&payload.data);
                            if buffer.data.len() >= TERMINAL_EVENT_FLUSH_THRESHOLD {
                                flush_terminal_run_output_buffer(
                                    &app,
                                    &state,
                                    &session_id,
                                    &mut run_output_buffer,
                                );
                            }
                        }
                        Some(_) => {
                            flush_terminal_run_output_buffer(
                                &app,
                                &state,
                                &session_id,
                                &mut run_output_buffer,
                            );
                            run_output_buffer = Some(payload);
                        }
                        None => {
                            run_output_buffer = Some(payload);
                        }
                    }
                }
                Ok(TerminalEmitterMessage::RunComplete(payload)) => {
                    flush_terminal_data_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut visible_output_buffer,
                    );
                    flush_terminal_run_output_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut run_output_buffer,
                    );
                    emit_terminal_run_complete(&app, payload);
                }
                Ok(TerminalEmitterMessage::Close) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    flush_terminal_data_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut visible_output_buffer,
                    );
                    flush_terminal_run_output_buffer(
                        &app,
                        &state,
                        &session_id,
                        &mut run_output_buffer,
                    );
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        flush_terminal_data_buffer(&app, &state, &session_id, &mut visible_output_buffer);
        flush_terminal_run_output_buffer(&app, &state, &session_id, &mut run_output_buffer);
    });
}

fn send_terminal_stream_update(
    sender: &mpsc::Sender<TerminalEmitterMessage>,
    update: TerminalRunStreamUpdate,
) {
    for message in update.messages {
        let _ = sender.send(message);
    }
}

fn spawn_terminal_reader(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let (sender, receiver) = mpsc::channel::<TerminalEmitterMessage>();
    spawn_terminal_event_emitter(app, state, session_id.clone(), receiver);

    thread::spawn(move || {
        let mut buffer = [0_u8; TERMINAL_READ_BUFFER_SIZE];
        let mut decoded_chunk = String::new();
        let mut decoder = TerminalUtf8ChunkDecoder::default();
        let mut parser = TerminalRunStreamParser::default();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    decoded_chunk.clear();
                    decoder.decode_into(&buffer[..size], &mut decoded_chunk, false);
                    if decoded_chunk.is_empty() {
                        continue;
                    }

                    let update = parser.push_chunk(&session_id, &decoded_chunk);
                    send_terminal_stream_update(&sender, update);
                }
                Err(_) => break,
            }
        }

        decoded_chunk.clear();
        decoder.decode_into(&[], &mut decoded_chunk, true);
        if !decoded_chunk.is_empty() {
            let update = parser.push_chunk(&session_id, &decoded_chunk);
            send_terminal_stream_update(&sender, update);
        }

        let trailing_update = parser.finish(&session_id);
        send_terminal_stream_update(&sender, trailing_update);

        let _ = sender.send(TerminalEmitterMessage::Close);
    });
}

fn spawn_terminal_waiter(
    app: AppHandle,
    state: TerminalSessionState,
    session_id: String,
    mut child: Box<dyn Child + Send + Sync>,
) {
    thread::spawn(move || {
        let exit_code = child
            .wait()
            .ok()
            .and_then(|status| i32::try_from(status.exit_code()).ok());

        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.remove(&session_id);
        }
        if let Ok(mut snapshots) = state.snapshots.lock() {
            snapshots.remove(&session_id);
        }

        emit_terminal_exit(
            &app,
            TerminalExitEvent {
                session_id,
                exit_code,
            },
        );
    });
}

impl TerminalUtf8ChunkDecoder {
    fn decode_into(&mut self, input: &[u8], output: &mut String, last: bool) {
        if !input.is_empty() {
            self.pending.extend_from_slice(input);
        }

        loop {
            if self.pending.is_empty() {
                return;
            }

            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();

                    if valid_up_to > 0 {
                        if let Ok(valid_prefix) = std::str::from_utf8(&self.pending[..valid_up_to])
                        {
                            output.push_str(valid_prefix);
                        }
                        self.pending.drain(..valid_up_to);
                        continue;
                    }

                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..error_len);
                        continue;
                    }

                    if last {
                        output.push('\u{FFFD}');
                        self.pending.clear();
                    }

                    return;
                }
            }
        }
    }
}

fn resolve_terminal_marker_remainder_start(value: &str) -> usize {
    let max_tail_length = TERMINAL_RUN_MARKER_PREFIX.len().saturating_sub(1);

    for (index, _) in value.char_indices().rev() {
        if value.len().saturating_sub(index) > max_tail_length {
            break;
        }

        if TERMINAL_RUN_MARKER_PREFIX.starts_with(&value[index..]) {
            return index;
        }
    }

    value.len()
}

fn split_terminal_marker_chunk(value: &str) -> TerminalMarkerChunk<'_> {
    let Some(marker_start_index) = value.find(TERMINAL_RUN_MARKER_PREFIX) else {
        let remainder_start_index = resolve_terminal_marker_remainder_start(value);
        return TerminalMarkerChunk {
            before: &value[..remainder_start_index],
            marker_token: None,
            remainder: &value[remainder_start_index..],
        };
    };

    let marker_content_start_index = marker_start_index + TERMINAL_RUN_MARKER_PREFIX.len();
    let Some(marker_end_offset) =
        value[marker_content_start_index..].find(TERMINAL_RUN_MARKER_SUFFIX)
    else {
        return TerminalMarkerChunk {
            before: &value[..marker_start_index],
            marker_token: None,
            remainder: &value[marker_start_index..],
        };
    };

    let marker_end_index = marker_content_start_index + marker_end_offset;
    TerminalMarkerChunk {
        before: &value[..marker_start_index],
        marker_token: Some(&value[marker_content_start_index..marker_end_index]),
        remainder: &value[marker_end_index + TERMINAL_RUN_MARKER_SUFFIX.len_utf8()..],
    }
}

fn parse_terminal_run_marker_token(value: &str) -> TerminalRunMarkerToken<'_> {
    if let Some(run_id) = value.strip_prefix(TERMINAL_RUN_START_MARKER_PREFIX) {
        return TerminalRunMarkerToken::Start(run_id);
    }

    if let Some(rest) = value.strip_prefix(TERMINAL_RUN_END_MARKER_PREFIX) {
        if let Some((run_id, exit_code)) = rest.rsplit_once(':') {
            return TerminalRunMarkerToken::End {
                run_id,
                exit_code: exit_code.parse::<i32>().ok(),
            };
        }
    }

    TerminalRunMarkerToken::Unknown
}

impl TerminalRunStreamParser {
    fn push_chunk(&mut self, session_id: &str, chunk: &str) -> TerminalRunStreamUpdate {
        self.buffer.push_str(chunk);
        let mut update = TerminalRunStreamUpdate::new();

        loop {
            if let Some(run_id) = self.active_run_id.clone() {
                let marker_chunk = split_terminal_marker_chunk(&self.buffer);
                if !marker_chunk.before.is_empty() {
                    let data = marker_chunk.before.to_string();
                    update.push_run_output(session_id, run_id.clone(), data);
                }

                let marker_token = marker_chunk.marker_token.map(str::to_owned);
                self.buffer = marker_chunk.remainder.to_string();
                let Some(marker_token) = marker_token else {
                    break;
                };

                match parse_terminal_run_marker_token(&marker_token) {
                    TerminalRunMarkerToken::Start(next_run_id) => {
                        if run_id != next_run_id {
                            update.push_completed_run(session_id, run_id, None);
                        }
                        self.active_run_id = Some(next_run_id.to_string());
                    }
                    TerminalRunMarkerToken::End {
                        run_id: completed_run_id,
                        exit_code,
                    } => {
                        if run_id != completed_run_id {
                            update.push_completed_run(session_id, run_id, None);
                        }
                        update.push_completed_run(
                            session_id,
                            completed_run_id.to_string(),
                            exit_code,
                        );
                        self.active_run_id = None;
                    }
                    TerminalRunMarkerToken::Unknown => {
                        self.active_run_id = Some(run_id);
                    }
                }

                continue;
            }

            let marker_chunk = split_terminal_marker_chunk(&self.buffer);
            if !marker_chunk.before.is_empty() {
                update.push_visible_output(marker_chunk.before);
            }

            let marker_token = marker_chunk.marker_token.map(str::to_owned);
            self.buffer = marker_chunk.remainder.to_string();
            let Some(marker_token) = marker_token else {
                break;
            };

            match parse_terminal_run_marker_token(&marker_token) {
                TerminalRunMarkerToken::Start(run_id) => {
                    self.active_run_id = Some(run_id.to_string());
                }
                TerminalRunMarkerToken::End { run_id, exit_code } => {
                    update.push_completed_run(session_id, run_id.to_string(), exit_code);
                }
                TerminalRunMarkerToken::Unknown => {}
            }
        }

        update
    }

    fn finish(&mut self, session_id: &str) -> TerminalRunStreamUpdate {
        let mut update = TerminalRunStreamUpdate::new();

        if let Some(run_id) = self.active_run_id.take() {
            if !self.buffer.is_empty() {
                let data = std::mem::take(&mut self.buffer);
                update.push_run_output(session_id, run_id.clone(), data);
            }

            update.push_completed_run(session_id, run_id, None);

            return update;
        }

        if !self.buffer.is_empty() {
            let visible_output = std::mem::take(&mut self.buffer);
            update.push_visible_output(&visible_output);
        }

        update
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_terminal_dispatch_runner_content, parse_terminal_run_marker_token,
        DispatchTerminalScriptRequest, TerminalEmitterMessage, TerminalPreparedScript,
        TerminalRunCompleteEvent, TerminalRunMarkerToken, TerminalRunOutputEvent,
        TerminalRunStreamParser, TerminalRunStreamUpdate, TERMINAL_RUN_END_MARKER_PREFIX,
        TERMINAL_RUN_MARKER_PREFIX, TERMINAL_RUN_MARKER_SUFFIX, TERMINAL_RUN_START_MARKER_PREFIX,
    };

    fn build_marker(token: &str) -> String {
        format!("{TERMINAL_RUN_MARKER_PREFIX}{token}{TERMINAL_RUN_MARKER_SUFFIX}")
    }

    fn collect_visible_output(update: &TerminalRunStreamUpdate) -> String {
        update
            .messages
            .iter()
            .filter_map(|message| match message {
                TerminalEmitterMessage::VisibleOutput(value) => Some(value.as_str()),
                _ => None,
            })
            .collect()
    }

    fn collect_run_output_events(update: &TerminalRunStreamUpdate) -> Vec<&TerminalRunOutputEvent> {
        update
            .messages
            .iter()
            .filter_map(|message| match message {
                TerminalEmitterMessage::RunOutput(value) => Some(value),
                _ => None,
            })
            .collect()
    }

    fn collect_completed_runs(update: &TerminalRunStreamUpdate) -> Vec<&TerminalRunCompleteEvent> {
        update
            .messages
            .iter()
            .filter_map(|message| match message {
                TerminalEmitterMessage::RunComplete(value) => Some(value),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn parse_terminal_run_marker_token_recognizes_end_marker() {
        let token = format!("{TERMINAL_RUN_END_MARKER_PREFIX}run-1:0");

        match parse_terminal_run_marker_token(&token) {
            TerminalRunMarkerToken::End { run_id, exit_code } => {
                assert_eq!(run_id, "run-1");
                assert_eq!(exit_code, Some(0));
            }
            _ => panic!("expected end marker"),
        }
    }

    #[test]
    fn parser_completes_run_when_only_end_marker_is_seen() {
        let run_id = "terminal-run-short";
        let mut parser = TerminalRunStreamParser::default();
        let update = parser.push_chunk(
            "session-1",
            &format!(
                "111\n{}$ ",
                build_marker(&format!("{TERMINAL_RUN_END_MARKER_PREFIX}{run_id}:0")),
            ),
        );

        let completed_runs = collect_completed_runs(&update);
        assert_eq!(collect_visible_output(&update), "111\n$ ");
        assert!(collect_run_output_events(&update).is_empty());
        assert_eq!(completed_runs.len(), 1);
        assert_eq!(completed_runs[0].run_id, run_id);
        assert_eq!(completed_runs[0].exit_code, Some(0));
    }

    #[test]
    fn parser_keeps_normal_start_output_end_flow() {
        let run_id = "terminal-run-normal";
        let mut parser = TerminalRunStreamParser::default();

        let start_update = parser.push_chunk(
            "session-1",
            &format!(
                "$ /bin/bash /tmp/sh-editor-dispatch.sh\n{}",
                build_marker(&format!("{TERMINAL_RUN_START_MARKER_PREFIX}{run_id}")),
            ),
        );
        assert_eq!(
            collect_visible_output(&start_update),
            "$ /bin/bash /tmp/sh-editor-dispatch.sh\n"
        );
        assert!(collect_completed_runs(&start_update).is_empty());

        let output_update = parser.push_chunk("session-1", "111\n");
        let output_events = collect_run_output_events(&output_update);
        assert_eq!(output_events.len(), 1);
        assert_eq!(output_events[0].run_id, run_id);
        assert_eq!(output_events[0].data, "111\n");

        let end_update = parser.push_chunk(
            "session-1",
            &format!(
                "{}$ ",
                build_marker(&format!("{TERMINAL_RUN_END_MARKER_PREFIX}{run_id}:0")),
            ),
        );
        let completed_runs = collect_completed_runs(&end_update);
        assert_eq!(collect_visible_output(&end_update), "$ ");
        assert_eq!(completed_runs.len(), 1);
        assert_eq!(completed_runs[0].run_id, run_id);
        assert_eq!(completed_runs[0].exit_code, Some(0));
    }

    #[test]
    fn parser_keeps_run_output_before_prompt_when_end_marker_shares_chunk() {
        let run_id = "terminal-run-order";
        let mut parser = TerminalRunStreamParser::default();
        let _ = parser.push_chunk(
            "session-1",
            &build_marker(&format!("{TERMINAL_RUN_START_MARKER_PREFIX}{run_id}")),
        );

        let update = parser.push_chunk(
            "session-1",
            &format!(
                "last line\n{}$ ",
                build_marker(&format!("{TERMINAL_RUN_END_MARKER_PREFIX}{run_id}:0")),
            ),
        );

        assert_eq!(update.messages.len(), 3);
        match &update.messages[0] {
            TerminalEmitterMessage::RunOutput(payload) => {
                assert_eq!(payload.data, "last line\n");
                assert_eq!(payload.run_id, run_id);
            }
            _ => panic!("expected run output before completion"),
        }
        match &update.messages[1] {
            TerminalEmitterMessage::RunComplete(payload) => {
                assert_eq!(payload.run_id, run_id);
                assert_eq!(payload.exit_code, Some(0));
            }
            _ => panic!("expected run completion after output"),
        }
        match &update.messages[2] {
            TerminalEmitterMessage::VisibleOutput(value) => {
                assert_eq!(value, "$ ");
            }
            _ => panic!("expected prompt after completion marker"),
        }
    }

    #[test]
    fn dispatch_runner_uses_exit_trap_to_emit_completion_marker() {
        let payload = DispatchTerminalScriptRequest {
            session_id: "main-terminal".to_string(),
            path: Some("D:/workspace/test.sh".to_string()),
            content: "#!/usr/bin/env bash\necho ok\n".to_string(),
            is_dirty: false,
            run_id: "terminal-run-trap".to_string(),
        };
        let prepared = TerminalPreparedScript {
            execution_path: "/mnt/d/workspace/test.sh".to_string(),
            working_directory: "/mnt/d/workspace".to_string(),
            used_temp_file: false,
            should_cleanup_execution_path: false,
            should_materialize_inline_content: false,
        };

        let content =
            build_terminal_dispatch_runner_content(&payload, &prepared, "rm -f \"$0\"", "");

        assert!(content.contains("trap '__sh_editor_exit_code=$?; __sh_editor_cleanup' EXIT"));
        assert!(content.contains("trap '__sh_editor_exit_code=130; exit 130' INT"));
        assert!(content.contains("trap '__sh_editor_exit_code=143; exit 143' TERM"));
        assert!(content.contains("__sh_editor_finish() {"));
        assert!(content.contains(TERMINAL_RUN_END_MARKER_PREFIX));
        assert!(content.contains("exit \"$__sh_editor_exit_code\""));
    }
}

fn prepare_terminal_dispatch_script(
    payload: &DispatchTerminalScriptRequest,
    terminal_working_directory: &str,
) -> Result<TerminalPreparedScript, String> {
    let preferred_path = payload.path.as_ref().map(PathBuf::from);
    let working_directory = preferred_path
        .as_ref()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| to_wsl_path(&path))
        .transpose()?
        .unwrap_or_else(|| terminal_working_directory.to_string());

    let has_existing_preferred_path = preferred_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let should_use_temp = payload.is_dirty || !has_existing_preferred_path;

    if should_use_temp {
        if !payload.is_dirty && preferred_path.is_some() && payload.content.is_empty() {
            return Err("脚本文件不存在或不可访问，请保存后再运行。".to_string());
        }

        let file_name = preferred_path
            .as_ref()
            .and_then(|path| path.file_name().and_then(|value| value.to_str()))
            .unwrap_or("untitled.sh");
        let temp_path = build_terminal_temp_script_path(file_name)?;
        return Ok(TerminalPreparedScript {
            execution_path: temp_path,
            working_directory,
            used_temp_file: true,
            should_cleanup_execution_path: true,
            should_materialize_inline_content: true,
        });
    }

    let execution_path = preferred_path.ok_or_else(|| "脚本路径无效。".to_string())?;
    Ok(TerminalPreparedScript {
        execution_path: to_wsl_path(&execution_path)?,
        working_directory,
        used_temp_file: false,
        should_cleanup_execution_path: false,
        should_materialize_inline_content: false,
    })
}

fn build_terminal_run_command(
    payload: &DispatchTerminalScriptRequest,
    terminal_working_directory: &str,
) -> Result<TerminalDispatchCommand, String> {
    let prepared = prepare_terminal_dispatch_script(payload, terminal_working_directory)?;
    let runner_path = create_terminal_dispatch_runner(payload, &prepared)?;

    Ok(TerminalDispatchCommand {
        raw_command: format!("/bin/bash {}", bash_quote(&runner_path)),
        display_command: format!("/bin/bash {}", bash_quote(&runner_path)),
        used_temp_file: prepared.used_temp_file,
    })
}

fn build_terminal_dispatch_runner_content(
    payload: &DispatchTerminalScriptRequest,
    prepared: &TerminalPreparedScript,
    cleanup_command: &str,
    materialize_inline_script: &str,
) -> String {
    format!(
        concat!(
            "#!/usr/bin/env bash\n",
            "set +x\n",
            "i={}\n",
            "t={}\n",
            "wd={}\n",
            "__sh_editor_exit_code=0\n",
            "__sh_editor_finalized=0\n",
            "__sh_editor_finish() {{\n",
            "  local exit_code=\"${{__sh_editor_exit_code:-$?}}\"\n",
            "  if [ \"${{__sh_editor_finalized:-0}}\" -eq 1 ]; then\n",
            "    return\n",
            "  fi\n",
            "  __sh_editor_finalized=1\n",
            "  printf '%b%s%s:%s%b' {} {} \"$i\" \"$exit_code\" {}\n",
            "}}\n",
            "__sh_editor_cleanup() {{\n",
            "  __sh_editor_finish\n",
            "  {}\n",
            "}}\n",
            "trap '__sh_editor_exit_code=$?; __sh_editor_cleanup' EXIT\n",
            "trap '__sh_editor_exit_code=129; exit 129' HUP\n",
            "trap '__sh_editor_exit_code=130; exit 130' INT\n",
            "trap '__sh_editor_exit_code=143; exit 143' TERM\n",
            "{}",
            "printf '%b%s%s%b' {} {} \"$i\" {}\n",
            "if cd \"$wd\"; then\n",
            "  bash \"$t\"\n",
            "  __sh_editor_exit_code=$?\n",
            "else\n",
            "  __sh_editor_exit_code=$?\n",
            "fi\n",
            "exit \"$__sh_editor_exit_code\"\n",
        ),
        bash_quote(&payload.run_id),
        bash_quote(&prepared.execution_path),
        bash_quote(&prepared.working_directory),
        bash_quote(TERMINAL_RUN_MARKER_ESCAPED_PREFIX),
        bash_quote(TERMINAL_RUN_END_MARKER_PREFIX),
        bash_quote(TERMINAL_RUN_MARKER_ESCAPED_SUFFIX),
        cleanup_command,
        materialize_inline_script,
        bash_quote(TERMINAL_RUN_MARKER_ESCAPED_PREFIX),
        bash_quote(TERMINAL_RUN_START_MARKER_PREFIX),
        bash_quote(TERMINAL_RUN_MARKER_ESCAPED_SUFFIX),
    )
}

fn create_terminal_dispatch_runner(
    payload: &DispatchTerminalScriptRequest,
    prepared: &TerminalPreparedScript,
) -> Result<String, String> {
    let runner_path = build_terminal_dispatch_runner_path()?;
    let cleanup_command = if prepared.should_cleanup_execution_path {
        "rm -f \"$0\" \"$t\""
    } else {
        "rm -f \"$0\""
    };
    let materialize_inline_script = if prepared.should_materialize_inline_content {
        format!("printf '%s' {} > \"$t\"\n", bash_quote(&payload.content))
    } else {
        String::new()
    };
    let runner_content = build_terminal_dispatch_runner_content(
        payload,
        prepared,
        cleanup_command,
        &materialize_inline_script,
    );

    write_wsl_file(&runner_path, runner_content.as_bytes())
        .map_err(|error| format!("写入终端调度脚本失败：{error}"))?;

    Ok(runner_path)
}

pub(crate) fn to_wsl_path(path: &Path) -> Result<String, String> {
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let normalized = normalize_windows_path_for_wsl(&normalized)?;

    let drive_letter = normalized
        .chars()
        .next()
        .ok_or_else(|| "无法识别 Windows 路径。".to_string())?;

    if !drive_letter.is_ascii_alphabetic() || !normalized.contains(':') {
        return Err("仅支持 Windows 本地磁盘路径转换为 WSL 路径。".into());
    }

    let rest = normalized
        .get(2..)
        .ok_or_else(|| "Windows 路径格式无效。".to_string())?;

    Ok(format!(
        "/mnt/{}/{}",
        drive_letter.to_ascii_lowercase(),
        rest.replace('\\', "/").trim_start_matches('/'),
    ))
}

fn normalize_windows_path_for_wsl(value: &str) -> Result<String, String> {
    if let Some(network_path) = value.strip_prefix(r"\\?\UNC\") {
        return Err(format!(
            "暂不支持将网络共享路径转换为 WSL 路径：\\\\{}",
            network_path
        ));
    }

    if let Some(extended_path) = value.strip_prefix(r"\\?\") {
        return Ok(extended_path.to_string());
    }

    Ok(value.to_string())
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
