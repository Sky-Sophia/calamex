#![allow(dead_code)]

#[macro_use]
#[path = "../commands/window.rs"]
mod window;
#[macro_use]
#[path = "../commands/window_stage.rs"]
mod window_stage;
#[path = "../commands/contracts.rs"]
mod contracts;
#[path = "../commands/script_run.rs"]
mod script_run;
#[path = "../commands/search.rs"]
mod search;
#[path = "../commands/shell_tools.rs"]
mod shell_tools;
#[path = "../tauri_bindings.rs"]
mod tauri_bindings;
#[path = "../commands/workspace_fs.rs"]
mod workspace_fs;
#[path = "../commands/workspace_watcher.rs"]
mod workspace_watcher;

mod commands {
    pub(crate) use crate::{script_run, search, shell_tools, window, window_stage, workspace_fs, workspace_watcher};
}

pub use contracts::{
    AnalyzeScriptPayload, AnalyzeScriptRequest, DocumentEncoding, ExecutionEnvironment,
    ExecutionOption, ExecutorKind, FormatScriptPayload, FormatScriptRequest, ImageAssetPayload,
    SaveScriptRequest, ScriptDiagnosticPayload, ScriptDiagnosticSeverity, ScriptFilePayload,
    WorkspaceDirectoryPayload, WorkspaceEntry, WorkspacePathCreatePayload,
    WorkspacePathCreateRequest, WorkspacePathDeletePayload, WorkspacePathDeleteRequest,
    WorkspacePathKind, WorkspacePathRenamePayload, WorkspacePathRenameRequest,
};
pub(crate) use script_run::{find_command_path, line_count};
pub(crate) use workspace_fs::{decode_script_bytes, encode_script_content, resolve_workspace_root};

pub(crate) fn build_temp_file_suffix() -> Result<String, String> {
    Ok(format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("生成临时文件名失败：{error}"))?
            .as_nanos()
    ))
}

pub(crate) fn to_wsl_path(path: &std::path::Path) -> Result<String, String> {
    Ok(path.to_string_lossy().replace('\\', "/"))
}

#[cfg(windows)]
pub(crate) fn configure_std_command_for_background(
    command: &mut std::process::Command,
) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;

    command.creation_flags(0x0800_0000)
}

#[cfg(not(windows))]
pub(crate) fn configure_std_command_for_background(
    command: &mut std::process::Command,
) -> &mut std::process::Command {
    command
}

#[cfg(windows)]
pub(crate) fn configure_tokio_command_for_background(
    command: &mut tokio::process::Command,
) -> &mut tokio::process::Command {
    command.creation_flags(0x0800_0000)
}

#[cfg(not(windows))]
pub(crate) fn configure_tokio_command_for_background(
    command: &mut tokio::process::Command,
) -> &mut tokio::process::Command {
    command
}

fn main() {
    let builder = tauri_bindings::builder();
    tauri_bindings::export(&builder);
}
