use std::{env, path::PathBuf, process::Stdio, time::Duration};

use encoding_rs::{GB18030, UTF_16LE};
use serde::Serialize;
use tokio::{process::Command, time};

use super::types::now_unix_ms;

const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WslLinkProbeStatus {
    Ok,
    Warning,
    Error,
    Unknown,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkProbeResult {
    pub key: &'static str,
    pub label: &'static str,
    pub status: WslLinkProbeStatus,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkEnvironmentReport {
    pub status: WslLinkProbeStatus,
    pub checked_at_unix_ms: u64,
    pub wsl_version: Option<String>,
    pub default_distro: Option<String>,
    pub mirrored_networking: Option<bool>,
    pub checks: Vec<WslLinkProbeResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandProbeOutput {
    status_code: Option<i32>,
    stdout: String,
    stderr: String,
}

pub async fn check_wsl_link_environment() -> WslLinkEnvironmentReport {
    if !cfg!(windows) {
        return WslLinkEnvironmentReport {
            status: WslLinkProbeStatus::Unsupported,
            checked_at_unix_ms: now_unix_ms(),
            wsl_version: None,
            default_distro: None,
            mirrored_networking: None,
            checks: vec![WslLinkProbeResult {
                key: "platform",
                label: "运行平台",
                status: WslLinkProbeStatus::Unsupported,
                message: "WSL Link 桌面主端当前仅支持 Windows。".to_string(),
                detail: None,
            }],
        };
    }

    let version_probe = probe_wsl_version().await;
    let status_probe = probe_wsl_status().await;
    let distro_probe = probe_wsl_distributions().await;
    let vmcompute_probe = probe_vmcompute().await;
    let mirrored_probe = probe_mirrored_networking().await;
    let mut checks = Vec::with_capacity(4);

    let wsl_version = version_probe
        .as_ref()
        .ok()
        .and_then(|output| first_non_empty_line(&output.stdout));
    let default_distro = status_probe
        .as_ref()
        .ok()
        .and_then(|output| parse_default_distro(&output.stdout));
    let mirrored_networking = mirrored_probe;

    checks.push(build_wsl_version_check(
        version_probe,
        status_probe.as_ref().ok(),
    ));
    checks.push(build_default_distro_check(status_probe));
    checks.push(build_distribution_check(distro_probe));
    checks.push(build_vmcompute_check(vmcompute_probe));

    let status = aggregate_status(&checks);

    WslLinkEnvironmentReport {
        status,
        checked_at_unix_ms: now_unix_ms(),
        wsl_version,
        default_distro,
        mirrored_networking,
        checks,
    }
}

async fn probe_wsl_version() -> Result<CommandProbeOutput, String> {
    run_command("wsl.exe", &["--version"]).await
}

async fn probe_wsl_status() -> Result<CommandProbeOutput, String> {
    run_command("wsl.exe", &["--status"]).await
}

async fn probe_wsl_distributions() -> Result<CommandProbeOutput, String> {
    run_command("wsl.exe", &["--list", "--quiet"]).await
}

async fn probe_vmcompute() -> Result<CommandProbeOutput, String> {
    run_command("sc.exe", &["query", "vmcompute"]).await
}

async fn run_command(program: &str, args: &[&str]) -> Result<CommandProbeOutput, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_command_for_background(&mut command);

    let output = match time::timeout(PROBE_TIMEOUT, command.output()).await {
        Ok(result) => result.map_err(|error| format!("无法执行 {program}：{error}"))?,
        Err(_) => {
            return Err(format!(
                "{program} 探测超过 {} 秒。",
                PROBE_TIMEOUT.as_secs()
            ))
        }
    };

    Ok(CommandProbeOutput {
        status_code: output.status.code(),
        stdout: decode_command_output(&output.stdout),
        stderr: decode_command_output(&output.stderr),
    })
}

#[cfg(windows)]
fn configure_command_for_background(command: &mut Command) {
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn configure_command_for_background(_command: &mut Command) {}

fn build_wsl_version_check(
    version_probe: Result<CommandProbeOutput, String>,
    status_probe: Option<&CommandProbeOutput>,
) -> WslLinkProbeResult {
    match version_probe {
        Ok(output) if output.status_code == Some(0) => {
            let version =
                first_non_empty_line(&output.stdout).unwrap_or_else(|| "WSL 已安装。".to_string());
            WslLinkProbeResult {
                key: "wsl-version",
                label: "WSL 版本",
                status: WslLinkProbeStatus::Ok,
                message: version,
                detail: compact_detail(&output),
            }
        }
        Ok(output) if status_probe.is_some_and(|status| status.status_code == Some(0)) => {
            WslLinkProbeResult {
                key: "wsl-version",
                label: "WSL 版本",
                status: WslLinkProbeStatus::Warning,
                message: "当前 WSL 可用，但不支持 `wsl.exe --version`，可能是较旧版本。"
                    .to_string(),
                detail: compact_detail(&output),
            }
        }
        Ok(output) => WslLinkProbeResult {
            key: "wsl-version",
            label: "WSL 版本",
            status: WslLinkProbeStatus::Error,
            message: "无法读取 WSL 版本。".to_string(),
            detail: compact_detail(&output),
        },
        Err(error) => WslLinkProbeResult {
            key: "wsl-version",
            label: "WSL 版本",
            status: WslLinkProbeStatus::Error,
            message: "无法启动 `wsl.exe`。".to_string(),
            detail: Some(error),
        },
    }
}

fn build_default_distro_check(
    status_probe: Result<CommandProbeOutput, String>,
) -> WslLinkProbeResult {
    match status_probe {
        Ok(output) if output.status_code == Some(0) => {
            let distro = parse_default_distro(&output.stdout);
            WslLinkProbeResult {
                key: "default-distro",
                label: "默认发行版",
                status: if distro.is_some() {
                    WslLinkProbeStatus::Ok
                } else {
                    WslLinkProbeStatus::Unknown
                },
                message: distro
                    .map(|value| format!("默认发行版：{value}。"))
                    .unwrap_or_else(|| "WSL 可用，但未能从状态输出识别默认发行版。".to_string()),
                detail: compact_detail(&output),
            }
        }
        Ok(output) => WslLinkProbeResult {
            key: "default-distro",
            label: "默认发行版",
            status: WslLinkProbeStatus::Warning,
            message: "无法读取默认 WSL 发行版。".to_string(),
            detail: compact_detail(&output),
        },
        Err(error) => WslLinkProbeResult {
            key: "default-distro",
            label: "默认发行版",
            status: WslLinkProbeStatus::Warning,
            message: "默认发行版探测失败。".to_string(),
            detail: Some(error),
        },
    }
}

fn build_distribution_check(
    distro_probe: Result<CommandProbeOutput, String>,
) -> WslLinkProbeResult {
    match distro_probe {
        Ok(output) if output.status_code == Some(0) => {
            let distros = non_empty_lines(&output.stdout);
            WslLinkProbeResult {
                key: "wsl-distros",
                label: "发行版列表",
                status: if distros.is_empty() {
                    WslLinkProbeStatus::Warning
                } else {
                    WslLinkProbeStatus::Ok
                },
                message: if distros.is_empty() {
                    "未发现可用 WSL 发行版。".to_string()
                } else {
                    format!("已发现 {} 个 WSL 发行版。", distros.len())
                },
                detail: (!distros.is_empty()).then(|| distros.join("\n")),
            }
        }
        Ok(output) => WslLinkProbeResult {
            key: "wsl-distros",
            label: "发行版列表",
            status: WslLinkProbeStatus::Warning,
            message: "无法读取 WSL 发行版列表。".to_string(),
            detail: compact_detail(&output),
        },
        Err(error) => WslLinkProbeResult {
            key: "wsl-distros",
            label: "发行版列表",
            status: WslLinkProbeStatus::Warning,
            message: "发行版列表探测失败。".to_string(),
            detail: Some(error),
        },
    }
}

fn build_vmcompute_check(
    vmcompute_probe: Result<CommandProbeOutput, String>,
) -> WslLinkProbeResult {
    match vmcompute_probe {
        Ok(output) if output.status_code == Some(0) && is_service_running(&output.stdout) => {
            WslLinkProbeResult {
                key: "vmcompute",
                label: "Hyper-V 计算服务",
                status: WslLinkProbeStatus::Ok,
                message: "`vmcompute` 服务正在运行。".to_string(),
                detail: compact_detail(&output),
            }
        }
        Ok(output) if output.status_code == Some(0) => WslLinkProbeResult {
            key: "vmcompute",
            label: "Hyper-V 计算服务",
            status: WslLinkProbeStatus::Warning,
            message: "`vmcompute` 服务当前未处于 RUNNING 状态，WSL2 可能需要按需启动。".to_string(),
            detail: compact_detail(&output),
        },
        Ok(output) => WslLinkProbeResult {
            key: "vmcompute",
            label: "Hyper-V 计算服务",
            status: WslLinkProbeStatus::Warning,
            message: "无法读取 `vmcompute` 服务状态。".to_string(),
            detail: compact_detail(&output),
        },
        Err(error) => WslLinkProbeResult {
            key: "vmcompute",
            label: "Hyper-V 计算服务",
            status: WslLinkProbeStatus::Warning,
            message: "`vmcompute` 服务探测失败。".to_string(),
            detail: Some(error),
        },
    }
}

async fn probe_mirrored_networking() -> Option<bool> {
    let Some(path) = user_wslconfig_path() else {
        return None;
    };

    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => return None,
    };

    let content = decode_command_output(&bytes);
    let mode = parse_wslconfig_networking_mode(&content);
    mode.as_deref()
        .map(|value| value.eq_ignore_ascii_case("mirrored"))
}

fn user_wslconfig_path() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".wslconfig"))
}

fn aggregate_status(checks: &[WslLinkProbeResult]) -> WslLinkProbeStatus {
    if checks
        .iter()
        .any(|check| check.status == WslLinkProbeStatus::Error)
    {
        return WslLinkProbeStatus::Error;
    }

    if checks.iter().any(|check| {
        matches!(
            check.status,
            WslLinkProbeStatus::Warning | WslLinkProbeStatus::Unknown
        )
    }) {
        return WslLinkProbeStatus::Warning;
    }

    WslLinkProbeStatus::Ok
}

fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if looks_like_utf16le(bytes) {
        let (decoded, _, _) = UTF_16LE.decode(bytes);
        return normalize_output(decoded.as_ref());
    }

    match String::from_utf8(bytes.to_vec()) {
        Ok(output) => normalize_output(&output),
        Err(_) => {
            let (decoded, _, _) = GB18030.decode(bytes);
            normalize_output(decoded.as_ref())
        }
    }
}

fn normalize_output(output: &str) -> String {
    output
        .replace('\u{feff}', "")
        .replace('\0', "")
        .trim()
        .to_string()
}

fn looks_like_utf16le(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && bytes
            .iter()
            .skip(1)
            .step_by(2)
            .filter(|byte| **byte == 0)
            .count()
            >= 2
}

fn first_non_empty_line(output: &str) -> Option<String> {
    non_empty_lines(output).into_iter().next()
}

fn non_empty_lines(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn compact_detail(output: &CommandProbeOutput) -> Option<String> {
    let stdout = output.stdout.trim();
    let stderr = output.stderr.trim();

    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => None,
        (false, true) => Some(stdout.to_string()),
        (true, false) => Some(stderr.to_string()),
        (false, false) => Some(format!("{stdout}\n{stderr}")),
    }
}

fn parse_default_distro(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let normalized = line.trim();
        let (_, value) = normalized.split_once(':')?;
        let key = normalized.split_once(':')?.0.trim().to_ascii_lowercase();
        let is_default_key = key == "default distribution"
            || key == "default distro"
            || key.contains("默认发行")
            || key.contains("默认分发");

        is_default_key
            .then(|| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn is_service_running(output: &str) -> bool {
    output
        .lines()
        .any(|line| line.to_ascii_uppercase().contains("RUNNING"))
}

fn parse_wslconfig_networking_mode(content: &str) -> Option<String> {
    let mut is_wsl2_section = false;

    for raw_line in content.lines() {
        let line = strip_ini_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            let section = line
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim()
                .to_ascii_lowercase();
            is_wsl2_section = section == "wsl2";
            continue;
        }

        if !is_wsl2_section {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("networkingMode") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn strip_ini_comment(line: &str) -> &str {
    let hash = line.find('#');
    let semicolon = line.find(';');

    match (hash, semicolon) {
        (Some(hash), Some(semicolon)) => &line[..hash.min(semicolon)],
        (Some(index), None) | (None, Some(index)) => &line[..index],
        (None, None) => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_detects_mirrored_networking_in_wsl2_section() {
        let content = r#"
[experimental]
networkingMode=nat

[wsl2]
networkingMode = mirrored # comment
"#;

        assert_eq!(
            parse_wslconfig_networking_mode(content),
            Some("mirrored".to_string()),
        );
    }

    #[test]
    fn parser_ignores_networking_mode_outside_wsl2_section() {
        let content = r#"
[experimental]
networkingMode=mirrored
"#;

        assert_eq!(parse_wslconfig_networking_mode(content), None);
    }

    #[test]
    fn parser_extracts_english_default_distribution() {
        let output = "Default Distribution: Ubuntu\nDefault Version: 2";

        assert_eq!(parse_default_distro(output), Some("Ubuntu".to_string()));
    }

    #[test]
    fn parser_extracts_chinese_default_distribution() {
        let output = "默认分发版: Ubuntu-22.04\n默认版本: 2";

        assert_eq!(
            parse_default_distro(output),
            Some("Ubuntu-22.04".to_string()),
        );
    }

    #[test]
    fn service_parser_detects_running_state() {
        let output = "STATE              : 4  RUNNING";

        assert!(is_service_running(output));
    }

    #[test]
    fn decoder_handles_utf16le_output() {
        let mut bytes = Vec::new();
        for unit in "WSL 版本".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }

        assert_eq!(decode_command_output(&bytes), "WSL 版本");
    }

    #[test]
    fn aggregate_status_promotes_warning_before_ok() {
        let checks = vec![
            WslLinkProbeResult {
                key: "a",
                label: "A",
                status: WslLinkProbeStatus::Ok,
                message: String::new(),
                detail: None,
            },
            WslLinkProbeResult {
                key: "b",
                label: "B",
                status: WslLinkProbeStatus::Unknown,
                message: String::new(),
                detail: None,
            },
        ];

        assert_eq!(aggregate_status(&checks), WslLinkProbeStatus::Warning);
    }
}
