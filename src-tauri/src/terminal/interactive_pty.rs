use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::types::{Geometry, SessionId};

const INTERACTIVE_READ_BUFFER_SIZE: usize = 64 * 1024;

pub struct InteractivePty {
    session_id: SessionId,
    cwd: String,
    geometry: Mutex<Geometry>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    is_alive: Arc<AtomicBool>,
    scrollback: Arc<Mutex<Vec<u8>>>,
    subscribers: Arc<Mutex<Vec<mpsc::Sender<Vec<u8>>>>>,
}

impl InteractivePty {
    pub fn spawn(session_id: SessionId, cwd: PathBuf, geometry: Geometry) -> Result<Self, String> {
        let wsl_command_path = resolve_wsl_command_path()?;
        let wsl_cwd = resolve_wsl_cwd(&cwd)?;
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(normalize_pty_size(geometry))
            .map_err(|error| format!("创建 iPTY 失败：{error}"))?;

        let mut command = CommandBuilder::new(wsl_command_path.to_string_lossy().as_ref());
        command.arg("--cd");
        command.arg(&wsl_cwd);
        command.arg("--");
        command.arg("/bin/bash");
        command.arg("-il");
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let mut child = pty_pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("启动 iPTY 失败：{error}"))?;
        let killer = child.clone_killer();
        drop(pty_pair.slave);

        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("初始化 iPTY 读通道失败：{error}"))?;
        let writer = pty_pair
            .master
            .take_writer()
            .map_err(|error| format!("初始化 iPTY 写通道失败：{error}"))?;
        let writer = Arc::new(Mutex::new(writer));
        let scrollback = Arc::new(Mutex::new(Vec::new()));
        let subscribers = Arc::new(Mutex::new(Vec::<mpsc::Sender<Vec<u8>>>::new()));
        let is_alive = Arc::new(AtomicBool::new(true));

        {
            let is_alive = Arc::clone(&is_alive);
            thread::spawn(move || {
                let _ = child.wait();
                is_alive.store(false, Ordering::SeqCst);
            });
        }

        {
            let scrollback = Arc::clone(&scrollback);
            let subscribers = Arc::clone(&subscribers);
            let writer = Arc::clone(&writer);
            thread::spawn(move || {
                let mut buffer = [0_u8; INTERACTIVE_READ_BUFFER_SIZE];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(size) => {
                            let chunk = buffer[..size].to_vec();
                            if contains_cursor_position_query(&chunk) {
                                if let Ok(mut writer) = writer.lock() {
                                    let _ = writer.write_all(b"\x1b[1;1R");
                                    let _ = writer.flush();
                                }
                            }
                            if let Ok(mut scrollback) = scrollback.lock() {
                                scrollback.extend_from_slice(&chunk);
                            }
                            if let Ok(mut subscribers) = subscribers.lock() {
                                subscribers
                                    .retain(|subscriber| subscriber.send(chunk.clone()).is_ok());
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(Self {
            session_id,
            cwd: wsl_cwd,
            geometry: Mutex::new(geometry),
            master: Mutex::new(pty_pair.master),
            writer,
            killer: Mutex::new(killer),
            is_alive,
            scrollback,
            subscribers,
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn cwd(&self) -> &str {
        &self.cwd
    }

    pub fn write_input(&self, data: &[u8]) -> Result<(), String> {
        if !self.is_alive() {
            return Err("iPTY 已退出，无法写入输入。".to_string());
        }
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "iPTY 写入通道已损坏。".to_string())?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| format!("写入 iPTY 输入失败：{error}"))
    }

    pub fn resize(&self, geometry: Geometry) -> Result<(), String> {
        {
            let mut current = self
                .geometry
                .lock()
                .map_err(|_| "iPTY 尺寸状态已损坏。".to_string())?;
            *current = geometry;
        }
        let master = self
            .master
            .lock()
            .map_err(|_| "iPTY 尺寸通道已损坏。".to_string())?;
        master
            .resize(normalize_pty_size(geometry))
            .map_err(|error| format!("同步 iPTY 尺寸失败：{error}"))
    }

    pub fn geometry(&self) -> Result<Geometry, String> {
        self.geometry
            .lock()
            .map(|geometry| *geometry)
            .map_err(|_| "iPTY 尺寸状态已损坏。".to_string())
    }

    pub fn is_alive(&self) -> bool {
        self.is_alive.load(Ordering::SeqCst)
    }

    pub fn subscribe_data(&self) -> mpsc::Receiver<Vec<u8>> {
        let (sender, receiver) = mpsc::channel();
        if let Ok(scrollback) = self.scrollback.lock() {
            if !scrollback.is_empty() {
                let _ = sender.send(scrollback.clone());
            }
        }
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    pub fn terminate(&self) -> Result<(), String> {
        let mut killer = self
            .killer
            .lock()
            .map_err(|_| "iPTY 结束通道已损坏。".to_string())?;
        killer
            .kill()
            .map_err(|error| format!("关闭 iPTY 失败：{error}"))
    }
}

fn normalize_pty_size(geometry: Geometry) -> PtySize {
    PtySize {
        cols: geometry.cols.max(2),
        rows: geometry.rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn contains_cursor_position_query(data: &[u8]) -> bool {
    data.windows(4).any(|window| window == b"\x1b[6n")
}

fn resolve_wsl_command_path() -> Result<PathBuf, String> {
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let candidate = system_root.join("System32").join("wsl.exe");
    if candidate.exists() {
        return Ok(candidate);
    }
    let fallback = PathBuf::from(r"C:\Windows\System32\wsl.exe");
    if fallback.exists() {
        return Ok(fallback);
    }
    Err("未找到 wsl.exe。".to_string())
}

fn resolve_wsl_cwd(cwd: &Path) -> Result<String, String> {
    let raw = cwd.to_string_lossy().to_string();
    if raw == "~" || raw.starts_with('/') {
        return Ok(raw);
    }
    to_wsl_path(cwd)
}

fn to_wsl_path(path: &Path) -> Result<String, String> {
    let normalized = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();
    let normalized = normalized.strip_prefix(r"\\?\").unwrap_or(&normalized);
    let drive_letter = normalized
        .chars()
        .next()
        .ok_or_else(|| "无法识别 Windows 路径。".to_string())?;
    if !drive_letter.is_ascii_alphabetic() || !normalized.contains(':') {
        return Err(format!("无法转换为 WSL 路径：{normalized}"));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        process::{Command, Stdio},
        sync::{Arc, Mutex},
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn test_ipty_spawns_and_emits_first_prompt() {
        let _guard = crate::terminal::test_support::wsl_test_guard();
        let ipty = InteractivePty::spawn(
            "ipty-test".to_string(),
            PathBuf::from("~"),
            Geometry {
                cols: 120,
                rows: 40,
            },
        )
        .expect("iPTY should spawn");
        let rx = ipty.subscribe_data();
        let output = collect_until(&rx, Duration::from_secs(3), |value| {
            value.contains('$') || value.contains('#')
        });
        let _ = ipty.terminate();

        assert!(
            output.contains('$') || output.contains('#'),
            "iPTY 3s 内未出现 prompt，output={output:?}"
        );
    }

    #[test]
    fn test_ipty_no_motd_repeat_on_subscribe() {
        let _guard = crate::terminal::test_support::wsl_test_guard();
        let ipty = InteractivePty::spawn(
            "ipty-subscribe-test".to_string(),
            PathBuf::from("~"),
            Geometry {
                cols: 120,
                rows: 40,
            },
        )
        .expect("iPTY should spawn");
        let first_rx = ipty.subscribe_data();
        let first = collect_until(&first_rx, Duration::from_secs(3), |value| {
            value.contains('$') || value.contains('#')
        });
        let second_rx = ipty.subscribe_data();
        let second = collect_until(&second_rx, Duration::from_millis(500), |value| {
            !value.is_empty()
        });
        let _ = ipty.terminate();

        assert!(!first.is_empty());
        assert_eq!(
            first.matches("sudo <command>").count(),
            second.matches("sudo <command>").count()
        );
    }

    #[test]
    fn test_resize_propagates_to_ipty() {
        let _guard = crate::terminal::test_support::wsl_test_guard();
        let ipty = InteractivePty::spawn(
            "ipty-resize-test".to_string(),
            PathBuf::from("~"),
            Geometry { cols: 80, rows: 24 },
        )
        .expect("iPTY should spawn");
        ipty.resize(Geometry {
            cols: 120,
            rows: 40,
        })
        .expect("resize should work");
        let geometry = ipty.geometry().expect("geometry should be readable");
        let _ = ipty.terminate();

        assert_eq!(
            geometry,
            Geometry {
                cols: 120,
                rows: 40
            }
        );
    }

    #[test]
    fn test_ipty_isolation_from_rpty_bytes() {
        let _guard = crate::terminal::test_support::wsl_test_guard();
        let ipty = InteractivePty::spawn(
            "ipty-isolation-test".to_string(),
            PathBuf::from("~"),
            Geometry {
                cols: 120,
                rows: 40,
            },
        )
        .expect("iPTY should spawn");
        let rx = ipty.subscribe_data();
        let _ = collect_until(&rx, Duration::from_secs(3), |value| {
            value.contains('$') || value.contains('#')
        });

        let wsl_path = resolve_wsl_command_path().expect("wsl should resolve");
        let script_path = format!("/tmp/calamex-ipty-isolation-{}.sh", now_ms_for_tests());
        write_wsl_script_for_tests(&wsl_path, &script_path, "printf '__RPTY_ONLY__\\n'\n");
        let rpty_output = Arc::new(Mutex::new(String::new()));
        let rpty_output_ref = Arc::clone(&rpty_output);
        let exit = crate::terminal::run_supervisor::run_pty_script(
            crate::terminal::run_supervisor::RunPtySpec {
                wsl_command_path: wsl_path.clone(),
                working_directory: "/tmp".to_string(),
                execution_path: script_path.clone(),
                cols: 120,
                rows: 40,
                timeout: Some(Duration::from_secs(8)),
            },
            move |chunk| {
                rpty_output_ref
                    .lock()
                    .expect("rPTY output mutex")
                    .push_str(&chunk);
            },
        )
        .expect("rPTY should run");
        cleanup_wsl_path_for_tests(&wsl_path, &script_path);
        let leaked_ipty_output = collect_until(&rx, Duration::from_millis(500), |value| {
            value.contains("__RPTY_ONLY__")
        });
        let _ = ipty.terminate();

        assert_eq!(exit.exit_code, Some(0));
        assert!(rpty_output
            .lock()
            .expect("rPTY output mutex")
            .contains("__RPTY_ONLY__"));
        assert!(!leaked_ipty_output.contains("__RPTY_ONLY__"));
    }

    fn collect_until<F>(
        receiver: &mpsc::Receiver<Vec<u8>>,
        timeout: Duration,
        predicate: F,
    ) -> String
    where
        F: Fn(&str) -> bool,
    {
        let started = Instant::now();
        let mut output = Vec::new();
        while started.elapsed() < timeout {
            match receiver.recv_timeout(Duration::from_millis(50)) {
                Ok(chunk) => {
                    output.extend_from_slice(&chunk);
                    let value = String::from_utf8_lossy(&output).to_string();
                    if predicate(&value) {
                        return value;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        String::from_utf8_lossy(&output).to_string()
    }

    fn write_wsl_script_for_tests(wsl_path: &PathBuf, script_path: &str, content: &str) {
        let command = format!(
            "cat > {} && chmod +x {}",
            bash_quote_for_tests(script_path),
            bash_quote_for_tests(script_path)
        );
        let mut child = Command::new(wsl_path)
            .args(["--", "sh", "-lc", &command])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("wsl script writer should spawn");
        child
            .stdin
            .take()
            .expect("stdin should exist")
            .write_all(content.as_bytes())
            .expect("script content should be written");
        let output = child
            .wait_with_output()
            .expect("wsl script writer should finish");
        assert!(
            output.status.success(),
            "write script failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn cleanup_wsl_path_for_tests(wsl_path: &PathBuf, script_path: &str) {
        let command = format!("rm -f {}", bash_quote_for_tests(script_path));
        let _ = Command::new(wsl_path)
            .args(["--", "sh", "-lc", &command])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    fn bash_quote_for_tests(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn now_ms_for_tests() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    }
}
