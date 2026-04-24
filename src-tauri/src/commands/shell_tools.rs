use super::{
    configure_std_command_for_background, configure_tokio_command_for_background,
    AnalyzeScriptPayload, AnalyzeScriptRequest, FormatScriptPayload, FormatScriptRequest,
    ScriptDiagnosticPayload,
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::OnceLock,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

const SHELLCHECK_ZH_MESSAGES_JSON: &str = include_str!("../../../resources/Messages_zh.json");
const SHELLCHECK_TIMEOUT: Duration = Duration::from_secs(12);
const SHFMT_TIMEOUT: Duration = Duration::from_secs(12);

static SHELLCHECK_ZH_MESSAGES: OnceLock<HashMap<String, String>> = OnceLock::new();

struct ShellCheckCandidate {
    executable: PathBuf,
    arguments: Vec<OsString>,
    use_wsl: bool,
}

struct ShfmtCandidate {
    executable: PathBuf,
    use_wsl: bool,
}

#[derive(Debug, Deserialize)]
struct ShellCheckJsonPayload {
    comments: Vec<ShellCheckComment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellCheckComment {
    line: usize,
    end_line: usize,
    column: usize,
    end_column: usize,
    level: String,
    code: u64,
    message: String,
}

#[tauri::command]
pub async fn analyze_script(payload: AnalyzeScriptRequest) -> Result<AnalyzeScriptPayload, String> {
    let normalized_content = normalize_shellcheck_content(&payload.content);
    let dialect = detect_shellcheck_dialect(
        payload.path.as_deref(),
        payload.name.as_deref(),
        &normalized_content,
    )
    .to_string();

    if normalized_content.trim().is_empty() {
        return Ok(AnalyzeScriptPayload {
            available: true,
            message: None,
            dialect,
            diagnostics: Vec::new(),
        });
    }

    let Some(shellcheck) = resolve_shellcheck_candidate() else {
        return Ok(AnalyzeScriptPayload {
            available: false,
            message: Some("未检测到可用的 ShellCheck，本地实时诊断暂不可用。".into()),
            dialect,
            diagnostics: Vec::new(),
        });
    };

    let script_name =
        resolve_analysis_script_name(payload.path.as_deref(), payload.name.as_deref());
    let temporary_root = env::temp_dir().join("sh-editor-shellcheck");
    let temporary_script =
        super::create_temp_script(&temporary_root, &script_name, &normalized_content, "utf-8")?;
    let output = run_shellcheck(&shellcheck, &temporary_script, &dialect).await;
    let _ = std::fs::remove_file(&temporary_script);

    let output = output?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let diagnostics = parse_shellcheck_diagnostics(&stdout)?;

    Ok(AnalyzeScriptPayload {
        available: true,
        message: None,
        dialect,
        diagnostics,
    })
}

#[tauri::command]
pub async fn format_script(payload: FormatScriptRequest) -> Result<FormatScriptPayload, String> {
    let Some(shfmt) = resolve_shfmt_candidate() else {
        return Err(
            "未检测到可用的 shfmt，请先在 Windows 或 WSL 中安装 shfmt，或配置 SHFMT_BIN。".into(),
        );
    };

    if payload.content.trim().is_empty() {
        return Ok(FormatScriptPayload {
            line_count: super::line_count(&payload.content),
            char_count: payload.content.chars().count(),
            content: payload.content,
            encoding: payload.encoding,
        });
    }

    let formatted = run_shfmt(&shfmt, &payload.content, payload.path.as_deref()).await?;

    Ok(FormatScriptPayload {
        line_count: super::line_count(&formatted),
        char_count: formatted.chars().count(),
        content: formatted,
        encoding: payload.encoding,
    })
}

fn parse_shellcheck_diagnostics(output: &str) -> Result<Vec<ScriptDiagnosticPayload>, String> {
    if output.trim().is_empty() {
        return Ok(Vec::new());
    }

    let payload: ShellCheckJsonPayload = serde_json::from_str(output)
        .map_err(|error| format!("解析 ShellCheck 结果失败：{error}"))?;

    Ok(payload
        .comments
        .into_iter()
        .map(|item| {
            let code = format!("SC{}", item.code);

            ScriptDiagnosticPayload {
                line: item.line.max(1),
                end_line: item.end_line.max(item.line).max(1),
                column: item.column.max(1),
                end_column: item.end_column.max(item.column).max(1),
                level: item.level,
                message: translate_shellcheck_message(&code, item.message),
                code,
            }
        })
        .collect())
}

fn shellcheck_translation_map() -> &'static HashMap<String, String> {
    SHELLCHECK_ZH_MESSAGES.get_or_init(|| {
        serde_json::from_str::<HashMap<String, String>>(
            SHELLCHECK_ZH_MESSAGES_JSON.trim_start_matches('\u{feff}'),
        )
        .unwrap_or_else(|error| {
            eprintln!("加载 ShellCheck 中文消息失败：{error}");
            HashMap::new()
        })
    })
}

fn translate_shellcheck_message(code: &str, fallback: String) -> String {
    shellcheck_translation_map()
        .get(code)
        .cloned()
        .unwrap_or(fallback)
}

fn resolve_analysis_script_name(path: Option<&str>, name: Option<&str>) -> String {
    if let Some(file_name) = path
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
    {
        return file_name.to_string();
    }

    name.filter(|value| !value.is_empty())
        .unwrap_or("untitled.sh")
        .to_string()
}

fn normalize_shellcheck_content(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn detect_shellcheck_dialect(
    path: Option<&str>,
    name: Option<&str>,
    content: &str,
) -> &'static str {
    let first_line = content
        .lines()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if first_line.starts_with("#!") {
        if first_line.contains("bash") {
            return "bash";
        }
        if first_line.contains("dash") {
            return "dash";
        }
        if first_line.contains("ksh") {
            return "ksh";
        }
        if first_line.contains("sh") {
            return "sh";
        }
    }

    let inferred_name = path
        .and_then(|value| Path::new(value).file_name())
        .and_then(|value| value.to_str())
        .or(name)
        .unwrap_or_default()
        .to_ascii_lowercase();

    if inferred_name.ends_with(".dash") {
        return "dash";
    }
    if inferred_name.ends_with(".ksh") {
        return "ksh";
    }
    if inferred_name.ends_with(".sh") || inferred_name.ends_with(".bash") {
        return "bash";
    }

    "bash"
}

fn resolve_shellcheck_candidate() -> Option<ShellCheckCandidate> {
    if let Some(configured_path) = env::var_os("SHELLCHECK_BIN") {
        let configured_path = PathBuf::from(configured_path);
        if configured_path.exists() {
            if let Some(candidate) = build_wrapped_shellcheck_candidate(configured_path) {
                return Some(candidate);
            }
        }
    }

    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf);
    let local_binary_name = if cfg!(windows) {
        "shellcheck.exe"
    } else {
        "shellcheck"
    };
    if let Some(repo_root) = repo_root {
        let local_candidates = [
            repo_root
                .join("node_modules")
                .join("shellcheck")
                .join("bin")
                .join("shellcheck.js"),
            repo_root
                .join("node_modules")
                .join(".bin")
                .join(if cfg!(windows) {
                    "shellcheck.cmd"
                } else {
                    "shellcheck"
                }),
            repo_root
                .join("node_modules")
                .join("shellcheck")
                .join("bin")
                .join(local_binary_name),
        ];

        for local_candidate in local_candidates {
            if !local_candidate.exists() {
                continue;
            }

            if let Some(candidate) = build_wrapped_shellcheck_candidate(local_candidate) {
                return Some(candidate);
            }
        }
    }

    let system_commands: &[&str] = if cfg!(windows) {
        &["shellcheck.exe", "shellcheck.cmd"]
    } else {
        &["shellcheck"]
    };

    for command_name in system_commands {
        if let Some(system_binary) = super::find_command_path(command_name, &[]) {
            if let Some(candidate) = build_wrapped_shellcheck_candidate(system_binary) {
                return Some(candidate);
            }
        }
    }

    let wsl_path = super::find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"])?;
    let mut command = StdCommand::new(&wsl_path);
    configure_std_command_for_background(&mut command);
    if command
        .args(["--", "shellcheck", "--version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some_and(|status| status.success())
    {
        return Some(ShellCheckCandidate {
            executable: wsl_path,
            arguments: Vec::new(),
            use_wsl: true,
        });
    }

    None
}

fn build_wrapped_shellcheck_candidate(executable: PathBuf) -> Option<ShellCheckCandidate> {
    let extension = executable
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("js" | "mjs" | "cjs") => {
            let node_executable = resolve_node_command_path()?;
            Some(ShellCheckCandidate {
                executable: node_executable,
                arguments: vec![executable.into_os_string()],
                use_wsl: false,
            })
        }
        Some("cmd" | "bat") => {
            let command_shell = resolve_cmd_command_path()?;
            Some(ShellCheckCandidate {
                executable: command_shell,
                arguments: vec![OsString::from("/C"), executable.into_os_string()],
                use_wsl: false,
            })
        }
        _ => Some(ShellCheckCandidate {
            executable,
            arguments: Vec::new(),
            use_wsl: false,
        }),
    }
}

fn resolve_node_command_path() -> Option<PathBuf> {
    if cfg!(windows) {
        return super::find_command_path(
            "node.exe",
            &[
                "C:\\Program Files\\nodejs\\node.exe",
                "C:\\Program Files (x86)\\nodejs\\node.exe",
            ],
        );
    }

    super::find_command_path("node", &[])
}

fn resolve_cmd_command_path() -> Option<PathBuf> {
    if cfg!(windows) {
        return super::find_command_path("cmd.exe", &["C:\\Windows\\System32\\cmd.exe"]);
    }

    None
}

fn resolve_shfmt_candidate() -> Option<ShfmtCandidate> {
    if let Some(configured_path) = env::var_os("SHFMT_BIN") {
        let executable = PathBuf::from(configured_path);
        if executable.exists() {
            return Some(ShfmtCandidate {
                executable,
                use_wsl: false,
            });
        }
    }

    let shfmt_command = if cfg!(windows) { "shfmt.exe" } else { "shfmt" };
    if let Some(system_binary) = super::find_command_path(shfmt_command, &[]) {
        return Some(ShfmtCandidate {
            executable: system_binary,
            use_wsl: false,
        });
    }

    let wsl_path = super::find_command_path("wsl.exe", &["C:\\Windows\\System32\\wsl.exe"])?;
    let mut command = StdCommand::new(&wsl_path);
    configure_std_command_for_background(&mut command);
    if command
        .args(["--", "shfmt", "--version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .is_some_and(|status| status.success())
    {
        return Some(ShfmtCandidate {
            executable: wsl_path,
            use_wsl: true,
        });
    }

    None
}

async fn run_shellcheck(
    candidate: &ShellCheckCandidate,
    script_path: &Path,
    dialect: &str,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(&candidate.executable);
    configure_tokio_command_for_background(&mut command);

    if candidate.use_wsl {
        let wsl_script_path = super::to_wsl_path(script_path)?;
        command.args([
            "--",
            "shellcheck",
            "--format=json1",
            "--shell",
            dialect,
            &wsl_script_path,
        ]);
    } else {
        command
            .args(&candidate.arguments)
            .args(["--format=json1", "--shell", dialect])
            .arg(script_path);
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let output = match timeout(SHELLCHECK_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("运行 ShellCheck 失败：{error}")),
        Err(_) => {
            return Err(format!(
                "ShellCheck 分析超时（超过 {} 秒）。",
                SHELLCHECK_TIMEOUT.as_secs()
            ))
        }
    };

    if matches!(output.status.code(), Some(0 | 1)) {
        return Ok(output);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("ShellCheck 执行失败。".into());
    }

    Err(format!("ShellCheck 执行失败：{stderr}"))
}

async fn run_shfmt(
    candidate: &ShfmtCandidate,
    content: &str,
    _path: Option<&str>,
) -> Result<String, String> {
    let mut command = Command::new(&candidate.executable);
    configure_tokio_command_for_background(&mut command);

    if candidate.use_wsl {
        command.args(["--", "shfmt", "-i", "2"]);
    } else {
        command.args(["-i", "2"]);
    }

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 shfmt 失败：{error}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(content.as_bytes())
            .await
            .map_err(|error| format!("写入 shfmt 输入失败：{error}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("关闭 shfmt 输入失败：{error}"))?;
    }

    let output = match timeout(SHFMT_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("运行 shfmt 失败：{error}")),
        Err(_) => {
            return Err(format!(
                "shfmt 格式化超时（超过 {} 秒）。",
                SHFMT_TIMEOUT.as_secs()
            ))
        }
    };

    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|error| format!("解析 shfmt 输出失败：{error}"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        return Err("shfmt 执行失败。".into());
    }

    Err(format!("shfmt 执行失败：{stderr}"))
}
