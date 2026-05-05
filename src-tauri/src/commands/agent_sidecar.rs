use crate::agent_sidecar;
use crate::commands::contracts::{
    AgentSidecarApprovalResolveRequest, AgentSidecarChatRequest,
    AgentSidecarCheckpointRestoreRequest, AgentSidecarExecuteRequest, AgentSidecarHealthPayload,
    AgentSidecarPlanRequest, AgentSidecarResponsePayload,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn agent_sidecar_health() -> Result<AgentSidecarHealthPayload, String> {
    agent_sidecar::health().await
}

#[tauri::command]
pub async fn agent_sidecar_chat(
    app: AppHandle,
    payload: AgentSidecarChatRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::chat(app, payload).await
}

#[tauri::command]
pub async fn agent_sidecar_plan(
    app: AppHandle,
    payload: AgentSidecarPlanRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::plan(app, payload).await
}

#[tauri::command]
pub async fn agent_sidecar_execute(
    app: AppHandle,
    payload: AgentSidecarExecuteRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::execute(app, payload).await
}

#[tauri::command]
pub async fn agent_sidecar_resolve_approval(
    app: AppHandle,
    payload: AgentSidecarApprovalResolveRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::resolve_approval(app, payload).await
}

#[tauri::command]
pub async fn agent_sidecar_restore_checkpoint(
    app: AppHandle,
    payload: AgentSidecarCheckpointRestoreRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::restore_checkpoint(app, payload).await
}
