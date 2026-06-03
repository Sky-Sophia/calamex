//! 对外 `#[tauri::command]` 入口与会话辅助。

use std::{sync::Arc, time::Duration};

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::timeout,
};

use super::discovery::{resolve_lsp_command, resolve_shellcheck_executable};
use super::io::{read_lsp_stdout, send_request, write_framed};
use super::protocol::{frame_message, jsonrpc_notify, jsonrpc_request, path_to_uri};
use super::types::{
    LspCompletionItem, LspHoverResult, LspManager, LspSession, LspState, PendingMap,
};

#[tauri::command]
#[specta::specta]
pub async fn lsp_start(
    app: AppHandle,
    manager: tauri::State<'_, LspManager>,
    workspace_root: String,
) -> Result<(), String> {
    // 整条启动路径串行化,杜绝双实例。
    let _startup_guard = manager.startup.lock().await;

    // 先把已有实例彻底停掉(不再用 TOCTOU 模式)。
    stop_inner(&manager.session, &manager.pending).await;

    let (node, cli_js) =
        resolve_lsp_command().map_err(|e| format!("无法启动 bash-language-server: {e}"))?;

    // 解析 shellcheck 绝对路径。必须在 spawn 之前完成,因为要作为子进程环境变量传入。
    // 关键:bash-language-server 的 onInitialize 根本不读 initializationOptions,
    // 它在 onInitialized 时从环境变量 SHELLCHECK_PATH 或 workspace/configuration 读配置。
    // 我们未声明 configuration 能力,所以最稳妥的方式是用 SHELLCHECK_PATH 环境变量。
    // shellcheck 是诊断的唯一来源;找不到时退回裸名,至少保持旧行为。
    let shellcheck_path = resolve_shellcheck_executable()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "shellcheck".to_string());
    log::info!("bash-ls 将使用 SHELLCHECK_PATH={shellcheck_path}");

    let mut child = Command::new(&node)
        .arg(&cli_js)
        .arg("start")
        .env("SHELLCHECK_PATH", &shellcheck_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .st