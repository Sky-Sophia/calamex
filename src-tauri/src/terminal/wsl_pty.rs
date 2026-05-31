// 终端域：本地 PTY（Windows 原生 ConPTY）直接驱动 wsl.exe 的交互式 WSL2 终端。
//
// 这是“自研 gRPC supervisor + WSL Link agent”链路的替代实现：不再依赖 vsock /
// gRPC / Noise / 旁路 agent，而是用 portable-pty 在桌面进程内直接拉起 wsl.exe，
// 与 VS Code、Windows Terminal 走同一套官方方案。
//
// 为把命令层（commands/terminal.rs）的改动降到最低，本模块复用 wsl_link 既有的
// WslLinkTerminalServerPayload 事件类型与 UTF-8 分块解码器；后续 PR 会把这些类型
// 从 wsl_link 迁出后再清理依赖。

use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::{
    native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize, PtySystem, SlavePty,
};
use thiserror::Error;

use crate::wsl_link::terminal_exec::{
    WslLinkTerminalInteractiveClosed, WslLinkTerminalInteractiveData,
    WslLinkTerminalInteractiveOpened, WslLinkTerminalOpenInteractiveRequest,
    WslLinkTerminalServerPayload, WslLinkUtf8ChunkDecoder,
};

const TERMINAL_READ_BUFFER_BYTES: usize = 8192;

#[derive(Debug, Error)]
pub enum LocalWslPtyError {
    #[error("打开本地 WSL 终端失败：{0}")]
    Open(String),
    #[error("WSL 终端写入失败：{0}")]
    Write(String),
    #[error("WSL 终端调整尺寸失败：{0}")]
    Resize(String),
    #[error("WSL 终端关闭失败：{0}")]
    Close(String),
}

/// 本地 PTY 交互式终端句柄。
///
/// 对外方法签名与原 WslLinkInteractiveTerminalHandle 完全一致（session_id /
/// write_input / resize / close），因此命令层可无差别替换。
#[derive(Clone)]
pub struct LocalWslPtyHandle {
    session_id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
}

impl LocalWslPtyHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub async fn write_input(&self, data: String) -> Result<(), LocalWslPtyError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| LocalWslPtyError::Write("终端写入锁已损坏。".to_string()))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|error| LocalWslPtyError::Write(error.to_string()))?;
        writer
            .flush()
            .map_err(|error| LocalWslPtyError::Write(error.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), LocalWslPtyError> {
        let master = self
            .master
            .lock()
            .map_err(|_| LocalWslPtyError::Resize("终端尺寸锁已损坏。".to_string()))?;
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| LocalWslPtyError::Resize(error.to_string()))
    }

    pub fn close(&self) -> Result<(), LocalWslPtyError> {
        let mut killer = self
            .killer
            .lock()
            .map_err(|_| LocalWslPtyError::Close("终端终止锁已损坏。".to_string()))?;
        killer
            .kill()
            .map_err(|error| LocalWslPtyError::Close(error.to_string()))
    }
}

/// 打开一个本地 PTY 交互式 WSL2 终端。
///
/// on_event 在独立读线程中被调用，事件序列与 WSL Link 路径一致：
/// InteractiveOpened → 若干 InteractiveData → InteractiveClosed。
pub fn open_interactive_terminal_local<F>(
    request: WslLinkTerminalOpenInteractiveRequest,
    on_event: F,
) -> Result<LocalWslPtyHandle, LocalWslPtyError>
where
    F: FnMut(WslLinkTerminalServerPayload) + Send + 'static,
{
    request
        .validate()
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))?;

    let session_id = request.session_id.clone();
    let working_directory = normalize_interactive_cwd(&request.working_directory);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: request.rows.max(1),
            cols: request.cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))?;

    let mut command = CommandBuilder::new("wsl.exe");
    command.arg("--cd");
    command.arg(&working_directory);
    command.arg("--");
    command.arg("bash");
    command.arg("-il");
    // 让 wsl.exe 自身的诊断信息以 UTF-8 输出，根治 UTF-16LE 造成的终端乱码。
    command.env("WSL_UTF8", "1");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))?;
    // 拿到 child 后立即释放 slave，否则读端不会在子进程退出时收到 EOF。
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))?;
    let killer = child.clone_killer();
    let pid = child.process_id().unwrap_or_default();

    spawn_interactive_reader(
        session_id.clone(),
        working_directory,
        pid,
        reader,
        child,
        on_event,
    )?;

    Ok(LocalWslPtyHandle {
        session_id,
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        killer: Arc::new(Mutex::new(killer)),
    })
}

fn spawn_interactive_reader<F>(
    session_id: String,
    working_directory: String,
    pid: u32,
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    mut on_event: F,
) -> Result<(), LocalWslPtyError>
where
    F: FnMut(WslLinkTerminalServerPayload) + Send + 'static,
{
    std::thread::Builder::new()
        .name(format!("wsl-pty-{session_id}"))
        .spawn(move || {
            on_event(WslLinkTerminalServerPayload::InteractiveOpened(
                WslLinkTerminalInteractiveOpened {
                    session_id: session_id.clone(),
                    cwd: working_directory,
                    pid,
                    opened_at_unix_ms: now_unix_ms(),
                },
            ));

            let mut decoder = WslLinkUtf8ChunkDecoder::default();
            let mut buffer = [0u8; TERMINAL_READ_BUFFER_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let mut decoded = String::new();
                        decoder.decode_into(&buffer[..read], &mut decoded, false);
                        if !decoded.is_empty() {
                            on_event(WslLinkTerminalServerPayload::InteractiveData(
                                WslLinkTerminalInteractiveData {
                                    session_id: session_id.clone(),
                                    data: decoded,
                                },
                            ));
                        }
                    }
                    Err(_) => break,
                }
            }

            let mut tail = String::new();
            decoder.decode_into(&[], &mut tail, true);
            if !tail.is_empty() {
                on_event(WslLinkTerminalServerPayload::InteractiveData(
                    WslLinkTerminalInteractiveData {
                        session_id: session_id.clone(),
                        data: tail,
                    },
                ));
            }

            let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
            on_event(WslLinkTerminalServerPayload::InteractiveClosed(
                WslLinkTerminalInteractiveClosed {
                    session_id,
                    exit_code,
                    finished_at_unix_ms: now_unix_ms(),
                },
            ));
        })
        .map(|_| ())
        .map_err(|error| LocalWslPtyError::Open(error.to_string()))
}

fn normalize_interactive_cwd(working_directory: &str) -> String {
    let trimmed = working_directory.trim();
    if trimmed.is_empty() {
        "~".to_string()
    } else {
        trimmed.to_string()
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactive_cwd_defaults_to_home_when_blank() {
        assert_eq!(normalize_interactive_cwd("   "), "~");
        assert_eq!(normalize_interactive_cwd(""), "~");
    }

    #[test]
    fn interactive_cwd_preserves_explicit_directory() {
        assert_eq!(
            normalize_interactive_cwd("/mnt/d/com.xiaojianc/my_desktop_app"),
            "/mnt/d/com.xiaojianc/my_desktop_app"
        );
    }

    #[test]
    fn now_unix_ms_is_positive() {
        assert!(now_unix_ms() > 0);
    }
}
