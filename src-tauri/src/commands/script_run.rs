use super::{ExecutionEnvironment, ExecutionOption, RunScriptRequest, RunScriptResponse};
use chrono::Utc;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::{process::Command, time::timeout};

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const EXEC_TIMEOUT: Duration = Duration::from_secs(120);
const EXECUTOR_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct ExecutorCandidate {
    kind: &'static str,
    label: &'static str,
    description: &'static str,
    path: Option<PathBuf>,
    available: bool,
}

#[derive(Clone)]
struct CachedExecutorCandidates {
    captured_at: Instant,
    executors: Vec<ExecutorCandidate>,
}

static EXECUTOR_CANDIDATES_CACHE: Mutex<Option<CachedExecutorCandidates>> = Mutex::new(None);

struct PreparedScript {
    execution_path: PathBuf,
    working_directory: PathBuf,
    used_temp_file: bool,
    cleanup_path: Option<PathBuf>,
}

#[tauri::command]
pub async fn detect_execution_environment() -> Result<ExecutionEnvironment, String> {
    let executors = collect_executor_candidates().await;
    Ok(build_execution_environment(&executors))
}

#[tauri::command]
pub async fn run_script(payload: RunScriptRequest) -> Result<RunScriptResponse, String> {
    let executors = collect_executor_candidates().await;
    let executor = resolve_executor(&payload.executor, &executors)?;
    let prepared = prepare_script(&payload)?;
    let started_at = Utc::now();
    let start_time = Instant::now();
    let (mut command, command_line) = build_run_command(executor, &prepared)?;
    let output = execute_command(&mut command, EXEC_TIMEOUT).await?;
    let duration_ms = start_time.elapsed().as_millis();
    let finished_at = Utc::now();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined_output = merge_output(&stdout, &stderr);
    let success = output.status.success();
    let log_path = write_run_log(
        &started_at.to_rfc3339(),
        &finished_at.to_rfc3339(),
        &command_line,
        &stdout,
        &stderr,
        output.status.code(),
    )?;

    if let Some(path) = prepared.cleanup_path {
        let _ = fs::remove_file(path);
    }

    Ok(RunScriptResponse {
        success,
        stdout,
        stderr,
        combined_output,
        exit_code: output.status.code(),
        executor: executor.kind.to_string(),
        executor_label: executor.label.to_string(),
        duration_ms,
        started_at: started_at.to_rfc3339(),
        finished_at: finished_at.to_rfc3339(),
        command_line,
        log_path: Some(log_path.to_string_lossy().to_string()),
        used_temp_file: prepared.used_temp_file,
    })
}

pub(crate) fn line_count(content: &str) -> usize {
    if content.is_empty() {
        1
    } else {
        content.split('\n').count()
    }
}

pub(crate) fn find_command_path(file_name: &str, extra_candidates: &[&str]) -> Option<PathBuf> {
    if let Some(path_var) = env::var_os("PATH") {
        for directory in env::split_paths(&path_var) {
            let candidate = directory.join(file_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    if cfg!(windows) {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let winget_link = PathBuf::from(local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(file_name);
            if winget_link.exists() {
                return Some(winget_link);
            }
        }
    }

    extra_candidates
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.exists())
}

pub(crate) fn create_temp_script(
    preferred_directory: &Path,
    original_name: &str,
    content: &str,
    encoding: &str,
) -> Result<PathBuf, String> {
    let directory = preferred_directory.to_path_buf();
    fs::create_dir_all(&directory).map_err(|error| format!("创建临时目录失败：{error}"))?;

    let suffix = super::build_temp_file_suffix()?;
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("untitled");
    let temp_path = directory.join(format!("{stem}-{suffix}.tmp.sh"));
    let bytes = super::encode_script_content(content, encoding)?;
    fs::write(&temp_path, bytes).map_err(|error| format!("写入临时脚本失败：{error}"))?;
    Ok(temp_path)
}

async fn collect_executor_candidates() -> Vec<ExecutorCandidate> {
    if let Some(executors) = read_cached_executor_candidates() {
        return executors;
    }

    let mut executors = build_executor_candidates();

    for item in executors.iter_mut() {
        item.available = probe_executor(item).await;
    }

    cache_executor_candidates(&executors);
    executors
}

fn build_executor_candidates() -> Vec<ExecutorCandidate> {
    vec![ExecutorCandidate {
        kind: "wsl",
        label: "WSL2",
        description: "唯一执行环境，所有脚本统一通过 WSL2 Linux 子系统运行。",
        path: find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"]),
        available: false,
    }]
}

fn read_cached_executor_candidates() -> Option<Vec<ExecutorCandidate>> {
    let cache = EXECUTOR_CANDIDATES_CACHE.lock().ok()?;
    let entry = cache.as_ref()?;
    if entry.captured_at.elapsed() > EXECUTOR_CACHE_TTL {
        return None;
    }

    Some(entry.executors.clone())
}

fn cache_executor_candidates(executors: &[ExecutorCandidate]) {
    if let Ok(mut cache) = EXECUTOR_CANDIDATES_CACHE.lock() {
        *cache = Some(CachedExecutorCandidates {
            captured_at: Instant::now(),
            executors: executors.to_vec(),
        });
    }
}

fn find_preferred_available_executor(
    executors: &[ExecutorCandidate],
) -> Option<&ExecutorCandidate> {
    executors
        .iter()
        .find(|item| item.kind == "wsl" && item.available)
}

fn build_execution_environment(executors: &[ExecutorCandidate]) -> ExecutionEnvironment {
    let has_any = executors.iter().any(|item| item.available);

    ExecutionEnvironment {
        recommended: "wsl".to_string(),
        has_any,
        executors: executors
            .iter()
            .map(|item| ExecutionOption {
                r#type: item.kind.to_string(),
                label: item.label.to_string(),
                available: item.available,
                description: item.description.to_string(),
                command_path: item
                    .path
                    .as_ref()
                    .map(|value| value.to_string_lossy().to_string()),
            })
            .collect(),
    }
}

async fn probe_executor(candidate: &ExecutorCandidate) -> bool {
    let Some(path) = candidate.path.as_ref() else {
        return false;
    };

    if candidate.kind != "wsl" {
        return false;
    }

    let mut command = Command::new(path);
    command.args(["--list", "--quiet"]);
    command.stdout(Stdio::piped()).stderr(Stdio::null());

    matches!(
        timeout(PROBE_TIMEOUT, command.output()).await,
        Ok(Ok(output))
            if output.status.success()
                && output
                    .stdout
                    .iter()
                    .any(|byte| !matches!(*byte, 0 | b' ' | b'\n' | b'\r' | b'\t'))
    )
}

fn resolve_executor<'a>(
    requested: &str,
    executors: &'a [ExecutorCandidate],
) -> Result<&'a ExecutorCandidate, String> {
    if requested != "wsl" {
        return Err("当前版本仅支持 WSL2 执行环境。".into());
    }

    find_preferred_available_executor(executors)
        .ok_or_else(|| "当前系统未检测到可用的 WSL2 运行环境。".into())
}

fn prepare_script(payload: &RunScriptRequest) -> Result<PreparedScript, String> {
    let preferred_path = payload.path.as_ref().map(PathBuf::from);
    let working_directory = preferred_path
        .as_ref()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(env::temp_dir);

    let should_use_temp = payload.is_dirty
        || preferred_path
            .as_ref()
            .map(|path| !path.exists())
            .unwrap_or(true);

    if should_use_temp {
        let file_name = preferred_path
            .as_ref()
            .and_then(|path| path.file_name().and_then(|value| value.to_str()))
            .unwrap_or("untitled.sh");
        let temp_path = create_temp_script(
            &working_directory,
            file_name,
            &payload.content,
            &payload.encoding,
        )?;
        return Ok(PreparedScript {
            execution_path: temp_path.clone(),
            working_directory,
            used_temp_file: true,
            cleanup_path: Some(temp_path),
        });
    }

    let execution_path = preferred_path.ok_or_else(|| "脚本路径无效。".to_string())?;
    Ok(PreparedScript {
        execution_path,
        working_directory,
        used_temp_file: false,
        cleanup_path: None,
    })
}

fn build_run_command(
    executor: &ExecutorCandidate,
    prepared: &PreparedScript,
) -> Result<(Command, String), String> {
    if executor.kind != "wsl" {
        return Err(format!("不支持的执行器：{}", executor.kind));
    }

    let shell_path = executor
        .path
        .as_ref()
        .ok_or_else(|| "未找到 WSL2 可执行文件。".to_string())?;
    let script_path = super::to_wsl_path(&prepared.execution_path)?;
    let working_directory = super::to_wsl_path(&prepared.working_directory)?;
    let bash_script = format!(
        "cd {} && bash {}",
        super::bash_quote(&working_directory),
        super::bash_quote(&script_path)
    );
    let mut command = Command::new(shell_path);
    command.args(["--", "bash", "-lc", &bash_script]);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    Ok((
        command,
        format!(
            "{} -- bash -lc {}",
            shell_path.to_string_lossy(),
            super::bash_quote(&bash_script)
        ),
    ))
}

async fn execute_command(
    command: &mut Command,
    timeout_duration: Duration,
) -> Result<std::process::Output, String> {
    match timeout(timeout_duration, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("执行脚本失败：{error}")),
        Err(_) => Err(format!(
            "脚本执行超时（超过 {} 秒），请检查脚本是否阻塞。",
            timeout_duration.as_secs()
        )),
    }
}

fn merge_output(stdout: &str, stderr: &str) -> String {
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("# stdout\n{stdout}\n\n# stderr\n{stderr}"),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (true, true) => "# 脚本已执行，但未产生任何标准输出。".into(),
    }
}

fn write_run_log(
    started_at: &str,
    finished_at: &str,
    command_line: &str,
    stdout: &str,
    stderr: &str,
    exit_code: Option<i32>,
) -> Result<PathBuf, String> {
    let file_name = format!("sh-editor-run-{}.log", Utc::now().format("%Y%m%d_%H%M%S"));
    let log_path = env::temp_dir().join(file_name);
    let log_content = format!(
        "started_at={started_at}\nfinished_at={finished_at}\nexit_code={}\ncommand={command_line}\n\n[stdout]\n{stdout}\n\n[stderr]\n{stderr}\n",
        exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".into())
    );
    fs::write(&log_path, log_content).map_err(|error| format!("写入运行日志失败：{error}"))?;
    Ok(log_path)
}
