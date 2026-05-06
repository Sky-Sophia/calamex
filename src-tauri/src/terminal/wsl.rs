use std::{
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const WSL_TEMP_DIRECTORY: &str = "/tmp";
static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 将 Windows 路径中的扩展路径前缀归一化为常规本地路径。
pub fn normalize_windows_path_for_wsl(value: &str) -> Result<String, String> {
    if let Some(network_path) = value.strip_prefix("\\\\?\\UNC\\") {
        return Err(format!(
            "暂不支持将网络共享路径转换为 WSL 路径：\\\\{}",
            network_path
        ));
    }

    if let Some(extended_path) = value.strip_prefix("\\\\?\\") {
        return Ok(extended_path.to_string());
    }

    Ok(value.to_string())
}

/// 将 Windows 本地磁盘路径转换为 WSL `/mnt/<drive>/...` 路径。
pub fn to_wsl_path(path: &Path) -> Result<String, String> {
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

/// 对即将插入 bash 命令行的字符串做单引号转义。
pub fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// 构造跨命令共享的临时文件后缀，包含微秒时间戳与进程内递增序列。
pub(crate) fn build_temp_file_suffix() -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_micros();
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);

    Ok(format!("{stamp}-{sequence}"))
}

/// 基于原始文件名构造 WSL `/tmp` 下的临时脚本路径。
pub(crate) fn build_terminal_temp_script_path(original_name: &str) -> Result<String, String> {
    let suffix = build_temp_file_suffix()?;
    let stem = Path::new(original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("untitled");

    Ok(format!("{WSL_TEMP_DIRECTORY}/{stem}-{suffix}.tmp.sh"))
}
