use super::contracts::{
    AiAgentPlanPayload, AiAgentPlanRequest, AiApplyPatchPayload, AiApplyPatchRequest,
    AiBuildIndexPayload, AiBuildIndexRequest, AiCancelRequest, AiChatMessagePayload, AiChatPayload, AiChatRequest, AiChatStreamPayload,
    AiCodeActionPayload, AiCodeActionRequest, AiConfigPayload, AiInlineCompletionRangePayload,
    AiEditAuthStatePayload, AiEditListTimelinePayload, AiEditListTimelineRequest,
    AiEditRestoreSnapshotPayload, AiEditRestoreSnapshotRequest, AiEditRevertTaskPayload,
    AiEditRevertTaskRequest, AiEditSetAuthLevelRequest, AiEditUndoOperationPayload,
    AiEditUndoOperationRequest,
    AiInlineCompletionRequest, AiInlineCompletionResult, AiProposePatchPayload,
    AiProposePatchRequest, AiProviderConnectionPayload, AiProviderConnectionRequest,
    AiProviderTestPayload, AiQueryIndexPayload, AiQueryIndexRequest,
    AiSaveConfigRequest, AiSaveCredentialsRequest, AiToolDefinitionPayload,
};
use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai_edit::AiEditState;
use crate::ai::gateway;
use crate::ai::stream_manager;
use std::path::PathBuf;
use tauri::Manager;
use tauri::State;
use tauri::AppHandle;
use crate::ai_edit;
use crate::ai_index;
use crate::ai_patch;
use crate::ai_tools::registry;

fn resolve_ai_edit_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| ai_edit::errors::storage_path_unavailable(&error.to_string()))?
        .join(".notion-ide-ai")
        .join("edits"))
}

#[tauri::command]
pub fn ai_get_config() -> Result<AiConfigPayload, String> {
    Ok(gateway::get_config())
}

#[tauri::command]
pub fn ai_save_config(payload: AiSaveConfigRequest) -> Result<AiConfigPayload, String> {
    gateway::save_config(
        &payload.provider_type,
        payload.selected_model,
        payload.base_url,
        payload.inline_completion_enabled,
        payload.chat_enabled,
        payload.agent_enabled,
    )
}

#[tauri::command]
pub fn ai_save_credentials(payload: AiSaveCredentialsRequest) -> Result<AiConfigPayload, String> {
    gateway::save_credentials(&payload.provider_type, &payload.api_key)
}

#[tauri::command]
pub async fn ai_test_provider_config(
    payload: AiProviderConnectionRequest,
) -> Result<AiProviderTestPayload, String> {
    match gateway::test_provider_config(
        &payload.provider_type,
        payload.selected_model,
        payload.base_url,
        payload.inline_completion_enabled,
        payload.chat_enabled,
        payload.agent_enabled,
        payload.api_key.as_ref().map(|value| value.expose()),
    )
    .await
    {
        Ok(()) => Ok(AiProviderTestPayload {
            ok: true,
            code: "AI_PROVIDER_READY".to_string(),
            message: "AI Provider 可用。".to_string(),
        }),
        Err(error) => Ok(AiProviderTestPayload {
            ok: false,
            code: "AI_PROVIDER_UNAVAILABLE".to_string(),
            message: error,
        }),
    }
}

#[tauri::command]
pub async fn ai_connect_provider(
    payload: AiProviderConnectionRequest,
) -> Result<AiProviderConnectionPayload, String> {
    let config = gateway::connect_provider(
        &payload.provider_type,
        payload.selected_model,
        payload.base_url,
        payload.inline_completion_enabled,
        payload.chat_enabled,
        payload.agent_enabled,
        payload.api_key.as_ref().map(|value| value.expose()),
    )
    .await?;

    Ok(AiProviderConnectionPayload {
        config,
        test: AiProviderTestPayload {
            ok: true,
            code: "AI_PROVIDER_READY".to_string(),
            message: "AI Provider 可用。".to_string(),
        },
    })
}

#[tauri::command]
pub fn ai_clear_credentials() -> Result<(), String> {
    gateway::clear_credentials()?;
    audit::emit(AiAuditEventKind::CredentialCleared);
    Ok(())
}

#[tauri::command]
pub async fn ai_test_provider() -> Result<AiProviderTestPayload, String> {
    match gateway::test_provider().await {
        Ok(()) => Ok(AiProviderTestPayload {
            ok: true,
            code: "AI_PROVIDER_READY".to_string(),
            message: "AI Provider 可用。".to_string(),
        }),
        Err(error) => Ok(AiProviderTestPayload {
            ok: false,
            code: "AI_PROVIDER_UNAVAILABLE".to_string(),
            message: error,
        }),
    }
}

#[tauri::command]
pub async fn ai_chat(payload: AiChatRequest) -> Result<AiChatPayload, String> {
    let response = gateway::chat(payload).await?;
    Ok(AiChatPayload {
        message: AiChatMessagePayload {
            id: format!("assistant-{}", chrono::Utc::now().timestamp_millis()),
            role: "assistant".to_string(),
            content: response.content,
            created_at: chrono::Utc::now().to_rfc3339(),
            references: Vec::new(),
        },
        provider_type: gateway::get_config().provider_type,
        model: response.model,
    })
}


#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    payload: AiChatRequest,
) -> Result<AiChatStreamPayload, String> {
    let started = gateway::chat_stream(app, payload).await?;
    Ok(AiChatStreamPayload {
        stream_id: started.stream_id,
        assistant_message_id: started.assistant_message_id,
        provider_type: started.provider_type,
        model: started.model,
    })
}

#[tauri::command]
pub fn ai_cancel(payload: AiCancelRequest) -> Result<(), String> {
    let stream_id = payload.stream_id.trim();
    if stream_id.is_empty() {
        return Err("AI_REQUEST_CANCELLED: streamId 不能为空。".to_string());
    }
    stream_manager::cancel(stream_id);
    Ok(())
}

#[tauri::command]
pub async fn ai_inline_complete(
    payload: AiInlineCompletionRequest,
) -> Result<AiInlineCompletionResult, String> {
    let result = gateway::inline_complete(payload).await?;
    Ok(AiInlineCompletionResult {
        insert_text: result.insert_text,
        range: AiInlineCompletionRangePayload {
            start_offset: result.range.start_offset,
            end_offset: result.range.end_offset,
        },
        confidence: result.confidence,
    })
}

#[tauri::command]
pub async fn ai_code_action(payload: AiCodeActionRequest) -> Result<AiCodeActionPayload, String> {
    gateway::code_action(payload).await
}

#[tauri::command]
pub async fn ai_plan_task(payload: AiAgentPlanRequest) -> Result<AiAgentPlanPayload, String> {
    gateway::plan_task(payload).await
}

#[tauri::command]
pub fn ai_build_index(payload: AiBuildIndexRequest) -> Result<AiBuildIndexPayload, String> {
    ai_index::build_index(payload)
}

#[tauri::command]
pub fn ai_query_index(payload: AiQueryIndexRequest) -> Result<AiQueryIndexPayload, String> {
    ai_index::query_index(payload)
}

#[tauri::command]
pub fn ai_propose_patch(payload: AiProposePatchRequest) -> Result<AiProposePatchPayload, String> {
    ai_patch::propose_patch(payload)
}

#[tauri::command]
pub fn ai_apply_patch(
    app: AppHandle,
    payload: AiApplyPatchRequest,
    state: State<AiEditState>,
) -> Result<AiApplyPatchPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_patch::apply_patch(payload, state.inner(), &snapshot_root)
}

#[tauri::command]
pub fn ai_edit_get_auth_level(state: State<AiEditState>) -> Result<AiEditAuthStatePayload, String> {
    ai_edit::get_auth_level(state.inner())
}

#[tauri::command]
pub fn ai_edit_set_auth_level(
    payload: AiEditSetAuthLevelRequest,
    state: State<AiEditState>,
) -> Result<AiEditAuthStatePayload, String> {
    ai_edit::set_auth_level(payload, state.inner())
}

#[tauri::command]
pub fn ai_edit_list_timeline(
    app: AppHandle,
    payload: AiEditListTimelineRequest,
    state: State<AiEditState>,
) -> Result<AiEditListTimelinePayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    let stored_snapshots = ai_edit::snapshot::list_stored_snapshots(&snapshot_root)?;
    let stored_operations = ai_edit::edit_journal::list_operations(&snapshot_root)?;
    ai_edit::list_timeline_with_state(payload, state.inner(), stored_snapshots, stored_operations)
}

#[tauri::command]
pub fn ai_edit_restore_snapshot(
    app: AppHandle,
    payload: AiEditRestoreSnapshotRequest,
    state: State<AiEditState>,
) -> Result<AiEditRestoreSnapshotPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::restore_snapshot(payload, &snapshot_root, state.inner())
}

#[tauri::command]
pub fn ai_edit_undo_operation(
    app: AppHandle,
    payload: AiEditUndoOperationRequest,
    state: State<AiEditState>,
) -> Result<AiEditUndoOperationPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::undo_operation(payload, &snapshot_root, state.inner())
}

#[tauri::command]
pub fn ai_edit_revert_task(
    app: AppHandle,
    payload: AiEditRevertTaskRequest,
    state: State<AiEditState>,
) -> Result<AiEditRevertTaskPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::revert_task(payload, &snapshot_root, state.inner())
}

#[tauri::command]
pub fn ai_list_tools() -> Result<Vec<AiToolDefinitionPayload>, String> {
    Ok(registry::list_tools()
        .into_iter()
        .map(|tool| AiToolDefinitionPayload {
            name: tool.name.to_string(),
            read_only: tool.read_only,
            destructive: tool.destructive,
            requires_confirmation: tool.requires_confirmation,
        })
        .collect())
}
