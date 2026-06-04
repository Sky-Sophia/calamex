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