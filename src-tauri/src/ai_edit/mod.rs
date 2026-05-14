pub mod atomic_write;
pub mod auto_apply;
pub mod diff_render;
pub mod edit_journal;
pub mod errors;
pub mod file_transaction;
pub mod path_security;
pub mod protected_paths;
pub mod revert;
pub mod snapshot;
pub mod storage_lock;
pub mod timeline;

use crate::ai::audit::{self, AiAuditEventKind};
use crate::commands::contracts::{
    AiApplyPatchMetadataRequest, AiEditAuthStatePayload, AiEditCreateSnapshotPayload,
    AiEditCreateSnapshotRequest, AiEditGetDiffPayload, AiEditGetDiffRequest,
    AiEditListTimelinePayload, AiEditListTimelineRequest, AiEditOperationPayload,
    AiEditRestoreSnapshotPayload, AiEditRestoreSnapshotRequest, AiEditRevertFilePayload,
    AiEditRevertFileRequest, AiEditRevertHunkPayload, AiEditRevertHunkRequest,
    AiEditRevertTaskPayload, AiEditRevertTaskRequest, AiEditSetAuthLevelRequest,
    AiEditTimelineEntryPayload, AiEditUndoOperationPayload, AiEditUndoOperationRequest,
    AiSnapshotPayload,
};
use chrono::Utc;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

const RETAINED_OPERATION_LIMIT: usize = 256;
const RETAINED_SNAPSHOT_LIMIT: usize = 192;

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

#[derive(Debug, Default)]
struct AiEditRetentionOutcome {
    pruned_operation_ids: HashSet<String>,
    pruned_snapshot_ids: HashSet<String>,
    pruned_operation_count: usize,
    pruned_snapshot_count: usize,
    pruned_blob_count: usize,
    reclaimed_bytes: u64,
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

pub(crate) fn mark_snapshot_scope(
    state: &AiEditState,
    key: impl Into<String>,
) -> Result<bool, String> {
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
        let guard = state
            .timeline
            .lock()
            .map_err(|_| errors::state_poisoned())?;
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

pub fn recover_pending_file_transactions(storage_root: &Path) -> Result<(), String> {
    file_transaction::recover_pending(storage_root)
}

pub fn append_snapshot(
    state: &AiEditState,
    storage_root: &Path,
    snapshot: AiSnapshotPayload,
) -> Result<(), String> {
    {
        let mut guard = state
            .timeline
            .lock()
            .map_err(|_| errors::state_poisoned())?;
        guard.push(AiEditTimelineEntryPayload::Snapshot(snapshot));
    }
    run_retention_policy_best_effort(state, storage_root);
    Ok(())
}

pub(crate) fn run_retention_policy_best_effort(state: &AiEditState, storage_root: &Path) {
    if let Err(error) = apply_retention_policy(state, storage_root) {
        tracing::warn!(
            target: "ai.edit",
            error = %error,
            retained_operation_limit = RETAINED_OPERATION_LIMIT,
            retained_snapshot_limit = RETAINED_SNAPSHOT_LIMIT,
            "skip AED retention prune because pruning failed"
        );
    }
}

fn apply_retention_policy(state: &AiEditState, storage_root: &Path) -> Result<(), String> {
    let Some(outcome) = apply_retention_policy_with_limits(
        state,
        storage_root,
        RETAINED_SNAPSHOT_LIMIT,
        RETAINED_OPERATION_LIMIT,
    )?
    else {
        return Ok(());
    };

    tracing::info!(
        target: "ai.audit",
        event = "ai.edit.pruned",
        pruned_operation_count = outcome.pruned_operation_count,
        pruned_snapshot_count = outcome.pruned_snapshot_count,
        pruned_blob_count = outcome.pruned_blob_count,
        reclaimed_bytes = outcome.reclaimed_bytes,
        retained_operation_limit = RETAINED_OPERATION_LIMIT,
        retained_snapshot_limit = RETAINED_SNAPSHOT_LIMIT,
        "AI edit retention pruned stale local history"
    );
    audit::emit(AiAuditEventKind::AiEditPruned);

    Ok(())
}

fn apply_retention_policy_with_limits(
    state: &AiEditState,
    storage_root: &Path,
    snapshot_limit: usize,
    operation_limit: usize,
) -> Result<Option<AiEditRetentionOutcome>, String> {
    let stored_operations = edit_journal::list_operations(storage_root)?;
    let retained_operations = if operation_limit == 0 {
        Vec::new()
    } else {
        stored_operations
            .iter()
            .rev()
            .take(operation_limit)
            .cloned()
            .collect::<Vec<_>>()
    };
    let retained_operation_ids = retained_operations
        .iter()
        .map(|operation| operation.id.clone())
        .collect::<HashSet<_>>();
    let referenced_snapshot_ids = retained_operations
        .iter()
        .filter_map(|operation| operation.source_snapshot_id.clone())
        .collect::<HashSet<_>>();

    let mut stored_snapshots = snapshot::list_stored_snapshots(storage_root)?;
    stored_snapshots.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut retained_snapshot_ids = if snapshot_limit == 0 {
        HashSet::new()
    } else {
        stored_snapshots
            .iter()
            .rev()
            .take(snapshot_limit)
            .map(|snapshot| snapshot.id.clone())
            .collect::<HashSet<_>>()
    };
    retained_snapshot_ids.extend(referenced_snapshot_ids);

    let journal_outcome = edit_journal::prune_operations(storage_root, &retained_operation_ids)?;
    let snapshot_outcome = snapshot::prune_stored_snapshots(storage_root, &retained_snapshot_ids)?;

    if journal_outcome.removed_operation_ids.is_empty()
        && snapshot_outcome.removed_snapshot_ids.is_empty()
    {
        return Ok(None);
    }

    {
        let mut guard = state
            .timeline
            .lock()
            .map_err(|_| errors::state_poisoned())?;
        guard.retain(|entry| match entry {
            AiEditTimelineEntryPayload::Snapshot(snapshot) => {
                !snapshot_outcome.removed_snapshot_ids.contains(&snapshot.id)
            }
            AiEditTimelineEntryPayload::Operation(operation) => !journal_outcome
                .removed_operation_ids
                .contains(&operation.id),
        });
    }

    Ok(Some(AiEditRetentionOutcome {
        pruned_operation_count: journal_outcome.removed_operation_ids.len(),
        pruned_snapshot_count: snapshot_outcome.removed_snapshot_ids.len(),
        pruned_blob_count: snapshot_outcome.removed_blob_count,
        reclaimed_bytes: journal_outcome.reclaimed_bytes + snapshot_outcome.reclaimed_bytes,
        pruned_operation_ids: journal_outcome.removed_operation_ids,
        pruned_snapshot_ids: snapshot_outcome.removed_snapshot_ids,
    }))
}

pub fn restore_snapshot(
    payload: AiEditRestoreSnapshotRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditRestoreSnapshotPayload, String> {
    revert::restore_snapshot(payload, storage_root, state)
}

pub fn create_snapshot(
    payload: AiEditCreateSnapshotRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditCreateSnapshotPayload, String> {
    let task_id = payload
        .task_id
        .and_then(normalize_optional_string)
        .unwrap_or_else(|| "manual-preview".to_string());
    let label = payload
        .label
        .and_then(normalize_optional_string)
        .unwrap_or_else(|| "Pin checkpoint".to_string());
    let mut deduped = HashSet::new();
    let file_refs = payload
        .file_refs
        .into_iter()
        .filter_map(normalize_optional_string)
        .filter(|value| deduped.insert(value.clone()))
        .collect::<Vec<_>>();

    if file_refs.is_empty() {
        return Err(errors::snapshot_store_failed("手动快照至少需要一个文件。"));
    }

    let mut file_buffers = Vec::with_capacity(file_refs.len());
    for file_ref in &file_refs {
        let path = path_security::validate_ai_writable_path(file_ref)
            .map_err(errors::snapshot_store_failed)?;
        path_security::reject_existing_symlink(&path).map_err(errors::snapshot_store_failed)?;
        if !path.is_file() {
            return Err(errors::snapshot_store_failed(format!(
                "手动快照文件不存在：{file_ref}"
            )));
        }

        let content = fs::read_to_string(&path).map_err(|error| {
            errors::snapshot_store_failed(format!("读取手动快照文件失败（{file_ref}）：{error}"))
        })?;
        let content_hash = crate::ai_patch::hash_text(&content);
        file_buffers.push((file_ref.clone(), content_hash, content));
    }

    let snapshot_sources = file_buffers
        .iter()
        .map(|file| snapshot::SnapshotSourceFile {
            path: file.0.as_str(),
            content_hash: file.1.as_str(),
            content: file.2.as_str(),
        })
        .collect::<Vec<_>>();
    let metadata = AiApplyPatchMetadataRequest {
        task_id: Some(task_id),
        turn_id: None,
        reason: Some(label.clone()),
        tool_call_id: None,
        confirmed_by_user: Some(true),
        agent_run_id: None,
        agent_step_id: None,
        workspace_root_path: None,
    };
    let snapshot =
        snapshot::store_manual_snapshot(storage_root, &snapshot_sources, Some(&metadata), &label)?;

    append_snapshot(state, storage_root, snapshot.clone())?;

    tracing::info!(
        target: "ai.audit",
        event = "ai.edit.checkpoint_created",
        snapshot_id = snapshot.id.as_str(),
        task_id = snapshot.task_id.as_str(),
        file_count = snapshot.file_refs.len(),
        label = snapshot.label.as_str(),
        "AI edit checkpoint created"
    );
    audit::emit(AiAuditEventKind::AiEditCheckpointCreated);

    Ok(AiEditCreateSnapshotPayload { snapshot })
}

pub fn get_diff(
    payload: AiEditGetDiffRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditGetDiffPayload, String> {
    revert::get_diff(payload, storage_root, state)
}

pub fn undo_operation(
    payload: AiEditUndoOperationRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditUndoOperationPayload, String> {
    revert::undo_operation(payload, storage_root, state)
}

pub fn revert_file(
    payload: AiEditRevertFileRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditRevertFilePayload, String> {
    revert::revert_file(payload, storage_root, state)
}

pub fn revert_hunk(
    payload: AiEditRevertHunkRequest,
    storage_root: &Path,
    state: &AiEditState,
) -> Result<AiEditRevertHunkPayload, String> {
    revert::revert_hunk(payload, storage_root, state)
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
    use super::{
        apply_retention_policy_with_limits, create_snapshot, ensure_patch_authorized, errors,
        set_auth_level, AiEditState,
    };
    use crate::ai_edit::snapshot;
    use crate::commands::contracts::AiEditTimelineEntryPayload;
    use crate::commands::contracts::{
        AiApplyPatchMetadataRequest, AiEditCreateSnapshotRequest, AiEditSetAuthLevelRequest,
    };
    use std::fs;

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
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
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
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
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
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
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
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
            }),
        )
        .expect("user confirmed patch should bypass auto-apply gate");
    }

    #[test]
    fn create_snapshot_writes_manual_snapshot_for_current_files() {
        let storage_root = std::env::temp_dir().join(format!(
            "aed-create-snapshot-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        let workspace_root = storage_root.join("workspace");
        fs::create_dir_all(&workspace_root).expect("workspace directory should be created");

        let file_path = workspace_root.join("src").join("main.ts");
        fs::create_dir_all(file_path.parent().expect("parent should exist"))
            .expect("file parent should be created");
        fs::write(&file_path, "console.log('hello');\n")
            .expect("snapshot source file should exist");

        let state = AiEditState::default();
        let payload = create_snapshot(
            AiEditCreateSnapshotRequest {
                file_refs: vec![file_path.to_string_lossy().to_string()],
                label: Some("Pin checkpoint".to_string()),
                task_id: Some("task-1".to_string()),
            },
            &storage_root,
            &state,
        )
        .expect("manual snapshot should be created");

        assert_eq!(payload.snapshot.scope, "manual");
        assert_eq!(payload.snapshot.task_id, "task-1");
        assert_eq!(payload.snapshot.file_refs.len(), 1);

        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn retention_prunes_snapshot_history_and_syncs_timeline_state() {
        let storage_root = std::env::temp_dir().join(format!(
            "aed-retention-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        fs::create_dir_all(&storage_root).expect("storage root should be created");
        let state = AiEditState::default();

        for index in 0..3 {
            let path = format!("src/file-{index}.sh");
            let content_hash = format!("blake3:{index}");
            let content = format!("echo {index}");
            let label = format!("snapshot-{index}");
            let snapshot_payload = snapshot::store_manual_snapshot(
                &storage_root,
                &[snapshot::SnapshotSourceFile {
                    path: path.as_str(),
                    content_hash: content_hash.as_str(),
                    content: content.as_str(),
                }],
                None,
                label.as_str(),
            )
            .expect("snapshot should be written");
            super::append_snapshot(&state, &storage_root, snapshot_payload)
                .expect("snapshot should be appended");
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        let outcome = apply_retention_policy_with_limits(&state, &storage_root, 2, 0)
            .expect("retention should succeed")
            .expect("retention should prune stale snapshots");
        let stored_snapshots =
            snapshot::list_stored_snapshots(&storage_root).expect("snapshots should be listed");
        let guard = state.timeline.lock().expect("timeline lock should succeed");
        let timeline_snapshot_ids = guard
            .iter()
            .filter_map(|entry| match entry {
                AiEditTimelineEntryPayload::Snapshot(snapshot) => Some(snapshot.id.clone()),
                AiEditTimelineEntryPayload::Operation(_) => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(outcome.pruned_snapshot_count, 1);
        assert_eq!(stored_snapshots.len(), 2);
        assert_eq!(timeline_snapshot_ids.len(), 2);
        assert_eq!(outcome.pruned_operation_ids.len(), 0);
        assert_eq!(outcome.pruned_snapshot_ids.len(), 1);

        let _ = fs::remove_dir_all(&storage_root);
    }
}
