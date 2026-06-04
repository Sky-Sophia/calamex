# apply-orchestrate.ps1
# 用途：落地「客户端灰度接入原生编排（Rust 命令层）」改动。
# 放在仓库根目录（应含 src-tauri\Cargo.toml）运行：
#   powershell -ExecutionPolicy Bypass -File .\apply-orchestrate.ps1
$ErrorActionPreference = 'Stop'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not (Test-Path (Join-Path $root 'src-tauri\Cargo.toml'))) {
    throw "未找到 src-tauri\Cargo.toml，请把脚本放到仓库根目录后再运行。当前: $root"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 以 agent_sidecar/mod.rs 探测仓库换行风格，所有写入与之对齐
$probePath = Join-Path $root 'src-tauri\src\agent_sidecar\mod.rs'
$probe = [System.IO.File]::ReadAllText($probePath)
$nl = if ($probe.Contains("`r`n")) { "`r`n" } else { "`n" }
Write-Host ("仓库换行风格: " + $(if ($nl -eq "`r`n") { 'CRLF' } else { 'LF' }))

function Write-NewFile([string]$rel, [string]$content) {
    $full = Join-Path $root $rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $content = $content -replace "`r`n", "`n"
    if ($nl -eq "`r`n") { $content = $content -replace "`n", "`r`n" }
    [System.IO.File]::WriteAllText($full, $content, $utf8NoBom)
    Write-Host "  [新建] $rel"
}

function Edit-File([string]$rel, [string]$old, [string]$new, [string]$skipIfContains) {
    $full = Join-Path $root $rel
    $txt = [System.IO.File]::ReadAllText($full)
    if ($skipIfContains -and $txt.Contains($skipIfContains)) {
        Write-Host "  [跳过] $rel 已包含改动"
        return
    }
    if (-not $txt.Contains($old)) {
        Write-Warning "  [告警] $rel 未找到锚点，请手动处理。锚点：`n$old"
        $script:hadWarning = $true
        return
    }
    $txt = $txt.Replace($old, $new)
    [System.IO.File]::WriteAllText($full, $txt, $utf8NoBom)
    Write-Host "  [改] $rel"
}

$script:hadWarning = $false

# ---------------------------------------------------------------------------
# 1) 新文件：原生编排契约类型
# ---------------------------------------------------------------------------
$agentOrchestration = @'
use serde::{Deserialize, Serialize};
use specta::Type;

use super::AgentSidecarModelConfigPayload;

// ============================================================================
// Agent sidecar 原生编排（orchestration workflow）
// ============================================================================

fn is_blank_optional_string(value: &Option<String>) -> bool {
    value
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidecarOrchestrateRequest {
    #[serde(skip_serializing_if = "is_blank_optional_string")]
    pub(crate) session_id: Option<String>,
    pub(crate) goal: String,
    #[serde(skip_serializing_if = "is_blank_optional_string")]
    pub(crate) thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_config: Option<AgentSidecarModelConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidecarOrchestrateResumeRequest {
    pub(crate) run_id: String,
    pub(crate) decision: String,
    #[serde(skip_serializing_if = "is_blank_optional_string")]
    pub(crate) reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_config: Option<AgentSidecarModelConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSidecarOrchestratePayload {
    pub(crate) run_id: String,
    /// 编排终态结果，逐字段透传由前端 Zod 校验；
    /// 用 specta_typescript::Unknown 将导出类型映射为 TS `unknown`，
    /// 避开 serde_json::Number 触发 specta BigInt-forbidden。
    #[serde(default)]
    #[specta(type = specta_typescript::Unknown)]
    pub(crate) result: serde_json::Value,
}
'@
Write-NewFile 'src-tauri\src\commands\contracts\agent_orchestration.rs' $agentOrchestration

# ---------------------------------------------------------------------------
# 2) 新文件：orchestrate 子模块（流式 + resume）
# ---------------------------------------------------------------------------
$orchestrate = @'
//! 原生编排（Mastra createWorkflow）客户端命令层。
//!
//! 作为 `agent_sidecar` 的子模块，复用父模块里现成的 HTTP / 流式 / sidecar
//! 自启动私有助手（经 `super::` 访问），新增两条走原生编排端点的通道，与既有
//! 「逐相」通道并存：
//!   - `orchestrate`        → 流式 POST `/agent/plan/orchestrate/stream`
//!   - `orchestrate_resume` → JSON   POST `/agent/plan/orchestrate/resume`
//!
//! 该编排能力在 sidecar 侧由 `AGENT_ORCHESTRATION_WORKFLOW` 门控、默认关闭：
//! 未启用时流式端点返回 404，这里显式报 `AGENT_SIDECAR_ORCHESTRATION_DISABLED`，
//! **不** 像逐相流式那样静默回退到非流式旧端点（编排没有等价旧端点可退）。
use serde::Deserialize;
use tauri::AppHandle;

use super::{
    build_sidecar_url, client, configured_base_url, current_sidecar_model_config, decode_response,
    decode_sidecar_stream_line_bytes, drain_complete_sidecar_stream_lines,
    emit_sidecar_stream_event, ensure_default_sidecar_available, ensure_request_session_id,
    has_non_whitespace_bytes, post_json,
};
use crate::commands::contracts::{
    AgentSidecarOrchestratePayload, AgentSidecarOrchestrateRequest,
    AgentSidecarOrchestrateResumeRequest,
};

const ORCHESTRATE_STREAM_ENDPOINT: &str = "/agent/plan/orchestrate/stream";
const ORCHESTRATE_RESUME_ENDPOINT: &str = "/agent/plan/orchestrate/resume";

/// `/agent/plan/orchestrate/stream` 推送的 NDJSON 帧。
///
/// 与逐相流式的 `AgentSidecarStreamFrame` 不同：编排流首帧为 `meta{runId}`、
/// 末帧为 `response{runId,result}`（服务端还会带一个冗余的 `status` 字段，
/// 解码时按 serde 默认忽略未知字段即可）。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum AgentSidecarOrchestrateStreamFrame {
    #[serde(rename = "meta")]
    Meta {
        #[serde(rename = "runId")]
        #[allow(dead_code)]
        run_id: String,
    },
    #[serde(rename = "event")]
    Event { event: serde_json::Value },
    #[serde(rename = "response")]
    Response {
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(default)]
        result: serde_json::Value,
    },
    #[serde(rename = "error")]
    Error { error: String },
}

fn consume_orchestrate_stream_line(
    app: &AppHandle,
    session_id: &str,
    seq: &mut u64,
    line: &str,
) -> Result<Option<AgentSidecarOrchestratePayload>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let frame = serde_json::from_str::<AgentSidecarOrchestrateStreamFrame>(trimmed).map_err(
        |error| {
            format!(
                "AGENT_SIDECAR_CONTRACT_ERROR: sidecar 流式响应无法解析({ORCHESTRATE_STREAM_ENDPOINT})：{error}"
            )
        },
    )?;

    match frame {
        AgentSidecarOrchestrateStreamFrame::Meta { .. } => Ok(None),
        AgentSidecarOrchestrateStreamFrame::Event { event } => {
            emit_sidecar_stream_event(app, session_id, *seq, event);
            *seq += 1;
            Ok(None)
        }
        AgentSidecarOrchestrateStreamFrame::Response { run_id, result } => {
            Ok(Some(AgentSidecarOrchestratePayload { run_id, result }))
        }
        AgentSidecarOrchestrateStreamFrame::Error { error } => Err(format!(
            "AGENT_SIDECAR_STREAM_ERROR: sidecar 流式执行失败({ORCHESTRATE_STREAM_ENDPOINT})：{error}"
        )),
    }
}

async fn post_orchestrate_streaming(
    app: &AppHandle,
    payload: &AgentSidecarOrchestrateRequest,
    session_id: &str,
) -> Result<AgentSidecarOrchestratePayload, String> {
    let base_url = configured_base_url();
    ensure_default_sidecar_available(&base_url).await?;

    let url = build_sidecar_url(&base_url, ORCHESTRATE_STREAM_ENDPOINT);
    let mut response = client()?
        .post(&url)
        .json(payload)
        .send()
        .await
        .map_err(|error| {
            format!("AGENT_SIDECAR_UNAVAILABLE: 无法连接 Node sidecar({url})：{error}")
        })?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Err(
            "AGENT_SIDECAR_ORCHESTRATION_DISABLED: 原生编排端点未启用，请在 sidecar 侧设置 AGENT_ORCHESTRATION_WORKFLOW=1 后重启。"
                .to_string(),
        );
    }
    if !status.is_success() {
        return decode_response(response, ORCHESTRATE_STREAM_ENDPOINT).await;
    }

    let mut buffer: Vec<u8> = Vec::new();
    let mut seq = 0_u64;
    let mut final_response: Option<AgentSidecarOrchestratePayload> = None;

    while let Some(chunk) = response.chunk().await.map_err(|error| {
        format!(
            "AGENT_SIDECAR_READ_ERROR: 读取 sidecar 流式响应失败({ORCHESTRATE_STREAM_ENDPOINT})：{error}"
        )
    })? {
        buffer.extend_from_slice(&chunk);

        for line in drain_complete_sidecar_stream_lines(&mut buffer, ORCHESTRATE_STREAM_ENDPOINT)? {
            if let Some(response) =
                consume_orchestrate_stream_line(app, session_id, &mut seq, &line)?
            {
                final_response = Some(response);
            }
        }
    }

    if has_non_whitespace_bytes(&buffer) {
        let line = decode_sidecar_stream_line_bytes(
            std::mem::take(&mut buffer),
            ORCHESTRATE_STREAM_ENDPOINT,
        )?;

        if let Some(response) = consume_orchestrate_stream_line(app, session_id, &mut seq, &line)? {
            final_response = Some(response);
        }
    }

    final_response.ok_or_else(|| {
        format!(
            "AGENT_SIDECAR_CONTRACT_ERROR: sidecar 流式响应缺少最终结果({ORCHESTRATE_STREAM_ENDPOINT})"
        )
    })
}

/// 启动一次原生编排 run：跑到审批门挂起或终态，全程把 workflow 事件经
/// `ai:sidecar-stream` 窗口事件实时下发，返回 `{runId, result}` 终态。
pub async fn orchestrate(
    app: AppHandle,
    mut payload: AgentSidecarOrchestrateRequest,
) -> Result<AgentSidecarOrchestratePayload, String> {
    let session_id = ensure_request_session_id(&mut payload.session_id, "sidecar-orchestrate");
    if payload.model_config.is_none() {
        payload.model_config = Some(current_sidecar_model_config()?);
    }
    post_orchestrate_streaming(&app, &payload, &session_id).await
}

/// 恢复一个在审批门挂起的编排 run（approve / reject），返回恢复后的 `{runId, result}`。
pub async fn orchestrate_resume(
    mut payload: AgentSidecarOrchestrateResumeRequest,
) -> Result<AgentSidecarOrchestratePayload, String> {
    if payload.model_config.is_none() {
        payload.model_config = Some(current_sidecar_model_config()?);
    }
    post_json(ORCHESTRATE_RESUME_ENDPOINT, &payload).await
}

#[cfg(test)]
mod tests {
    use super::AgentSidecarOrchestrateStreamFrame;

    #[test]
    fn orchestrate_stream_frames_decode_by_type_tag() {
        let meta: AgentSidecarOrchestrateStreamFrame =
            serde_json::from_str(r#"{"type":"meta","runId":"run-1"}"#)
                .expect("meta frame should decode");
        assert!(matches!(
            meta,
            AgentSidecarOrchestrateStreamFrame::Meta { .. }
        ));

        let event: AgentSidecarOrchestrateStreamFrame = serde_json::from_str(
            r#"{"type":"event","event":{"type":"message_delta","text":"hi"}}"#,
        )
        .expect("event frame should decode");
        match event {
            AgentSidecarOrchestrateStreamFrame::Event { event } => assert_eq!(
                event.get("type").and_then(|value| value.as_str()),
                Some("message_delta")
            ),
            other => panic!("expected event frame, got {other:?}"),
        }

        // response 帧带有冗余的 status 字段，解码时应被忽略，仅取 runId + result。
        let response: AgentSidecarOrchestrateStreamFrame = serde_json::from_str(
            r#"{"type":"response","runId":"run-1","status":"success","result":{"ok":true}}"#,
        )
        .expect("response frame should decode");
        match response {
            AgentSidecarOrchestrateStreamFrame::Response { run_id, result } => {
                assert_eq!(run_id, "run-1");
                assert_eq!(
                    result.get("ok").and_then(|value| value.as_bool()),
                    Some(true)
                );
            }
            other => panic!("expected response frame, got {other:?}"),
        }

        let error: AgentSidecarOrchestrateStreamFrame =
            serde_json::from_str(r#"{"type":"error","error":"boom"}"#)
                .expect("error frame should decode");
        match error {
            AgentSidecarOrchestrateStreamFrame::Error { error } => assert_eq!(error, "boom"),
            other => panic!("expected error frame, got {other:?}"),
        }
    }
}
'@
Write-NewFile 'src-tauri\src\agent_sidecar\orchestrate.rs' $orchestrate

# ---------------------------------------------------------------------------
# 3) contracts/mod.rs：声明 + 重导出新契约模块
# ---------------------------------------------------------------------------
Edit-File 'src-tauri\src\commands\contracts\mod.rs' `
    'mod agent_sidecar;' `
    ("mod agent_orchestration;" + $nl + "mod agent_sidecar;") `
    'mod agent_orchestration;'
Edit-File 'src-tauri\src\commands\contracts\mod.rs' `
    'pub use agent_sidecar::*;' `
    ("pub use agent_orchestration::*;" + $nl + "pub use agent_sidecar::*;") `
    'pub use agent_orchestration::*;'

# ---------------------------------------------------------------------------
# 4) commands/agent_sidecar.rs：use 块加 3 个类型 + 追加 2 条命令
# ---------------------------------------------------------------------------
Edit-File 'src-tauri\src\commands\agent_sidecar.rs' `
    'AgentSidecarExecuteRequest, AgentSidecarHealthPayload,' `
    ('AgentSidecarExecuteRequest, AgentSidecarHealthPayload,' + $nl + '    AgentSidecarOrchestratePayload, AgentSidecarOrchestrateRequest,' + $nl + '    AgentSidecarOrchestrateResumeRequest,') `
    'AgentSidecarOrchestrateRequest'

$cmdFile = Join-Path $root 'src-tauri\src\commands\agent_sidecar.rs'
$cmdTxt = [System.IO.File]::ReadAllText($cmdFile)
if ($cmdTxt.Contains('agent_sidecar_orchestrate')) {
    Write-Host "  [跳过] commands/agent_sidecar.rs 已含 orchestrate 命令"
} else {
    $newCommands = @'
#[tauri::command]
#[specta::specta]
pub async fn agent_sidecar_orchestrate(
    app: AppHandle,
    payload: AgentSidecarOrchestrateRequest,
) -> Result<AgentSidecarOrchestratePayload, String> {
    agent_sidecar::orchestrate(app, payload).await
}

#[tauri::command]
#[specta::specta]
pub async fn agent_sidecar_orchestrate_resume(
    payload: AgentSidecarOrchestrateResumeRequest,
) -> Result<AgentSidecarOrchestratePayload, String> {
    agent_sidecar::orchestrate_resume(payload).await
}
'@
    $newCommands = ($newCommands -replace "`r`n", "`n")
    if ($nl -eq "`r`n") { $newCommands = $newCommands -replace "`n", "`r`n" }
    $cmdTxt = $cmdTxt.TrimEnd() + $nl + $nl + $newCommands
    if (-not $cmdTxt.EndsWith($nl)) { $cmdTxt += $nl }
    [System.IO.File]::WriteAllText($cmdFile, $cmdTxt, $utf8NoBom)
    Write-Host "  [改] commands/agent_sidecar.rs（追加 2 条命令）"
}

# ---------------------------------------------------------------------------
# 5) tauri_bindings.rs：collect_commands! 登记 2 条命令
# ---------------------------------------------------------------------------
Edit-File 'src-tauri\src\tauri_bindings.rs' `
    'agent_sidecar::agent_sidecar_restore_checkpoint,' `
    ('agent_sidecar::agent_sidecar_restore_checkpoint,' + $nl + '            agent_sidecar::agent_sidecar_orchestrate,' + $nl + '            agent_sidecar::agent_sidecar_orchestrate_resume,') `
    'agent_sidecar::agent_sidecar_orchestrate,'

# ---------------------------------------------------------------------------
# 6) agent_sidecar/mod.rs：2 行模块声明（插在 contracts use 块之后、DEFAULT_SIDECAR_URL 之前）
# ---------------------------------------------------------------------------
$modAnchor = $nl + "};" + $nl + $nl + 'const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:39871";'
$modInject = $nl + "};" + $nl + $nl + "mod orchestrate;" + $nl + "pub(crate) use orchestrate::{orchestrate, orchestrate_resume};" + $nl + $nl + 'const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:39871";'
Edit-File 'src-tauri\src\agent_sidecar\mod.rs' $modAnchor $modInject 'mod orchestrate;'

# ---------------------------------------------------------------------------
Write-Host ""
if ($script:hadWarning) {
    Write-Warning "有锚点未命中（见上），请按提示手动补齐后再编译。"
} else {
    Write-Host "全部改动已应用。"
}
Write-Host "下一步：cd src-tauri ; cargo test ; cargo clippy ; 然后用你的方式生成 specta 绑定（重生成 src/bindings/tauri.ts）。"