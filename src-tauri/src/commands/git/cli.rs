use std::{
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::OnceLock,
};

use crate::commands::contracts::DocumentEncoding;
use crate::commands::{configure_std_command_for_background, decode_script_bytes, find_command_path};

pub(super) fn cached_git_executable() -> Result<&'static Path, String> {
    static GIT: OnceLock<Option<PathBuf>> = OnceLock::new();
    GIT.get_or_init(|| {
        let name = if cfg!(windows) { "git.exe" } else { "git" };
        find_command_path(
            name,
            &[
                #[cfg(windows)]
                r"C:\Program Files\Git\cmd\git.exe",
                #[cfg(windows)]
                r"C:\Program Files (x86)\Git\cmd\git.exe",
            ],
        )
    })
    .as_deref()
    .ok_or_else(|| "未找到 git 可执行文件。".to_string())
}

pub(super) fn spawn_git(
    repository_root: &Path,
    args: &[&str],
    operation_label: &str,
) -> Result<Output, String> {
    let git = cached_git_executable()?;
    let mut cmd = Command::new(git);
    configure_std_command_for_background(&mut cmd);
    cmd.current_dir(repository_root)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.output()
        .map_err(|error| format!("执行 {operation_label} 失败：{error}"))
}

pub(super) fn run_git_text(
    repository_root: &Path,
    args: &[&str],
    operation_label: &str,
) -> Result<String, String> {
    let output = spawn_git(repository_root, args, operation_label)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("执行 {operation_label} 失败。")
        } else {
            format!("执行 {operation_label} 失败：{stderr}")
        });
    }
    let (content, _encoding) = decode_script_bytes(&output.stdout)
        .unwrap_or_else(|_| (String::from_utf8_lossy(&output.stdout).into_owned(), DocumentEncoding::Utf8));
    Ok(content)
}

pub(super) fn run_git_ok(
    repository_root: &Path,
    args: &[&str],
    operation_label: &str,
) -> Result<(), String> {
    let output = spawn_git(repository_root, args, operation_label)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("执行 {operation_label} 失败。")
        } else {
            format!("执行 {operation_label} 失败：{stderr}")
        });
    }
    Ok(())
}