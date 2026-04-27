use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Command as StdCommand, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use crate::commands::configure_std_command_for_background;

const RUN_READ_BUFFER_SIZE: usize = 64 * 1024;
const WSL_RESIZE_CONTROL_SCRIPT: &str = r#"
tty_path="$(cat "$1" 2>/dev/null || true)"
case "$tty_path" in
  /dev/pts/[0-9]*|/dev/tty[0-9]*)
    stty rows "$2" cols "$3" < "$tty_path" >/dev/null 2>&1 || exit 0
    ;;
esac
"#;
static RUN_RESIZE_CONTROL_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct RunPtySpec {
    pub wsl_command_path: PathBuf,
    pub working_directory: String,
    pub execution_path: String,
    pub cols: u16,
    pub rows: u16,
    pub timeout: Option<Duration>,
}

#[derive(Debug, Clone)]
pub struct RunPtyExit {
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
}

pub struct LiveRunPty {
    pub pid: Option<u32>,
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    exit_rx: Mutex<mpsc::Receiver<Option<i32>>>,
    resize_control: WslResizeControl,
}

#[derive(Debug, Clone)]
struct WslResizeControl {
    wsl_command_path: PathBuf,
    control_path: String,
}

pub fn run_pty_script<F>(spec: RunPtySpec, on_output: F) -> Result<RunPtyExit, String>
where
    F: FnMut(String) + Send + 'static,
{
    let live = spawn_live_run_pty(spec, on_output)?;
    let exit_code = live.wait_timeout(None);
    Ok(RunPtyExit {
        pid: live.pid,
        exit_code,
    })
}

pub fn spawn_live_run_pty<F>(spec: RunPtySpec, mut on_output: F) -> Result<LiveRunPty, String>
where
    F: FnMut(String) + Send + 'static,
{
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(normalize_pty_size(spec.cols, spec.rows))
        .map_err(|error| format!("创建运行 PTY 失败：{error}"))?;

    let resize_control = WslResizeControl {
        wsl_command_path: spec.wsl_command_path.clone(),
        control_path: build_resize_control_path(),
    };
    let args = build_run_command_args_with_resize_control(
        &spec.working_directory,
        &spec.execution_path,
        &resize_control.control_path,
    );
    let mut command = CommandBuilder::new(spec.wsl_command_path.to_string_lossy().as_ref());
    for arg in args {
        command.arg(arg);
    }

    let child = pty_pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("启动运行 PTY 失败：{error}"))?;
    let pid = child.process_id();
    let killer = child.clone_killer();
    drop(pty_pair.slave);

    let master = pty_pair.master;
    let mut reader = master
        .try_clone_reader()
        .map_err(|error| format!("初始化运行 PTY 读通道失败：{error}"))?;
    let terminal_writer = master
        .take_writer()
        .map_err(|error| format!("初始化运行 PTY 写通道失败：{error}"))?;
    let shared_writer = Arc::new(Mutex::new(terminal_writer));
    let response_writer = Arc::clone(&shared_writer);
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; RUN_READ_BUFFER_SIZE];
        let mut decoded_chunk = String::new();
        let mut decoder = Utf8ChunkDecoder::default();
        let mut output_filter = WslHostOutputFilter::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if contains_cursor_position_query(&buffer[..size]) {
                        if let Ok(mut writer) = response_writer.lock() {
                            let _ = writer.write_all(b"\x1b[1;1R");
                            let _ = writer.flush();
                        }
                    }
                    decoded_chunk.clear();
                    decoder.decode_into(&buffer[..size], &mut decoded_chunk, false);
                    if !decoded_chunk.is_empty() {
                        let sanitized = output_filter.sanitize(&decoded_chunk);
                        if !sanitized.is_empty() {
                            on_output(sanitized);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        decoded_chunk.clear();
        decoder.decode_into(&[], &mut decoded_chunk, true);
        if !decoded_chunk.is_empty() {
            let sanitized = output_filter.sanitize(&decoded_chunk);
            if !sanitized.is_empty() {
                on_output(sanitized);
            }
        }
    });

    let shared_master = Arc::new(Mutex::new(Some(master)));
    let exit_master = Arc::clone(&shared_master);
    let exit_resize_control = resize_control.clone();
    let (exit_tx, exit_rx) = mpsc::channel();
    thread::spawn(move || {
        let exit_code = wait_child_exit_code(child, spec.timeout);
        if let Ok(mut master) = exit_master.lock() {
            let _ = master.take();
        }
        let _ = reader_thread.join();
        cleanup_resize_control_file(&exit_resize_control);
        let _ = exit_tx.send(exit_code);
    });

    Ok(LiveRunPty {
        pid,
        master: shared_master,
        killer: Mutex::new(killer),
        writer: shared_writer,
        exit_rx: Mutex::new(exit_rx),
        resize_control,
    })
}

impl LiveRunPty {
    pub fn kill(&self) -> Result<(), String> {
        let mut killer = self
            .killer
            .lock()
            .map_err(|_| "rPTY 结束通道已损坏。".to_string())?;
        killer
            .kill()
            .map_err(|error| format!("结束 rPTY 失败：{error}"))
    }

    pub fn write_input(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "rPTY 输入通道已损坏。".to_string())?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| format!("写入 rPTY 输入失败：{error}"))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self
            .master
            .lock()
            .map_err(|_| "rPTY 尺寸通道已损坏。".to_string())?;
        let Some(master) = master.as_ref() else {
            return Err("rPTY 已结束，无法同步尺寸。".to_string());
        };
        master
            .resize(normalize_pty_size(cols, rows))
            .map_err(|error| format!("同步 rPTY 尺寸失败：{error}"))?;
        sync_wsl_tty_size(&self.resize_control, cols, rows);
        Ok(())
    }

    pub fn size(&self) -> Result<PtySize, String> {
        let master = self
            .master
            .lock()
            .map_err(|_| "rPTY 尺寸通道已损坏。".to_string())?;
        let Some(master) = master.as_ref() else {
            return Err("rPTY 已结束，无法读取尺寸。".to_string());
        };
        master
            .get_size()
            .map_err(|error| format!("读取 rPTY 尺寸失败：{error}"))
    }

    pub fn wait_timeout(&self, timeout: Option<Duration>) -> Option<i32> {
        let Ok(receiver) = self.exit_rx.lock() else {
            return None;
        };
        match timeout {
            Some(timeout) => receiver.recv_timeout(timeout).ok().flatten(),
            None => receiver.recv().ok().flatten(),
        }
    }
}

#[derive(Default)]
struct WslHostOutputFilter {
    strip_startup_controls: bool,
}

impl WslHostOutputFilter {
    fn sanitize(&mut self, value: &str) -> String {
        let mut output = strip_known_wsl_host_sequences(value);
        if !self.strip_startup_controls {
            output = strip_leading_ansi_controls(&output);
            if output.chars().any(|character| !character.is_control()) {
                self.strip_startup_controls = true;
            }
        }
        output
    }
}

fn strip_known_wsl_host_sequences(value: &str) -> String {
    let mut output = value
        .replace("\x1b[6n", "")
        .replace("\x1b[?9001h", "")
        .replace("\x1b[?9001l", "")
        .replace("\x1b[?1004h", "")
        .replace("\x1b[?1004l", "");

    loop {
        let Some(start) = output.find("\x1b]0;") else {
            break;
        };
        let Some(end_offset) = output[start..].find('\x07') else {
            break;
        };
        let end = start + end_offset + '\x07'.len_utf8();
        if output[start..end].to_ascii_lowercase().contains("wsl.exe") {
            output.replace_range(start..end, "");
        } else {
            break;
        }
    }

    output
}

fn strip_leading_ansi_controls(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != 0x1b {
            break;
        }
        if index + 1 >= bytes.len() {
            break;
        }
        match bytes[index + 1] {
            b'[' => {
                let mut end = index + 2;
                while end < bytes.len() {
                    let byte = bytes[end];
                    end += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        index = end;
                        break;
                    }
                }
                if end >= bytes.len() && index != end {
                    break;
                }
            }
            b']' => {
                let Some(relative_end) = value[index..].find('\x07') else {
                    break;
                };
                index += relative_end + '\x07'.len_utf8();
            }
            _ => break,
        }
    }
    value[index..].to_string()
}

fn contains_cursor_position_query(data: &[u8]) -> bool {
    data.windows(4).any(|window| window == b"\x1b[6n")
}

fn wait_child_exit_code(
    mut child: Box<dyn Child + Send + Sync>,
    timeout: Option<Duration>,
) -> Option<i32> {
    let Some(timeout) = timeout else {
        return child
            .wait()
            .ok()
            .and_then(|status| i32::try_from(status.exit_code()).ok());
    };

    let mut killer = child.clone_killer();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let exit_code = child
            .wait()
            .ok()
            .and_then(|status| i32::try_from(status.exit_code()).ok());
        let _ = sender.send(exit_code);
    });

    match receiver.recv_timeout(timeout) {
        Ok(exit_code) => exit_code,
        Err(_) => {
            let _ = killer.kill();
            receiver.recv_timeout(Duration::from_secs(2)).ok().flatten()
        }
    }
}

#[derive(Default)]
struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
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
                        output.push_str(&String::from_utf8_lossy(&self.pending[..valid_up_to]));
                        self.pending.drain(..valid_up_to);
                        continue;
                    }

                    if error.error_len().is_some() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..1);
                        continue;
                    }

                    if last {
                        output.push_str(&String::from_utf8_lossy(&self.pending));
                        self.pending.clear();
                    }
                    return;
                }
            }
        }
    }
}

pub fn build_run_command_args(working_directory: &str, execution_path: &str) -> Vec<String> {
    [
        "--cd",
        working_directory,
        "--",
        "/usr/bin/setsid",
        "--wait",
        "/usr/bin/env",
        "LANG=C.UTF-8",
        "LC_ALL=C.UTF-8",
        "TERM=xterm-256color",
        "/bin/bash",
        "--noprofile",
        "--norc",
        execution_path,
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn build_run_command_args_with_resize_control(
    working_directory: &str,
    execution_path: &str,
    resize_control_path: &str,
) -> Vec<String> {
    vec![
        "--cd".to_string(),
        working_directory.to_string(),
        "--".to_string(),
        "/usr/bin/setsid".to_string(),
        "--wait".to_string(),
        "/bin/bash".to_string(),
        "--noprofile".to_string(),
        "--norc".to_string(),
        "-lc".to_string(),
        build_wsl_run_wrapper_script(resize_control_path, execution_path),
    ]
}

fn build_wsl_run_wrapper_script(resize_control_path: &str, execution_path: &str) -> String {
    format!(
        r#"
tty_path="$(tty 2>/dev/null || true)"
case "$tty_path" in
  /dev/pts/[0-9]*|/dev/tty[0-9]*)
    printf '%s\n' "$tty_path" > {} 2>/dev/null || true
    ;;
esac
exec /usr/bin/env LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color /bin/bash --noprofile --norc {}
"#,
        bash_quote_for_wsl(resize_control_path),
        bash_quote_for_wsl(execution_path),
    )
}

fn bash_quote_for_wsl(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_resize_control_path() -> String {
    let sequence = RUN_RESIZE_CONTROL_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("/tmp/calamex-rpty-resize-{}-{sequence}.ctl", now_ms())
}

fn sync_wsl_tty_size(control: &WslResizeControl, cols: u16, rows: u16) {
    let mut command = StdCommand::new(&control.wsl_command_path);
    configure_std_command_for_background(&mut command);
    let _ = command
        .args([
            "--",
            "/bin/sh",
            "-lc",
            WSL_RESIZE_CONTROL_SCRIPT,
            "calamex-rpty-resize",
            &control.control_path,
            &rows.max(1).to_string(),
            &cols.max(2).to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn cleanup_resize_control_file(control: &WslResizeControl) {
    let mut command = StdCommand::new(&control.wsl_command_path);
    configure_std_command_for_background(&mut command);
    let _ = command
        .args([
            "--",
            "/bin/sh",
            "-lc",
            "rm -f -- \"$1\"",
            "calamex-rpty-cleanup",
            &control.control_path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn normalize_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Mutex, MutexGuard,
        },
    };

    static TEST_SCRIPT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn test_run_spawns_with_norc_command_args() {
        let args = build_run_command_args("/workspace", "/tmp/x.sh");

        assert!(args.windows(2).any(|pair| pair == ["--cd", "/workspace"]));
        assert!(args.iter().any(|arg| arg == "/usr/bin/setsid"));
        assert!(args.iter().any(|arg| arg == "--wait"));
        assert!(args.iter().any(|arg| arg == "LANG=C.UTF-8"));
        assert!(args.iter().any(|arg| arg == "LC_ALL=C.UTF-8"));
        assert!(args.iter().any(|arg| arg == "TERM=xterm-256color"));
        assert!(args
            .windows(3)
            .any(|pair| pair == ["/bin/bash", "--noprofile", "--norc",]));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/x.sh"));
    }

    #[test]
    fn test_live_run_wrapper_records_resize_control_tty() {
        let args = build_run_command_args_with_resize_control(
            "/workspace",
            "/tmp/x.sh",
            "/tmp/calamex-rpty-resize-test.ctl",
        );
        let script = args.last().expect("wrapper script should be last arg");

        assert!(args.windows(2).any(|pair| pair == ["--cd", "/workspace"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["/bin/bash", "--noprofile"]));
        assert!(script.contains("tty_path=\"$(tty"));
        assert!(script.contains("/tmp/calamex-rpty-resize-test.ctl"));
        assert!(script.contains("/bin/bash --noprofile --norc '/tmp/x.sh'"));
    }

    #[test]
    fn test_run_locale_enforced() {
        let args = build_run_command_args("/workspace", "/tmp/x.sh");

        assert!(args.contains(&"LANG=C.UTF-8".to_string()));
        assert!(args.contains(&"LC_ALL=C.UTF-8".to_string()));
        assert!(args.contains(&"TERM=xterm-256color".to_string()));
    }

    #[test]
    fn test_run_cwd_is_workspace_root() {
        let args = build_run_command_args("/mnt/d/workspace", "/tmp/x.sh");

        let cd_index = args
            .iter()
            .position(|arg| arg == "--cd")
            .expect("rPTY 必须显式传入 --cd");
        assert_eq!(
            args.get(cd_index + 1).map(String::as_str),
            Some("/mnt/d/workspace")
        );
    }

    #[test]
    fn test_run_in_independent_pgroup() {
        let args = build_run_command_args("/workspace", "/tmp/x.sh");

        assert!(args.iter().any(|arg| arg == "/usr/bin/setsid"));
    }

    #[test]
    fn test_run_emits_completion() {
        let capture = run_test_script("echo hi\n");

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        assert!(capture.output.contains("hi"));
    }

    #[test]
    fn test_run_emits_completion_with_exit_code() {
        let capture = run_test_script("exit 42\n");

        assert_eq!(capture.exit.exit_code, Some(42), "{}", capture.output);
    }

    #[test]
    fn test_run_spawns_with_norc() {
        let capture = run_test_script("ps -o args= -p $$\nprintf '\\n__DONE__\\n'\n");

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        assert!(capture.output.contains("--noprofile"));
        assert!(capture.output.contains("--norc"));
        assert!(!capture.output.contains("sudo <command>"));
        assert!(!capture.output.contains("man sudo_root"));
    }

    #[test]
    fn test_run_env_does_not_leak_ipty_export() {
        let capture = run_test_script("printf '__FOO:%s__\\n' \"${FOO-}\"\n");

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        assert!(capture.output.contains("__FOO:__"));
    }

    #[test]
    fn test_run_in_independent_pgroup_integration() {
        let capture = run_test_script(
            "pid=$$\npgid=$(ps -o pgid= -p $$ | tr -d ' ')\nprintf '__PID:%s__\\n__PGID:%s__\\n' \"$pid\" \"$pgid\"\n",
        );

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        let pid = extract_between(&capture.output, "__PID:", "__");
        let pgid = extract_between(&capture.output, "__PGID:", "__");
        assert!(!pid.is_empty());
        assert_eq!(pid, pgid);
    }

    #[test]
    fn test_run_chunk_does_not_contain_injected_bytes() {
        let capture = run_test_script("echo hi\n");

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        assert!(!capture.output.contains("\x1b[6n"));
        assert!(!capture.output.contains("\x1b]0;"));
        assert!(!capture.output.contains("\x1b[?9001"));
        assert!(!capture.output.contains("\x1b[?1004"));
    }

    #[test]
    fn test_resize_propagates_to_rpty() {
        let capture = run_test_script("stty size\n");

        assert_eq!(capture.exit.exit_code, Some(0), "{}", capture.output);
        assert!(capture.output.replace('\r', "").contains("40 120"));
    }

    #[test]
    fn test_live_rpty_resize_updates_running_process_size() {
        let live = spawn_test_script("stty size\nprintf '__READY__\\n'\nread -r _\nstty size\n");
        assert!(
            wait_for_contains(&live.output, "__READY__", Duration::from_secs(5)),
            "未收到 resize ready 标记：{}",
            live.output(),
        );

        live.pty
            .resize(100, 31)
            .expect("rPTY should resize while running");
        let resized_size = live.pty.size().expect("rPTY size should be readable");
        assert_eq!(resized_size.cols, 100);
        assert_eq!(resized_size.rows, 31);
        live.pty
            .write_input(b"\n")
            .expect("rPTY should accept stdin after resize");
        let exit_code = live.pty.wait_timeout(Some(Duration::from_secs(5)));
        cleanup_wsl_path_for_tests(&live.wsl_path, &live.script_path);
        let output = live.output().replace('\r', "");

        assert_eq!(exit_code, Some(0), "{output}");
        assert!(output.contains("40 120"), "{output}");
        assert!(output.contains("31 100"), "{output}");
    }

    #[test]
    fn test_rpty_accepts_stdin_input() {
        let live = spawn_test_script("read -r answer\nprintf '__INPUT:%s__\\n' \"$answer\"\n");

        live.pty
            .write_input(b"hello-rpty\n")
            .expect("rPTY should accept stdin");
        let exit_code = live.pty.wait_timeout(Some(Duration::from_secs(5)));
        cleanup_wsl_path_for_tests(&live.wsl_path, &live.script_path);

        assert_eq!(exit_code, Some(0), "{}", live.output());
        assert!(live.output().contains("__INPUT:hello-rpty__"));
    }

    #[test]
    fn test_cancel_graceful_then_kill() {
        let live = spawn_test_script(
            "trap 'echo __TERM__; exit 143' TERM\npgid=$(ps -o pgid= -p $$ | tr -cd '0-9')\nprintf '__PGID:%s__\\n' \"$pgid\"\nsleep 60\n",
        );
        let pgid = wait_for_marker(&live.output, "__PGID:", "__", Duration::from_secs(5));
        assert!(!pgid.is_empty(), "未收到 PGID：{}", live.output());

        send_wsl_signal(&live.wsl_path, "TERM", &pgid);
        let exit_code = live.pty.wait_timeout(Some(Duration::from_secs(5)));
        cleanup_wsl_path_for_tests(&live.wsl_path, &live.script_path);

        assert_eq!(exit_code, Some(143), "{}", live.output());
        assert!(live.output().contains("__TERM__"));
    }

    struct TestCapture {
        exit: RunPtyExit,
        output: String,
    }

    struct LiveTestRun {
        pty: LiveRunPty,
        output: Arc<Mutex<String>>,
        wsl_path: PathBuf,
        script_path: String,
        _guard: MutexGuard<'static, ()>,
    }

    impl LiveTestRun {
        fn output(&self) -> String {
            self.output.lock().expect("output mutex").clone()
        }
    }

    fn run_test_script(content: &str) -> TestCapture {
        let _guard = crate::terminal::test_support::wsl_test_guard();
        let wsl_path = resolve_wsl_for_tests();
        let sequence = TEST_SCRIPT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let script_path = format!("/tmp/calamex-dual-pty-test-{}-{sequence}.sh", now_ms());
        write_wsl_script_for_tests(&wsl_path, &script_path, content);
        let output = Arc::new(Mutex::new(String::new()));
        let output_ref = Arc::clone(&output);
        let exit = run_pty_script(
            RunPtySpec {
                wsl_command_path: wsl_path.clone(),
                working_directory: "/tmp".to_string(),
                execution_path: script_path.clone(),
                cols: 120,
                rows: 40,
                timeout: Some(Duration::from_secs(8)),
            },
            move |chunk| {
                output_ref.lock().expect("output mutex").push_str(&chunk);
            },
        )
        .expect("rPTY script should run");
        cleanup_wsl_path_for_tests(&wsl_path, &script_path);
        let output = output.lock().expect("output mutex").clone();
        TestCapture { exit, output }
    }

    fn spawn_test_script(content: &str) -> LiveTestRun {
        let guard = crate::terminal::test_support::wsl_test_guard();
        let wsl_path = resolve_wsl_for_tests();
        let sequence = TEST_SCRIPT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let script_path = format!("/tmp/calamex-dual-pty-live-test-{}-{sequence}.sh", now_ms());
        write_wsl_script_for_tests(&wsl_path, &script_path, content);
        let output = Arc::new(Mutex::new(String::new()));
        let output_ref = Arc::clone(&output);
        let pty = spawn_live_run_pty(
            RunPtySpec {
                wsl_command_path: wsl_path.clone(),
                working_directory: "/tmp".to_string(),
                execution_path: script_path.clone(),
                cols: 120,
                rows: 40,
                timeout: None,
            },
            move |chunk| {
                output_ref.lock().expect("output mutex").push_str(&chunk);
            },
        )
        .expect("live rPTY script should spawn");

        LiveTestRun {
            pty,
            output,
            wsl_path,
            script_path,
            _guard: guard,
        }
    }

    fn resolve_wsl_for_tests() -> PathBuf {
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let candidate = system_root.join("System32").join("wsl.exe");
        if candidate.exists() {
            return candidate;
        }
        PathBuf::from(r"C:\Windows\System32\wsl.exe")
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

    fn send_wsl_signal(wsl_path: &PathBuf, signal: &str, pgid: &str) {
        assert!(
            pgid.chars().all(|character| character.is_ascii_digit()),
            "PGID 不是数字：{pgid:?}"
        );
        let command = format!("/bin/kill -{} -- -{}", signal, pgid);
        let output = Command::new(wsl_path)
            .args(["--", "sh", "-lc", &command])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .expect("signal command should run");
        assert!(
            output.status.success(),
            "signal failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn bash_quote_for_tests(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn extract_between(value: &str, prefix: &str, suffix: &str) -> String {
        let Some(start) = value.find(prefix).map(|index| index + prefix.len()) else {
            return String::new();
        };
        let rest = &value[start..];
        let Some(end) = rest.find(suffix) else {
            return String::new();
        };
        rest[..end].trim().to_string()
    }

    fn wait_for_marker(
        output: &Arc<Mutex<String>>,
        prefix: &str,
        suffix: &str,
        timeout: Duration,
    ) -> String {
        let started = std::time::Instant::now();
        while started.elapsed() < timeout {
            let value = output.lock().expect("output mutex").clone();
            let extracted = extract_between(&value, prefix, suffix);
            if !extracted.is_empty() {
                return extracted;
            }
            thread::sleep(Duration::from_millis(50));
        }
        String::new()
    }

    fn wait_for_contains(output: &Arc<Mutex<String>>, needle: &str, timeout: Duration) -> bool {
        let started = std::time::Instant::now();
        while started.elapsed() < timeout {
            if output.lock().expect("output mutex").contains(needle) {
                return true;
            }
            thread::sleep(Duration::from_millis(50));
        }
        false
    }
}
