pub mod auto_apply;
pub mod diff_render;
pub mod edit_journal;
pub mod errors;
pub mod protected_paths;
pub mod revert;
pub mod snapshot;
pub mod timeline;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::commands::contracts::{
    AiApplyPatchMetadataRequest,
    AiEditAuthStatePayload, AiEditListTimelinePayload, AiEditListTimelineRequest,
    AiEditOperationPayload, AiEditRestoreSnapshotPayload, AiEditRestoreSnapshotRequest,
    AiEditRevertTaskPayload, AiEditRevertTaskRequest, AiEditSetAuthLevelRequest,
    AiEditTimelineEntryPayload, AiEditUndoOperationPayload, AiEditUndoOperationRequest,
    AiSnapshotPayload,
};
use chrono::Utc;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy)]
enum AiEditAuthLevel {
    Manual,
    PerTask,
    Session,
}

impl AiEditAuthLevel {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "manual" => Ok(Self::Manual),
            "per_task" => Ok(Self::PerTask),
            "session" => Ok(Self::Session),
            other => Err(errors::invalid_auth_level(other)),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::PerTask => "per_task",
            Self::Session => "session",
        }
    }
}

#[derive(Debug, Clone)]
struct AiEditAuthState {
    level: AiEditAuthLevel,
    task_id: Option<String>,
    updated_at: String,
}

impl Default for AiEditAuthState {
    fn default() -> Self {
        Self {
            level: AiEditAuthLevel::Manual,
            task_id: None,
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug)]
pub struct AiEditState {
    auth: Mutex<AiEditAuthState>,
    snapshot_markers: Mutex<HashSet<String>>,
    timeline: Mutex<Vec<AiEditTimelineEntryPayload>>,
}

impl Default for AiEditState {
    fn default() -> Self {
        Self {
            auth: Mutex::new(AiEditAuthState::default()),
            snapshot_markers: Mutex::new(HashSet::new()),
            timeline: Mutex::new(Vec::new()),
        }
    }
}

pub fn get_auth_level(state: &AiEditState) -> Result<AiEditAuthStatePayload, String> {
    let guard = state.auth.lock().map_err(|_| errors::state_poisoned())?;
    Ok(build_auth_payload(&guard))
}

pub fn set_auth_level(
    payload: AiEditSetAuthLevelRequest,
    state: &AiEditState,
) -> Result<AiEditAuthStatePayload, String> {
    let next_level = AiEditAuthLevel::parse(&payload.level)?;
    let mut guard = state.auth.lock().map_err(|_| errors::state_poisoned())?;
    let previous_level = guard.level.as_str().to_string();

    guard.level = next_level;
    guard.task_id = match next_level {
        AiEditAuthLevel::PerTask => payload.task_id.and_then(normalize_optional_string),
        AiEditAuthLevel::Manual | AiEditAuthLevel::Session => None,
    };
    guard.updated_at = Utc::now().to_rfc3339();

    let current = build_auth_payload(&guard);
    tracing::info!(
        target: "ai.audit",
        event = "ai.edit.auth_changed",
        from_level = previous_level,
        to_level = current.level.as_str(),
        task_id = current.task_id.as_deref().unwrap_or(""),
        "AI edit auth level changed"
    );
    audit::emit(AiAuditEventKind::AiEditAuthChanged);
    Ok(current)
}

pub fn ensure_patch_authorized(
    state: &AiEditState,
    metadata: Option<&AiApplyPatchMetadataRequest>,
) -> Result<(), String> {
    ensure_auto_apply_authorized(state, metadata, "Patch 自动应用")
}

pub(crate) fn ensure_auto_apply_authorized(
    state: &AiEditState,
    metadata: Option<&AiApplyPatchMetadataRequest>,
    action: &str,
) -> Result<(), String> {
    if metadata
        .and_then(|value| value.confirmed_by_user)
        .unwrap_or(false)
    {
        return Ok(());
    }

    ensure_write_authorized(
        state,
        action,
        metadata.and_then(|value| normalize_optional_str(value.task_id.as_deref())),
    )
}

pub(crate) fn mark_snapshot_scope(state: &AiEditState, key: impl Into<String>) -> Result<bool, String> {
    let mut guard = state
        .snapshot_markers
        .lock()
        .map_err(|_| errors::state_poisoned())?;
    Ok(guard.insert(key.into()))
}

pub fn list_timeline_with_state(
    payload: AiEditListTimelineRequest,
    state: &AiEditState,
    stored_snapshots: Vec<AiSnapshotPayload>,
    stored_operations: Vec<AiEditOperationPayload>,
) -> Result<AiEditListTimelinePayload, String> {
    let entries = {
        let guard = state.timeline.lock().map_err(|_| errors::state_poisoned())?;
        let known_snapshot_ids = guard
            .iter()
            .filter_map(|entry| match entry {
                AiEditTimelineEntryPayload::Snapshot(snapshot) => Some(snapshot.id.clone()),
                AiEditTimelineEntryPayload::Operation(_) => None,
            })
            .collect::<HashSet<_>>();
        let known_operation_ids = guard
            .iter()
            .filter_map(|entry| match entry {
                AiEditTimelineEntryPayload::Snapshot(_) => None,
                AiEditTimelineEntryPayload::Operation(operation) => Some(operation.id.clone()),
            })
            .collect::<HashSet<_>>();

        let mut merged_entries = stored_snapshots
            .into_iter()
            .filter(|snapshot| !known_snapshot_ids.contains(&snapshot.id))
            .map(AiEditTimelineEntryPayload::Snapshot)
            .collect::<Vec<_>>();
        merged_entries.extend(
            stored_operations
                .into_iter()
                .filter(|operation| !known_operation_ids.contains(&operation.id))
                .map(AiEditTimelineEntryPayload::Operation),
        );
        merged_entries.extend(guard.iter().cloned());
        timeline::list_entries(payload, &merged_entries)
    };
    Ok(AiEditListTimelinePayload { entries })
}

pub fn append_operations(
    state: &AiEditState,
    storage_root: &Path,
    operations: &[AiEditOperationPayload],
) -> Result<(), String> {
    edit_journal::append_operations(storage_root, operations)?;
    let mut guard = state.timeline.lock().map_err(|_| errors::state_poisoned())?;
    guard.extend(
        operations
            .iter()
            .cloned()
            .map(AiEditTimelineEntryPayload::Operation),
    );
    Ok(())
}

pub fn append_snapshot(state: &AiEditState, snapshot: AiSnapshotPayload) -> Result<(), String> {
    let mut guard = state.timeline.lock().map_err(|_| errors::state_poisoned())?;
    guard.push(AiEditTimelineEntryPayload::Snapshot(snapshot));
    Ok(())
}

pub fn restore_snapshot(
    payload: AiEditRestoreSnapshotRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditRestoreSnapshotPayload, String> {
    revert::restore_snapshot(payload, storage_root, state)
}

pub fn undo_operation(
    payload: AiEditUndoOperationRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditUndoOperationPayload, String> {
    revert::undo_operation(payload, storage_root, state)
}

pub fn revert_task(
    payload: AiEditRevertTaskRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditRevertTaskPayload, String> {
    revert::revert_task(payload, storage_root, state)
}

fn build_auth_payload(value: &AiEditAuthState) -> AiEditAuthStatePayload {
    AiEditAuthStatePayload {
        level: value.level.as_str().to_string(),
        task_id: value.task_id.clone(),
        updated_at: value.updated_at.clone(),
    }
}

fn ensure_write_authorized(
    state: &AiEditState,
    action: &str,
    request_task_id: Option<&str>,
) -> Result<(), String> {
    let guard = state.auth.lock().map_err(|_| errors::state_poisoned())?;
    let configured_task_id = normalize_optional_str(guard.task_id.as_deref());

    match guard.level {
        AiEditAuthLevel::Manual => Err(errors::auth_blocked(format!(
            "当前处于手动审批模式，{action} 需要用户显式确认。"
        ))),
        AiEditAuthLevel::Session => Ok(()),
        AiEditAuthLevel::PerTask => match (configured_task_id, request_task_id) {
            (None, _) => Err(errors::auth_blocked(format!(
                "当前处于任务内自动应用模式，但尚未绑定 taskId，无法执行 {action}。"
            ))),
            (Some(expected_task_id), None) => Err(errors::auth_blocked(format!(
                "当前仅允许任务 {expected_task_id} 自动写盘，本次 {action} 缺少 taskId。"
            ))),
            (Some(expected_task_id), Some(actual_task_id)) if expected_task_id == actual_task_id => {
                Ok(())
            }
            (Some(expected_task_id), Some(actual_task_id)) => Err(errors::auth_blocked(
                format!(
                    "当前仅允许任务 {expected_task_id} 自动写盘，本次 {action} 属于任务 {actual_task_id}。"
                ),
            )),
        },
    }
}

fn normalize_optional_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_optional_str<'a>(value: Option<&'a str>) -> Option<&'a str> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{ensure_patch_authorized, errors, set_auth_level, AiEditState};
    use crate::commands::contracts::{AiApplyPatchMetadataRequest, AiEditSetAuthLevelRequest};

    #[test]
    fn ensure_patch_authorized_rejects_manual_mode() {
        let state = AiEditState::default();
        let error = ensure_patch_authorized(
            &state,
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: None,
                reason: None,
                tool_call_id: None,
                confirmed_by_user: None,
            }),
        )
        .expect_err("manual mode should block patch apply");

        assert!(error.contains(errors::AI_EDIT_AUTH_BLOCKED));
    }

    #[test]
    fn ensure_patch_authorized_accepts_matching_per_task_mode() {
        let state = AiEditState::default();
        set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "per_task".to_string(),
                task_id: Some("task-1".to_string()),
            },
            &state,
        )
        .expect("per_task auth should be set");

        ensure_patch_authorized(
            &state,
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: None,
                reason: None,
                tool_call_id: None,
                confirmed_by_user: None,
            }),
        )
        .expect("matching task id should pass");
    }

    #[test]
    fn ensure_patch_authorized_rejects_mismatched_per_task_mode() {
        let state = AiEditState::default();
        set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "per_task".to_string(),
                task_id: Some("task-1".to_string()),
            },
            &state,
        )
        .expect("per_task auth should be set");

        let error = ensure_patch_authorized(
            &state,
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-2".to_string()),
                turn_id: None,
                reason: None,
                tool_call_id: None,
                confirmed_by_user: None,
            }),
        )
        .expect_err("mismatched task id should be rejected");

        assert!(error.contains(errors::AI_EDIT_AUTH_BLOCKED));
    }

    #[test]
    fn ensure_patch_authorized_accepts_user_confirmed_manual_mode() {
        let state = AiEditState::default();

        ensure_patch_authorized(
            &state,
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: None,
                reason: None,
                tool_call_id: None,
                confirmed_by_user: Some(true),
            }),
        )
        .expect("user confirmed patch should bypass auto-apply gate");
    }
}
