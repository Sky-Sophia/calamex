# apply-orchestrate.ps1
# Land the "client gray-scale integration (Rust command layer)" change.
# Run from the repo root (must contain src-tauri\Cargo.toml):
#   powershell -ExecutionPolicy Bypass -File .\apply-orchestrate.ps1
# This script is pure ASCII, so it parses correctly under any code page.
$ErrorActionPreference = 'Stop'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not (Test-Path (Join-Path $root 'src-tauri\Cargo.toml'))) {
    throw "src-tauri\Cargo.toml not found. Put this script at the repo root. Current: $root"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Detect repo newline style from agent_sidecar/mod.rs; align all writes to it.
$probePath = Join-Path $root 'src-tauri\src\agent_sidecar\mod.rs'
$probe = [System.IO.File]::ReadAllText($probePath)
$nl = if ($probe.Contains("`r`n")) { "`r`n" } else { "`n" }
Write-Host ("Repo newline: " + $(if ($nl -eq "`r`n") { 'CRLF' } else { 'LF' }))

function Write-NewFile([string]$rel, [string]$content) {
    $full = Join-Path $root $rel
    $dir = Split-Path $full -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $content = $content -replace "`r`n", "`n"
    if ($nl -eq "`r`n") { $content = $content -replace "`n", "`r`n" }
    [System.IO.File]::WriteAllText($full, $content, $utf8NoBom)
    Write-Host "  [new]  $rel"
}

function Edit-File([string]$rel, [string]$old, [string]$new, [string]$skipIfContains) {
    $full = Join-Path $root $rel
    $txt = [System.IO.File]::ReadAllText($full)
    if ($skipIfContains -and $txt.Contains($skipIfContains)) {
        Write-Host "  [skip] $rel already has the change"
        return
    }
    if (-not $txt.Contains($old)) {
        Write-Warning "  [warn] $rel anchor not found, edit manually. Anchor:`n$old"
        $script:hadWarning = $true
        return
    }
    $txt = $txt.Replace($old, $new)
    [System.IO.File]::WriteAllText($full, $txt, $utf8NoBom)
    Write-Host "  [edit] $rel"
}

$script:hadWarning = $false

# ---------------------------------------------------------------------------
# 1) New file: native orchestration contract types
# ---------------------------------------------------------------------------
$agentOrchestration = @'
use serde::{Deserialize, Serialize};
use specta::Type;

use super::AgentSidecarModelConfigPayload;

// ============================================================================
// Agent sidecar native orchestration (orchestration workflow)
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
    /// Final orchestration result; passed through verbatim and validated by the
    /// frontend (Zod). Mapped to TS `unknown` via specta_typescript::Unknown to
    /// avoid serde_json::Number tripping specta's BigInt-forbidden check.
    #[serde(default)]
    #[specta(type = specta_typescript::Unknown)]
    pub(crate) result: serde_json::Value,
}
'@
Write-NewFile 'src-tauri\src\commands\contracts\agent_orchestration.rs' $agentOrchestration

# ---------------------------------------------------------------------------
# 2) New file: orchestrate submodule (streaming + resume)
# ---------------------------------------------------------------------------
$orchestrate = @'
//! Native orchestration (Mastra createWorkflow) client command layer.
//!
//! Defined as a child module of `agent_sidecar` so it can reuse the parent's
//! existing HTTP / streaming / sidecar-autostart private helpers (via `super::`).
//! Adds two channels hitting the native orchestration endpoints, alongside the
//! existing per-phase channels:
//!   - `orchestrate`        -> streaming POST `/agent/plan/orchestrate/stream`
//!   - `orchestrate_resume` -> JSON      POST `/agent/plan/orchestrate/resume`
//!
//! Gated on the sidecar by `AGENT_ORCHESTRATION_WORKFLOW` (default off): when
//! disabled the streaming endpoint returns 404, and we surface an explicit
//! `AGENT_SIDECAR_ORCHESTRATION_DISABLED` error WITHOUT silently falling back to
//! a non-streaming legacy endpoint (orchestration has no legacy fallback).
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

/// NDJSON frames pushed by `/agent/plan/orchestrate/stream`.
///
/// Unlike the per-phase `AgentSidecarStreamFrame`: the orchestration stream's
/// first frame is `meta{runId}` and the last is `response{runId,result}` (the
/// server also sends a redundant `status` field, ignored as an unknown field).
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
                "AGENT_SIDECAR_CONTRACT_ERROR: failed to parse sidecar stream response ({ORCHESTRATE_STREAM_ENDPOINT}): {error}"
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
            "AGENT_SIDECAR_STREAM_ERROR: sidecar stream execution failed ({ORCHESTRATE_STREAM_ENDPOINT}): {error}"
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
            format!("AGENT_SIDECAR_UNAVAILABLE: failed to connect to Node sidecar ({url}): {error}")
        })?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Err(
            "AGENT_SIDECAR_ORCHESTRATION_DISABLED: native orchestration endpoint is not enabled; set AGENT_ORCHESTRATION_WORKFLOW=1 on the sidecar and restart."
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
            "AGENT_SIDECAR_READ_ERROR: failed to read sidecar stream response ({ORCHESTRATE_STREAM_ENDPOINT}): {error}"
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
            "AGENT_SIDECAR_CONTRACT_ERROR: sidecar stream response missing final result ({ORCHESTRATE_STREAM_ENDPOINT})"
        )
    })
}

/// Start one native orchestration run: runs until it suspends at an approval
/// gate or reaches a terminal state, streaming workflow events to the
/// `ai:sidecar-stream` window event throughout, and returns `{runId, result}`.
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

/// Resume an orchestration run suspended at an approval gate (approve / reject);
/// returns the post-resume `{runId, result}`.
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

        // The response frame carries a redundant `status` field that must be
        // ignored on decode; only runId + result are taken.
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
# 3) contracts/mod.rs: declare + re-export the new contract module
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
# 4) commands/agent_sidecar.rs: add 3 types to use block + append 2 commands
# ---------------------------------------------------------------------------
Edit-File 'src-tauri\src\commands\agent_sidecar.rs' `
    'AgentSidecarExecuteRequest, AgentSidecarHealthPayload,' `
    ('AgentSidecarExecuteRequest, AgentSidecarHealthPayload,' + $nl + '    AgentSidecarOrchestratePayload, AgentSidecarOrchestrateRequest,' + $nl + '    AgentSidecarOrchestrateResumeRequest,') `
    'AgentSidecarOrchestrateRequest'

$cmdFile = Join-Path $root 'src-tauri\src\commands\agent_sidecar.rs'
$cmdTxt = [System.IO.File]::ReadAllText($cmdFile)
if ($cmdTxt.Contains('agent_sidecar_orchestrate')) {
    Write-Host "  [skip] commands/agent_sidecar.rs already has orchestrate commands"
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
    Write-Host "  [edit] commands/agent_sidecar.rs (appended 2 commands)"
}

# ---------------------------------------------------------------------------
# 5) tauri_bindings.rs: register 2 commands in collect_commands!
# ---------------------------------------------------------------------------
Edit-File 'src-tauri\src\tauri_bindings.rs' `
    'agent_sidecar::agent_sidecar_restore_checkpoint,' `
    ('agent_sidecar::agent_sidecar_restore_checkpoint,' + $nl + '            agent_sidecar::agent_sidecar_orchestrate,' + $nl + '            agent_sidecar::agent_sidecar_orchestrate_resume,') `
    'agent_sidecar::agent_sidecar_orchestrate,'

# ---------------------------------------------------------------------------
# 6) agent_sidecar/mod.rs: 2 lines (after the contracts use block, before DEFAULT_SIDECAR_URL)
# ---------------------------------------------------------------------------
$modAnchor = $nl + "};" + $nl + $nl + 'const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:39871";'
$modInject = $nl + "};" + $nl + $nl + "mod orchestrate;" + $nl + "pub(crate) use orchestrate::{orchestrate, orchestrate_resume};" + $nl + $nl + 'const DEFAULT_SIDECAR_URL: &str = "http://127.0.0.1:39871";'
Edit-File 'src-tauri\src\agent_sidecar\mod.rs' $modAnchor $modInject 'mod orchestrate;'

# ---------------------------------------------------------------------------
Write-Host ""
if ($script:hadWarning) {
    Write-Warning "Some anchors were not found (see above). Apply those manually, then build."
} else {
    Write-Host "All changes applied."
}
Write-Host "Next: cd src-tauri ; cargo test ; cargo clippy ; then regenerate specta bindings (src/bindings/tauri.ts)."