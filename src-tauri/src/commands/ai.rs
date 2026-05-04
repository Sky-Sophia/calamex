use super::contracts::{
    AiAgentClassifyTaskPayload, AiAgentClassifyTaskRequest, AiAgentNetworkPermissionPayload,
    AiAgentSetNetworkPermissionRequest, AiApplyPatchPayload, AiApplyPatchRequest,
    AiBuildIndexPayload, AiBuildIndexRequest, AiCancelRequest, AiChatMessagePayload, AiChatPayload,
    AiChatRequest, AiChatStreamPayload, AiCodeActionPayload, AiCodeActionRequest, AiConfigPayload,
    AiConversationTitlePayload, AiConversationTitleRequest, AiEditAuthStatePayload,
    AiEditCreateSnapshotPayload, AiEditCreateSnapshotRequest, AiEditGetDiffPayload,
    AiEditGetDiffRequest, AiEditListTimelinePayload, AiEditListTimelineRequest,
    AiEditRestoreSnapshotPayload, AiEditRestoreSnapshotRequest, AiEditRevertFilePayload,
    AiEditRevertFileRequest, AiEditRevertHunkPayload, AiEditRevertHunkRequest,
    AiEditRevertTaskPayload, AiEditRevertTaskRequest, AiEditSetAuthLevelRequest,
    AiEditUndoOperationPayload, AiEditUndoOperationRequest, AiInlineCompletionRangePayload,
    AiInlineCompletionRequest, AiInlineCompletionResult, AiNarratorRequest,
    AiNarratorResponsePayload, AiNarratorStreamPayload, AiProposePatchPayload,
    AiProposePatchRequest, AiProviderConnectionPayload, AiProviderConnectionRequest,
    AiProviderProfileDetailPayload, AiProviderProfilePayload, AiProviderProfileSwitchRequest,
    AiProviderTestPayload, AiQueryIndexPayload, AiQueryIndexRequest, AiSaveConfigRequest,
    AiSaveCredentialsRequest, AiToolDefinitionPayload, AiWebFetchInput, AiWebFetchPayload,
    AiWebSearchInput, AiWebSearchPayload,
};
use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai::gateway;
use crate::ai::network_permission;
use crate::ai::stream_manager;
use crate::ai_edit;
use crate::ai_edit::AiEditState;
use crate::ai_index;
use crate::ai_patch;
use crate::ai_tools::registry;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri::State;

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
        payload.role.as_deref(),
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
    gateway::save_credentials(
        payload.role.as_deref(),
        &payload.provider_type,
        &payload.api_key,
    )
}

#[tauri::command]
pub async fn ai_test_provider_config(
    payload: AiProviderConnectionRequest,
) -> Result<AiProviderTestPayload, String> {
    match gateway::test_provider_config(
        payload.role.as_deref(),
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
        payload.role.as_deref(),
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
pub fn ai_list_provider_profiles() -> Result<Vec<AiProviderProfilePayload>, String> {
    gateway::list_provider_profiles()
}

#[tauri::command]
pub fn ai_get_provider_profile_detail(
    payload: AiProviderProfileSwitchRequest,
) -> Result<AiProviderProfileDetailPayload, String> {
    gateway::get_provider_profile_detail(payload)
}

#[tauri::command]
pub fn ai_switch_provider_profile(
    payload: AiProviderProfileSwitchRequest,
) -> Result<AiConfigPayload, String> {
    gateway::switch_provider_profile(payload)
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
pub async fn ai_generate_conversation_title(
    payload: AiConversationTitleRequest,
) -> Result<AiConversationTitlePayload, String> {
    gateway::generate_conversation_title(payload).await
}

#[tauri::command]
pub async fn ai_narrate_activity(
    payload: AiNarratorRequest,
) -> Result<AiNarratorResponsePayload, String> {
    gateway::narrate_activity(payload).await
}

#[tauri::command]
pub async fn ai_narrate_activity_stream(
    app: AppHandle,
    payload: AiNarratorRequest,
) -> Result<AiNarratorStreamPayload, String> {
    let started = gateway::narrate_activity_stream(app, payload).await?;
    Ok(AiNarratorStreamPayload {
        stream_id: started.stream_id,
        run_id: started.run_id,
        message_id: started.message_id,
        turn_id: started.turn_id,
        facts_hash: started.facts_hash,
        sequence: started.sequence,
        trigger: started.trigger,
        model: started.model,
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
pub async fn ai_agent_classify_task(
    payload: AiAgentClassifyTaskRequest,
) -> Result<AiAgentClassifyTaskPayload, String> {
    gateway::classify_task(payload).await
}

#[tauri::command]
pub fn ai_agent_set_network_permission(
    payload: AiAgentSetNetworkPermissionRequest,
) -> Result<AiAgentNetworkPermissionPayload, String> {
    network_permission::set_network_permission(payload)
}

#[tauri::command]
pub async fn ai_web_search(payload: AiWebSearchInput) -> Result<AiWebSearchPayload, String> {
    crate::ai_tools::web_search::search(payload).await
}

#[tauri::command]
pub async fn ai_web_fetch(payload: AiWebFetchInput) -> Result<AiWebFetchPayload, String> {
    crate::ai_tools::web_fetch::fetch(payload).await
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
pub fn ai_edit_get_diff(
    app: AppHandle,
    payload: AiEditGetDiffRequest,
    state: State<AiEditState>,
) -> Result<AiEditGetDiffPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::get_diff(payload, &snapshot_root, state.inner())
}

#[tauri::command]
pub fn ai_edit_create_snapshot(
    app: AppHandle,
    payload: AiEditCreateSnapshotRequest,
    state: State<AiEditState>,
) -> Result<AiEditCreateSnapshotPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::create_snapshot(payload, &snapshot_root, state.inner())
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
pub fn ai_edit_revert_file(
    app: AppHandle,
    payload: AiEditRevertFileRequest,
    state: State<AiEditState>,
) -> Result<AiEditRevertFilePayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::revert_file(payload, &snapshot_root, state.inner())
}

#[tauri::command]
pub fn ai_edit_revert_hunk(
    app: AppHandle,
    payload: AiEditRevertHunkRequest,
    state: State<AiEditState>,
) -> Result<AiEditRevertHunkPayload, String> {
    let snapshot_root = resolve_ai_edit_storage_root(&app)?;
    ai_edit::revert_hunk(payload, &snapshot_root, state.inner())
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
