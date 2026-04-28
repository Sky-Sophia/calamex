use super::{ExecutionEnvironment, ExecutionOption};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

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

#[tauri::command]
pub async fn detect_execution_environment() -> Result<ExecutionEnvironment, String> {
    let executors = collect_executor_candidates().await;
    Ok(build_execution_environment(&executors))
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
    if candidate.kind != "wsl" {
        return false;
    }

    // 避免在启动阶段执行 wsl.exe 健康探测。
    // 某些 Windows 环境下 `wsl.exe --list --quiet` 会长时间挂起，导致前端初始化无法继续。
    // 启动只做命令存在性判断，实际运行时再由脚本执行链路兜底错误。
    candidate.path.is_some()
}
