use crate::agent_sidecar;
use crate::commands::contracts::{
    AgentSidecarApprovalResolveRequest, AgentSidecarChatRequest,
    AgentSidecarExecuteRequest, AgentSidecarHealthPayload, AgentSidecarPlanRequest,
    AgentSidecarResponsePayload,
};

#[tauri::command]
pub async fn agent_sidecar_health() -> Result<AgentSidecarHealthPayload, String> {
    agent_sidecar::health().await
}

#[tauri::command]
pub async fn agent_sidecar_chat(
    payload: AgentSidecarChatRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::chat(payload).await
}

#[tauri::command]
pub async fn agent_sidecar_plan(
    payload: AgentSidecarPlanRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::plan(payload).await
}

#[tauri::command]
pub async fn agent_sidecar_execute(
    payload: AgentSidecarExecuteRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::execute(payload).await
}

#[tauri::command]
pub async fn agent_sidecar_resolve_approval(
    payload: AgentSidecarApprovalResolveRequest,
) -> Result<AgentSidecarResponsePayload, String> {
    agent_sidecar::resolve_approval(payload).await
}
