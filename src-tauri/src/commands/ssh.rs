use super::{
    configure_tokio_command_for_background, find_command_path, SshConfigHostPayload,
    SshConnectionTestPayload, SshConnectionTestRequest, SshDirectoryCreatePayload,
    SshDirectoryCreateRequest, SshDirectoryEntryPayload, SshDirectoryListPayload,
    SshDirectoryListRequest, SshFileDownloadPayload, SshFileDownloadRequest,
    SshFileUploadPayload, SshFileUploadRequest, SshPathDeletePayload, SshPathDeleteRequest,
    SshPathRenamePayload, SshPathRenameRequest,
};
use std::{env, path::PathBuf, process::Stdio, time::Duration};
use tokio::{fs, process::Command, time::timeout};

const SSH_TEST_TIMEOUT: Duration = Duration::from_secs(12);
const SSH_OK_MARKER: &str = "__XIAOJIANC_SSH_OK__";
const DEFAULT_SSH_PORT: u16 = 22;
const SSH_CONFIG_IMPORTED_LABEL: &str = "SSH config";

#[tauri::command]
pub async fn test_ssh_connection(
    payload: SshConnectionTestRequest,
) -> Result<SshConnectionTestPayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    if host.is_empty() {
        return Ok(failed("ssh/invalid-host", "请填写主机地址。"));
    }
    if username.is_empty() {
        return Ok(failed("ssh/invalid-username", "请填写用户名。"));
    }
    if payload.auth_mode != "key" && payload.auth_mode != "password" {
        return Ok(failed("ssh/invalid-auth-mode", "不支持的 SSH 认证方式。"));
    }

    let Some(ssh_path) = resolve_ssh_command_path() else {
        return Ok(failed(
            "ssh/not-found",
            "未找到 ssh 命令，请先安装 OpenSSH 客户端。",
        ));
    };

    let mut command = Command::new(ssh_path);
    configure_tokio_command_for_background(&mut command);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-p")
        .arg(payload.port.to_string());

    if payload.auth_mode == "key" {
        if let Some(identity_path) = payload.identity_path.as_deref().map(str::trim) {
            if !identity_path.is_empty() {
                command.arg("-i").arg(expand_local_path(identity_path));
            }
        }
    }

    command
        .arg(format!("{username}@{host}"))
        .arg(format!("printf '%s' {SSH_OK_MARKER}"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(SSH_TEST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Ok(failed(
                "ssh/spawn-failed",
                &format!("启动 ssh 命令失败：{error}"),
            ))
        }
        Err(_) => return Ok(failed("ssh/timeout", "SSH 连接测试超时。")),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() && stdout.contains(SSH_OK_MARKER) {
        return Ok(SshConnectionTestPayload {
            ok: true,
            code: "ssh/ok".into(),
            message: "SSH 连接验证成功。".into(),
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(failed(
        &classify_ssh_error(&stderr),
        &format_ssh_error_message(&stderr),
    ))
}

#[tauri::command]
pub async fn list_ssh_config_hosts() -> Result<Vec<SshConfigHostPayload>, String> {
    let Some(config_path) = default_ssh_config_path() else {
        return Ok(Vec::new());
    };

    let content = match fs::read_to_string(&config_path).await {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("读取 SSH 配置失败：{error}")),
    };

    Ok(parse_ssh_config_hosts(&content))
}

#[tauri::command]
pub async fn list_ssh_directory(
    payload: SshDirectoryListRequest,
) -> Result<SshDirectoryListPayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    let remote_path = normalize_remote_path(&payload.path);
    if host.is_empty() {
        return Err("请填写主机地址。".into());
    }
    if username.is_empty() {
        return Err("请填写用户名。".into());
    }
    if payload.auth_mode == "password" {
        return Err(
            "密码认证暂不支持非交互式浏览远端文件，请使用已配置的密钥或 SSH agent。".into(),
        );
    }

    let Some(ssh_path) = resolve_ssh_command_path() else {
        return Err("未找到 ssh 命令，请先安装 OpenSSH 客户端。".into());
    };

    let mut command = Command::new(ssh_path);
    configure_tokio_command_for_background(&mut command);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-p")
        .arg(payload.port.to_string());

    if let Some(identity_path) = payload.identity_path.as_deref().map(str::trim) {
        if !identity_path.is_empty() {
            command.arg("-i").arg(expand_local_path(identity_path));
        }
    }

    command
        .arg(format!("{username}@{host}"))
        .arg(build_remote_list_script(&remote_path))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(SSH_TEST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("启动 ssh 命令失败：{error}")),
        Err(_) => return Err("读取远端目录超时。".into()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format_ssh_directory_error(&stderr));
    }

    Ok(SshDirectoryListPayload {
        path: remote_path,
        entries: parse_remote_directory_entries(&output.stdout, &payload.path),
    })
}

#[tauri::command]
pub async fn download_ssh_file(
    payload: SshFileDownloadRequest,
) -> Result<SshFileDownloadPayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    let remote_path = normalize_remote_path(&payload.remote_path);
    let local_path = payload.local_path.trim();
    if host.is_empty() {
        return Err("请填写主机地址。".into());
    }
    if username.is_empty() {
        return Err("请填写用户名。".into());
    }
    if local_path.is_empty() {
        return Err("请选择本地保存路径。".into());
    }
    if payload.auth_mode == "password" {
        return Err("密码认证暂不支持非交互式下载文件，请使用已配置的密钥或 SSH agent。".into());
    }

    let Some(ssh_path) = resolve_ssh_command_path() else {
        return Err("未找到 ssh 命令，请先安装 OpenSSH 客户端。".into());
    };

    let mut command = Command::new(ssh_path);
    configure_tokio_command_for_background(&mut command);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-p")
        .arg(payload.port.to_string());

    if let Some(identity_path) = payload.identity_path.as_deref().map(str::trim) {
        if !identity_path.is_empty() {
            command.arg("-i").arg(expand_local_path(identity_path));
        }
    }

    command
        .arg(format!("{username}@{host}"))
        .arg(build_remote_download_script(&remote_path))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(SSH_TEST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("启动 ssh 命令失败：{error}")),
        Err(_) => return Err("下载远端文件超时。".into()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format_ssh_download_error(&stderr));
    }

    fs::write(local_path, &output.stdout)
        .await
        .map_err(|error| format!("写入本地文件失败：{error}"))?;

    Ok(SshFileDownloadPayload {
        remote_path,
        local_path: local_path.into(),
        byte_size: output.stdout.len() as u64,
    })
}

#[tauri::command]
pub async fn upload_ssh_file(
    payload: SshFileUploadRequest,
) -> Result<SshFileUploadPayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    let local_path = payload.local_path.trim();
    let remote_directory = normalize_remote_path(&payload.remote_directory);
    if host.is_empty() {
        return Err("请填写主机地址。".into());
    }
    if username.is_empty() {
        return Err("请填写用户名。".into());
    }
    if local_path.is_empty() {
        return Err("请选择要上传的本地文件。".into());
    }
    if payload.auth_mode == "password" {
        return Err("密码认证暂不支持非交互式上传文件，请使用已配置的密钥或 SSH agent。".into());
    }

    let local_file_path = PathBuf::from(local_path);
    let file_name = local_file_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "无法识别本地文件名。".to_string())?;
    let metadata = std::fs::metadata(&local_file_path)
        .map_err(|error| format!("读取本地文件信息失败：{error}"))?;
    if !metadata.is_file() {
        return Err("请选择一个本地文件，暂不支持上传目录。".into());
    }

    let file = std::fs::File::open(&local_file_path)
        .map_err(|error| format!("打开本地文件失败：{error}"))?;
    let remote_path = join_remote_path(&remote_directory, file_name);

    let Some(ssh_path) = resolve_ssh_command_path() else {
        return Err("未找到 ssh 命令，请先安装 OpenSSH 客户端。".into());
    };

    let mut command = Command::new(ssh_path);
    configure_tokio_command_for_background(&mut command);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-p")
        .arg(payload.port.to_string());

    if let Some(identity_path) = payload.identity_path.as_deref().map(str::trim) {
        if !identity_path.is_empty() {
            command.arg("-i").arg(expand_local_path(identity_path));
        }
    }

    command
        .arg(format!("{username}@{host}"))
        .arg(build_remote_upload_script(&remote_path))
        .stdin(Stdio::from(file))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(SSH_TEST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("启动 ssh 命令失败：{error}")),
        Err(_) => return Err("上传本地文件超时。".into()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.code() == Some(4) {
            return Err("远端已存在同名文件，已取消上传以避免覆盖。".into());
        }
        return Err(format_ssh_upload_error(&stderr));
    }

    Ok(SshFileUploadPayload {
        local_path: local_path.into(),
        remote_path,
        byte_size: metadata.len(),
    })
}

#[tauri::command]
pub async fn delete_ssh_path(
    payload: SshPathDeleteRequest,
) -> Result<SshPathDeletePayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    let remote_path = normalize_remote_path(&payload.remote_path);
    if host.is_empty() {
        return Err("请填写主机地址。".into());
    }
    if username.is_empty() {
        return Err("请填写用户名。".into());
    }
    if payload.auth_mode == "password" {
        return Err("密码认证暂不支持非交互式删除，请使用已配置的密钥或 SSH agent。".into());
    }
    if remote_path == "." || remote_path == "/" || remote_path == "~" {
        return Err("拒绝删除远端根目录或当前目录。".into());
    }

    run_remote_mutation(
        &payload.host,
        payload.port,
        &payload.username,
        payload.identity_path.as_deref(),
        build_remote_delete_script(&remote_path),
        "删除远端路径",
    )
    .await?;

    Ok(SshPathDeletePayload { remote_path })
}

#[tauri::command]
pub async fn rename_ssh_path(
    payload: SshPathRenameRequest,
) -> Result<SshPathRenamePayload, String> {
    let host = payload.host.trim();
    let username = payload.username.trim();
    let remote_path = normalize_remote_path(&payload.remote_path);
    let new_name = payload.new_name.trim();
    if host.is_empty() {
        return Err("请填写主机地址。".into());
    }
    if username.is_empty() {
        return Err("请填写用户名。".into());
    }
    if payload.auth_mode == "password" {
        return Err("密码认证暂不支持非交互式重命名，请使用已配置的密钥或 SSH agent。".into());
    }
    if !is_safe_file_name(new_name) {
        return Err("新名称不能为空，且不能包含路径分隔符。".into());
    }

    let new_path = join_remote_path(&parent_remote_path(&remote_path), new_name);
    run_remote_mutation(
        &payload.host,
        payload.port,
        &payload.username,
        payload.identity_path.as_deref(),
        build_remote_rename_script(&remote_path, &new_path),
        "重命名远端路径",
    )
    .await?;

    Ok(SshPathRenamePayload {
        old_path: remote_path,
        new_path,
    })
}

async fn run_remote_mutation(
    host: &str,
    port: u16,
    username: &str,
    identity_path: Option<&str>,
    script: String,
    action_label: &str,
) -> Result<(), String> {
    let Some(ssh_path) = resolve_ssh_command_path() else {
        return Err("未找到 ssh 命令，请先安装 OpenSSH 客户端。".into());
    };

    let mut command = Command::new(ssh_path);
    configure_tokio_command_for_background(&mut command);
    command
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=8")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=0")
        .arg("-p")
        .arg(port.to_string());

    if let Some(identity_path) = identity_path.map(str::trim) {
        if !identity_path.is_empty() {
            command.arg("-i").arg(expand_local_path(identity_path));
        }
    }

    command
        .arg(format!("{}@{}", username.trim(), host.trim()))
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(SSH_TEST_TIMEOUT, command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Err(format!("启动 ssh 命令失败：{error}")),
        Err(_) => return Err(format!("{action_label}超时。")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if output.status.code() == Some(4) {
            return Err("远端目标已存在，已取消操作以避免覆盖。".into());
        }
        if stderr.trim().is_empty() {
            return Err(format!("{action_label}失败。"));
        }
        return Err(format!("{action_label}失败：{}", stderr.trim()));
    }

    Ok(())
}

fn resolve_ssh_command_path() -> Option<PathBuf> {
    if cfg!(windows) {
        find_command_path("ssh.exe", &[r"C:\Windows\System32\OpenSSH\ssh.exe"])
    } else {
        find_command_path("ssh", &[])
    }
}

fn failed(code: &str, message: &str) -> SshConnectionTestPayload {
    SshConnectionTestPayload {
        ok: false,
        code: code.into(),
        message: message.into(),
    }
}

fn classify_ssh_error(stderr: &str) -> String {
    let normalized = stderr.to_ascii_lowercase();
    if normalized.contains("permission denied")
        || normalized.contains("publickey")
        || normalized.contains("authentication")
    {
        return "ssh/auth-failed".into();
    }
    if normalized.contains("could not resolve hostname")
        || normalized.contains("name or service not known")
        || normalized.contains("nodename nor servname")
    {
        return "ssh/host-unresolved".into();
    }
    if normalized.contains("connection timed out") || normalized.contains("operation timed out") {
        return "ssh/timeout".into();
    }
    if normalized.contains("connection refused") {
        return "ssh/connection-refused".into();
    }
    if normalized.contains("host key verification failed") {
        return "ssh/host-key-untrusted".into();
    }
    "ssh/failed".into()
}

fn format_ssh_error_message(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        return "SSH 连接验证失败。".into();
    }

    format!("SSH 连接验证失败：{}", stderr.trim())
}

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return ".".into();
    }

    trimmed.into()
}

fn build_remote_list_script(path: &str) -> String {
    format!(
        "cd {} || exit 2; for p in .* *; do [ \"$p\" = \".\" ] && continue; [ \"$p\" = \"..\" ] && continue; [ -e \"$p\" ] || [ -L \"$p\" ] || continue; if [ -d \"$p\" ]; then k=directory; else k=file; fi; s=$(wc -c < \"$p\" 2>/dev/null | tr -d '[:space:]'); printf '%s\\0%s\\0%s\\0' \"$k\" \"${{s:-0}}\" \"$p\"; done",
        quote_posix_shell(path)
    )
}

fn build_remote_download_script(path: &str) -> String {
    format!(
        "test -f {} || exit 3; cat -- {}",
        quote_posix_shell(path),
        quote_posix_shell(path)
    )
}

fn build_remote_upload_script(path: &str) -> String {
    format!(
        "test ! -e {} || exit 4; cat > {}",
        quote_posix_shell(path),
        quote_posix_shell(path)
    )
}

fn build_remote_delete_script(path: &str) -> String {
    format!(
        "test -e {} || test -L {} || exit 5; rm -rf -- {}",
        quote_posix_shell(path),
        quote_posix_shell(path),
        quote_posix_shell(path)
    )
}

fn build_remote_rename_script(old_path: &str, new_path: &str) -> String {
    format!(
        "test -e {} || test -L {} || exit 5; test ! -e {} || exit 4; mv -- {} {}",
        quote_posix_shell(old_path),
        quote_posix_shell(old_path),
        quote_posix_shell(new_path),
        quote_posix_shell(old_path),
        quote_posix_shell(new_path)
    )
}

fn quote_posix_shell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn parse_remote_directory_entries(
    stdout: &[u8],
    current_path: &str,
) -> Vec<SshDirectoryEntryPayload> {
    let mut entries = stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .chunks(3)
        .filter_map(|chunk| {
            if chunk.len() != 3 {
                return None;
            }

            let kind = String::from_utf8_lossy(chunk[0]).to_string();
            let size = String::from_utf8_lossy(chunk[1])
                .parse::<u64>()
                .unwrap_or(0);
            let name = String::from_utf8_lossy(chunk[2]).to_string();
            let path = join_remote_path(current_path, &name);
            Some(SshDirectoryEntryPayload {
                name,
                path,
                kind,
                size,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        (left.kind.as_str() != "directory", left.name.to_lowercase()).cmp(&(
            right.kind.as_str() != "directory",
            right.name.to_lowercase(),
        ))
    });
    entries
}

fn join_remote_path(base: &str, name: &str) -> String {
    let normalized_base = normalize_remote_path(base);
    if normalized_base == "." {
        return name.into();
    }
    if normalized_base == "/" {
        return format!("/{name}");
    }

    format!("{}/{}", normalized_base.trim_end_matches('/'), name)
}

fn parent_remote_path(path: &str) -> String {
    let normalized = normalize_remote_path(path);
    let trimmed = normalized.trim_end_matches('/');
    if trimmed == "." || trimmed == "/" {
        return ".".into();
    }

    match trimmed.rsplit_once('/') {
        Some(("", _)) => "/".into(),
        Some((parent, _)) if !parent.is_empty() => parent.into(),
        _ => ".".into(),
    }
}

fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}

fn format_ssh_directory_error(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        return "读取远端目录失败。".into();
    }

    format!("读取远端目录失败：{}", stderr.trim())
}

fn format_ssh_download_error(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        return "下载远端文件失败。".into();
    }

    format!("下载远端文件失败：{}", stderr.trim())
}

fn format_ssh_upload_error(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        return "上传本地文件失败。".into();
    }

    format!("上传本地文件失败：{}", stderr.trim())
}

fn expand_local_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(trimmed));
    }

    if let Some(stripped) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return home.join(stripped);
        }
    }

    PathBuf::from(trimmed)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn default_ssh_config_path() -> Option<PathBuf> {
    Some(home_dir()?.join(".ssh").join("config"))
}

#[derive(Debug, Default)]
struct SshConfigHostDraft {
    aliases: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

impl SshConfigHostDraft {
    fn into_payloads(self) -> Vec<SshConfigHostPayload> {
        self.aliases
            .into_iter()
            .filter(|alias| is_concrete_host_alias(alias))
            .map(|alias| {
                let host = self.host_name.clone().unwrap_or_else(|| alias.clone());
                let username = self.user.clone().unwrap_or_else(current_username);
                SshConfigHostPayload {
                    id: format!("ssh-config-{alias}"),
                    name: alias,
                    username,
                    host,
                    port: self.port.unwrap_or(DEFAULT_SSH_PORT),
                    identity_path: self.identity_file.clone(),
                    last_used_label: SSH_CONFIG_IMPORTED_LABEL.into(),
                }
            })
            .collect()
    }
}

fn parse_ssh_config_hosts(content: &str) -> Vec<SshConfigHostPayload> {
    let mut hosts = Vec::new();
    let mut current: Option<SshConfigHostDraft> = None;

    for raw_line in content.lines() {
        let Some((keyword, value)) = parse_ssh_config_line(raw_line) else {
            continue;
        };

        if keyword.eq_ignore_ascii_case("Host") {
            if let Some(draft) = current.take() {
                hosts.extend(draft.into_payloads());
            }

            let aliases = value
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>();
            current = Some(SshConfigHostDraft {
                aliases,
                ..SshConfigHostDraft::default()
            });
            continue;
        }

        let Some(draft) = current.as_mut() else {
            continue;
        };

        if keyword.eq_ignore_ascii_case("HostName") {
            draft.host_name = Some(value.to_string());
        } else if keyword.eq_ignore_ascii_case("User") {
            draft.user = Some(value.to_string());
        } else if keyword.eq_ignore_ascii_case("Port") {
            draft.port = value.parse::<u16>().ok();
        } else if keyword.eq_ignore_ascii_case("IdentityFile") {
            draft.identity_file = Some(value.to_string());
        }
    }

    if let Some(draft) = current {
        hosts.extend(draft.into_payloads());
    }

    hosts
}

fn parse_ssh_config_line(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let without_comment = trimmed
        .split_once('#')
        .map_or(trimmed, |(prefix, _)| prefix)
        .trim();
    if without_comment.is_empty() {
        return None;
    }

    let (keyword, value) = split_ssh_config_keyword(without_comment)?;
    let normalized_value = value.trim().trim_matches('"');
    if keyword.trim().is_empty() || normalized_value.is_empty() {
        return None;
    }

    Some((keyword.trim(), normalized_value))
}

fn split_ssh_config_keyword(line: &str) -> Option<(&str, &str)> {
    if let Some((keyword, value)) = line.split_once('=') {
        return Some((keyword, value));
    }

    let split_index = line.find(char::is_whitespace)?;
    Some(line.split_at(split_index))
}

fn is_concrete_host_alias(alias: &str) -> bool {
    !alias.is_empty() && !alias.contains('*') && !alias.contains('?') && !alias.starts_with('!')
}

fn current_username() -> String {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "root".into())
}
