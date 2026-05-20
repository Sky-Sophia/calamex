use crate::ai::errors;
use crate::ai_edit::file_transaction::{self, FileTransactionAction, FileTransactionPlan};
use crate::ai_edit::path_security;
use crate::ai_edit::snapshot::{self, SnapshotSourceFile};
use crate::ai_edit::{self, AiEditState};
use crate::ai_edit::diff_render;
use crate::ai_patch::{hash_text, read_text_file_baseline};
use crate::commands::contracts::{
    AiApplyPatchMetadataRequest, AiEditOperationPayload, AiEditTimelineEntryPayload,
};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 集中维护错误码字面量，避免散落的字符串拼写漂移。
mod error_codes {
    pub const WRITE_INVALID: &str = "AI_EDIT_WRITE_INVALID";
    pub const WRITE_CONFLICT: &str = "AI_EDIT_WRITE_CONFLICT";
    pub const WRITE_FAILED: &str = "AI_EDIT_WRITE_FAILED";
}

/// 自动写盘支持的四种操作类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiAutoApplyOperationKind {
    Create,
    Modify,
    Delete,
    Rename,
}

impl AiAutoApplyOperationKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Modify => "modify",
            Self::Delete => "delete",
            Self::Rename => "rename",
        }
    }
}

/// 单条自动写盘计划。
///
/// 字段按操作类型不同有不同必填要求，由 `validate_operation_plans` 统一前置校验。
#[derive(Debug, Clone)]
pub struct AiAutoApplyOperationPlan {
    pub kind: AiAutoApplyOperationKind,
    pub path: String,
    pub new_path: Option<String>,
    pub original_hash: Option<String>,
    pub original_modified_at: Option<SystemTime>,
    pub original_content: Option<String>,
    pub updated_content: Option<String>,
}

/// 单条操作执行成功后的反馈。
#[derive(Debug, Clone)]
pub struct AiAutoApplyFileResult {
    pub path: String,
    pub byte_size: u64,
}

pub fn apply_operation_plans(
    plans: &[AiAutoApplyOperationPlan],
    metadata: Option<&AiApplyPatchMetadataRequest>,
    summary: &str,
    state: &AiEditState,
    storage_root: &Path,
) -> Result<Vec<AiAutoApplyFileResult>, String> {
    if plans.is_empty() {
        return Err(errors::error(
            error_codes::WRITE_INVALID,
            "AI 写计划不能为空。",
        ));
    }

    ai_edit::ensure_auto_apply_authorized(state, metadata, "AI 自动写盘")?;
    ai_edit::recover_pending_file_transactions(storage_root)?;
    let workspace_root = metadata.and_then(|value| value.workspace_root_path.as_deref());
    validate_operation_plans(plans, workspace_root)?;
    validate_operation_conflicts(plans, workspace_root)?;

    let source_snapshot_id =
        capture_checkpoint_snapshots(plans, metadata, summary, state, storage_root)?;

    let operation_payloads = plans
        .iter()
        .enumerate()
        .map(|(index, plan)| {
            build_operation_payload(
                index,
                plan,
                source_snapshot_id.as_deref(),
                metadata,
                summary,
            )
        })
        .collect::<Vec<_>>();
    let results = plans
        .iter()
        .map(build_file_result)
        .collect::<Result<Vec<_>, String>>()?;
    let transaction_plan =
        build_file_transaction_plan(plans, operation_payloads.clone(), workspace_root)?;
    validate_operation_conflicts(plans, workspace_root)?;
    file_transaction::commit(storage_root, transaction_plan)?;
    record_committed_operations(state, &operation_payloads)?;
    ai_edit::run_retention_policy_best_effort(state, storage_root);

    Ok(results)
}

fn validate_operation_plans(
    plans: &[AiAutoApplyOperationPlan],
    workspace_root: Option<&str>,
) -> Result<(), String> {
    for plan in plans {
        if plan.path.trim().is_empty() {
            return Err(errors::error(
                error_codes::WRITE_INVALID,
                "AI 写入路径不能为空。",
            ));
        }

        validate_non_protected_path(&plan.path, workspace_root)?;

        match plan.kind {
            AiAutoApplyOperationKind::Create => {
                if plan.updated_content.is_none() {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "create 操作缺少目标内容。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Modify => {
                validate_original_fields(plan, "modify 操作缺少前后内容。")?;

                if plan.updated_content.is_none() {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "modify 操作缺少目标内容。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Delete => {
                validate_original_fields(plan, "delete 操作缺少原始内容。")?;
            }
            AiAutoApplyOperationKind::Rename => {
                validate_original_fields(plan, "rename 操作缺少源内容。")?;

                let target = plan
                    .new_path
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        errors::error(error_codes::WRITE_INVALID, "rename 操作缺少目标路径。")
                    })?;

                validate_non_protected_path(target, workspace_root)?;

                if normalize_path_for_compare(&plan.path) == normalize_path_for_compare(target) {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "rename 源路径与目标路径不能相同。",
                    ));
                }
            }
        }

        validate_declared_original_hash(plan)?;
    }

    Ok(())
}

fn validate_original_fields(plan: &AiAutoApplyOperationPlan, message: &str) -> Result<(), String> {
    if plan.original_hash.is_none() || plan.original_content.is_none() {
        return Err(errors::error(error_codes::WRITE_INVALID, message));
    }

    Ok(())
}

fn validate_declared_original_hash(plan: &AiAutoApplyOperationPlan) -> Result<(), String> {
    let Some(original_content) = plan.original_content.as_deref() else {
        return Ok(());
    };

    let Some(original_hash) = plan.original_hash.as_deref() else {
        return Ok(());
    };

    let actual_hash = hash_text(original_content);

    if actual_hash != original_hash {
        return Err(errors::error(
            error_codes::WRITE_INVALID,
            "AI 写计划中的 original_hash 与 original_content 不匹配。",
        ));
    }

    Ok(())
}

/// 写前统一做磁盘冲突检测。
///
/// 这一步非常关键：
/// - modify/delete/rename 必须确认磁盘当前内容仍等于计划生成时的 original_hash。
/// - create 必须确认目标路径不存在。
/// - rename 还必须确认目标路径不存在。
fn validate_operation_conflicts(
    plans: &[AiAutoApplyOperationPlan],
    workspace_root: Option<&str>,
) -> Result<(), String> {
    for plan in plans {
        match plan.kind {
            AiAutoApplyOperationKind::Create => {
                let path = validate_non_protected_path(&plan.path, workspace_root)?;

                if path.exists() {
                    return Err(errors::error(
                        error_codes::WRITE_CONFLICT,
                        "create 目标已存在。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Modify => {
                let path = validate_existing_file_for_original_hash(
                    plan,
                    workspace_root,
                    "modify 目标文件不存在。",
                )?;

                if !path.is_file() {
                    return Err(errors::error(
                        error_codes::WRITE_CONFLICT,
                        "modify 目标不是普通文件。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Delete => {
                let path = validate_existing_file_for_original_hash(
                    plan,
                    workspace_root,
                    "delete 目标文件不存在。",
                )?;

                if !path.is_file() {
                    return Err(errors::error(
                        error_codes::WRITE_CONFLICT,
                        "delete 目标不是普通文件。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Rename => {
                let source_path = validate_existing_file_for_original_hash(
                    plan,
                    workspace_root,
                    "rename 源文件不存在。",
                )?;

                if !source_path.is_file() {
                    return Err(errors::error(
                        error_codes::WRITE_CONFLICT,
                        "rename 源路径不是普通文件。",
                    ));
                }

                let target_raw_path = plan
                    .new_path
                    .as_deref()
                    .expect("validated rename operation should have target path");

                let target_path = validate_non_protected_path(target_raw_path, workspace_root)?;

                if target_path.exists() {
                    return Err(errors::error(
                        error_codes::WRITE_CONFLICT,
                        "rename 目标文件已存在。",
                    ));
                }
            }
        }
    }

    Ok(())
}

fn validate_existing_file_for_original_hash(
    plan: &AiAutoApplyOperationPlan,
    workspace_root: Option<&str>,
    missing_message: &str,
) -> Result<PathBuf, String> {
    let path = validate_non_protected_path(&plan.path, workspace_root)?;

    if !path.exists() {
        return Err(errors::error(error_codes::WRITE_CONFLICT, missing_message));
    }

    let baseline = read_text_file_baseline(&path).map_err(|error| {
        errors::error(
            error_codes::WRITE_FAILED,
            format!("读取当前文件失败：{error}"),
        )
    })?;

    let expected_hash = plan
        .original_hash
        .as_deref()
        .expect("validated operation should have original hash");

    if baseline.content_hash != expected_hash
        || plan
            .original_modified_at
            .is_some_and(|expected| baseline.modified_at != expected)
    {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "目标文件已发生变化，为避免覆盖用户修改，AI 写入已取消。",
        ));
    }

    Ok(path)
}

fn capture_checkpoint_snapshots(
    plans: &[AiAutoApplyOperationPlan],
    metadata: Option<&AiApplyPatchMetadataRequest>,
    summary: &str,
    state: &AiEditState,
    storage_root: &Path,
) -> Result<Option<String>, String> {
    let snapshot_sources = build_snapshot_sources(plans);
    let task_id = resolve_task_id(metadata);

    if ai_edit::mark_snapshot_scope(state, format!("task-start:{task_id}"))? {
        let snapshot = snapshot::store_task_start_snapshot(
            storage_root,
            &snapshot_sources,
            metadata,
            summary,
        )?;
        ai_edit::append_snapshot(state, storage_root, snapshot)?;
    }

    if let Some(turn_id) = resolve_turn_id(metadata) {
        if ai_edit::mark_snapshot_scope(state, format!("turn-start:{turn_id}"))? {
            let snapshot = snapshot::store_turn_start_snapshot(
                storage_root,
                &snapshot_sources,
                metadata,
                summary,
            )?;
            ai_edit::append_snapshot(state, storage_root, snapshot)?;
        }
    }

    let confirmed_by_user = metadata
        .and_then(|value| value.confirmed_by_user)
        .unwrap_or(false);

    let source_snapshot = if confirmed_by_user {
        snapshot::store_manual_snapshot(storage_root, &snapshot_sources, metadata, summary)?
    } else {
        snapshot::store_pre_tool_snapshot(storage_root, &snapshot_sources, metadata, summary)?
    };

    let source_snapshot_id = source_snapshot.id.clone();
    ai_edit::append_snapshot(state, storage_root, source_snapshot)?;

    Ok(Some(source_snapshot_id))
}

fn build_snapshot_sources(plans: &[AiAutoApplyOperationPlan]) -> Vec<SnapshotSourceFile<'_>> {
    plans
        .iter()
        .filter_map(|plan| match plan.kind {
            AiAutoApplyOperationKind::Create => None,
            AiAutoApplyOperationKind::Modify
            | AiAutoApplyOperationKind::Delete
            | AiAutoApplyOperationKind::Rename => Some(SnapshotSourceFile {
                path: plan.path.as_str(),
                content_hash: plan
                    .original_hash
                    .as_deref()
                    .expect("validated operation should have original hash"),
                content: plan
                    .original_content
                    .as_deref()
                    .expect("validated operation should have original content"),
            }),
        })
        .collect()
}

fn build_file_transaction_plan(
    plans: &[AiAutoApplyOperationPlan],
    operations: Vec<AiEditOperationPayload>,
    workspace_root: Option<&str>,
) -> Result<FileTransactionPlan, String> {
    let actions = plans
        .iter()
        .map(|plan| build_file_transaction_action(plan, workspace_root))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(FileTransactionPlan {
        actions,
        operations,
    })
}

fn build_file_transaction_action(
    plan: &AiAutoApplyOperationPlan,
    workspace_root: Option<&str>,
) -> Result<FileTransactionAction, String> {
    match plan.kind {
        AiAutoApplyOperationKind::Create => Ok(FileTransactionAction::Create {
            path: validate_non_protected_path(&plan.path, workspace_root)?,
            content: plan
                .updated_content
                .clone()
                .expect("validated create operation should have updated content"),
        }),
        AiAutoApplyOperationKind::Modify => Ok(FileTransactionAction::Modify {
            path: validate_non_protected_path(&plan.path, workspace_root)?,
            content: plan
                .updated_content
                .clone()
                .expect("validated modify operation should have updated content"),
        }),
        AiAutoApplyOperationKind::Delete => Ok(FileTransactionAction::Delete {
            path: validate_non_protected_path(&plan.path, workspace_root)?,
        }),
        AiAutoApplyOperationKind::Rename => Ok(FileTransactionAction::Rename {
            from: validate_non_protected_path(&plan.path, workspace_root)?,
            to: validate_non_protected_path(
                plan.new_path
                    .as_deref()
                    .expect("validated rename operation should have target path"),
                workspace_root,
            )?,
        }),
    }
}

fn build_file_result(plan: &AiAutoApplyOperationPlan) -> Result<AiAutoApplyFileResult, String> {
    let (path, byte_size) = match plan.kind {
        AiAutoApplyOperationKind::Create | AiAutoApplyOperationKind::Modify => (
            plan.path.clone(),
            plan.updated_content
                .as_deref()
                .expect("validated write operation should have updated content")
                .len() as u64,
        ),
        AiAutoApplyOperationKind::Delete => (plan.path.clone(), 0),
        AiAutoApplyOperationKind::Rename => (
            plan.new_path
                .clone()
                .expect("validated rename operation should have target path"),
            plan.original_content
                .as_deref()
                .map(|value| value.len() as u64)
                .unwrap_or(0),
        ),
    };

    Ok(AiAutoApplyFileResult { path, byte_size })
}

fn record_committed_operations(
    state: &AiEditState,
    operations: &[AiEditOperationPayload],
) -> Result<(), String> {
    let mut guard = state
        .timeline
        .lock()
        .map_err(|_| ai_edit::errors::state_poisoned())?;
    guard.extend(
        operations
            .iter()
            .cloned()
            .map(AiEditTimelineEntryPayload::Operation),
    );
    Ok(())
}

fn build_operation_payload(
    index: usize,
    plan: &AiAutoApplyOperationPlan,
    source_snapshot_id: Option<&str>,
    metadata: Option<&AiApplyPatchMetadataRequest>,
    summary: &str,
) -> AiEditOperationPayload {
    let timestamp = Utc::now();
    let task_id = resolve_task_id(metadata);
    let turn_id = resolve_turn_id(metadata).unwrap_or_else(|| task_id.clone());
    let reason = resolve_reason(metadata, summary);
    let updated_hash = plan.updated_content.as_deref().map(hash_text);

    let original_bytes = plan
        .original_content
        .as_deref()
        .map(|value| value.len() as u64);

    let updated_bytes = plan
        .updated_content
        .as_deref()
        .map(|value| value.len() as u64);

    let (before_hash, after_hash, bytes_before, bytes_after) = match plan.kind {
        AiAutoApplyOperationKind::Create => (None, updated_hash, None, updated_bytes),
        AiAutoApplyOperationKind::Modify => (
            plan.original_hash.clone(),
            updated_hash,
            original_bytes,
            updated_bytes,
        ),
        AiAutoApplyOperationKind::Delete => {
            (plan.original_hash.clone(), None, original_bytes, None)
        }
        AiAutoApplyOperationKind::Rename => (
            plan.original_hash.clone(),
            plan.original_hash.clone(),
            original_bytes,
            original_bytes,
        ),
    };
    let diff_text = build_operation_diff_text(plan);

    AiEditOperationPayload {
        id: format!("ai-edit-op-{}-{index}", timestamp.timestamp_millis()),
        task_id,
        turn_id,
        kind: plan.kind.as_str().to_string(),
        path: plan.path.clone(),
        new_path: plan.new_path.clone(),
        source_snapshot_id: source_snapshot_id.map(str::to_string),
        before_hash,
        after_hash,
        bytes_before,
        bytes_after,
        applied_at: timestamp.to_rfc3339(),
        reason,
        tool_call_id: metadata.and_then(|value| value.tool_call_id.clone()),
        diff_text,
        pinned: false,
    }
}

fn build_operation_diff_text(plan: &AiAutoApplyOperationPlan) -> Option<String> {
    let after_path = plan.new_path.as_deref().unwrap_or(&plan.path);
    let (before, after) = match plan.kind {
        AiAutoApplyOperationKind::Create => ("", plan.updated_content.as_deref()?),
        AiAutoApplyOperationKind::Modify => (
            plan.original_content.as_deref()?,
            plan.updated_content.as_deref()?,
        ),
        AiAutoApplyOperationKind::Delete => (plan.original_content.as_deref()?, ""),
        AiAutoApplyOperationKind::Rename => (
            plan.original_content.as_deref()?,
            plan.original_content.as_deref()?,
        ),
    };

    Some(diff_render::render_unified_diff_text(
        &plan.path,
        after_path,
        before,
        after,
    ))
}

fn validate_non_protected_path(
    raw_path: &str,
    workspace_root: Option<&str>,
) -> Result<PathBuf, String> {
    let path = path_security::validate_ai_writable_path_with_root(raw_path, workspace_root)?
        .into_path_buf();
    path_security::reject_existing_symlink(&path)?;
    Ok(path)
}

fn normalize_path_for_compare(raw_path: &str) -> String {
    path_security::normalize_path_for_compare(raw_path)
}

fn resolve_task_id(metadata: Option<&AiApplyPatchMetadataRequest>) -> String {
    metadata
        .and_then(|value| value.task_id.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("manual-preview")
        .to_string()
}

fn resolve_turn_id(metadata: Option<&AiApplyPatchMetadataRequest>) -> Option<String> {
    metadata
        .and_then(|value| value.turn_id.as_deref())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn resolve_reason(metadata: Option<&AiApplyPatchMetadataRequest>, summary: &str) -> String {
    metadata
        .and_then(|value| value.reason.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(summary)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{apply_operation_plans, AiAutoApplyOperationKind, AiAutoApplyOperationPlan};
    use crate::ai_edit::{self, AiEditState};
    use crate::commands::contracts::{
        AiApplyPatchMetadataRequest, AiEditListTimelineRequest, AiEditSetAuthLevelRequest,
        AiEditTimelineEntryPayload,
    };
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ))
    }

    #[test]
    fn apply_operation_plans_capture_task_turn_and_manual_snapshots() {
        let temp_dir = temp_dir("aed-auto-apply-manual");
        let file_path = temp_dir.join("script.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();

        apply_operation_plans(
            &[AiAutoApplyOperationPlan {
                kind: AiAutoApplyOperationKind::Modify,
                path: file_path.to_string_lossy().to_string(),
                new_path: None,
                original_hash: Some(crate::ai_patch::hash_text("echo old")),
                original_modified_at: None,
                original_content: Some("echo old".to_string()),
                updated_content: Some("echo new".to_string()),
            }],
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: Some("turn-1".to_string()),
                reason: Some("手动应用".to_string()),
                tool_call_id: None,
                confirmed_by_user: Some(true),
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
            }),
            "应用 AI 代码块",
            &state,
            &snapshot_root,
        )
        .expect("manual confirmed apply should succeed");

        let timeline = ai_edit::list_timeline_with_state(
            AiEditListTimelineRequest {
                task_id: None,
                limit: None,
            },
            &state,
            Vec::new(),
            Vec::new(),
        )
        .expect("timeline should be listed");

        let snapshot_scopes = timeline
            .entries
            .iter()
            .filter_map(|entry| match entry {
                AiEditTimelineEntryPayload::Snapshot(snapshot) => Some(snapshot.scope.as_str()),
                AiEditTimelineEntryPayload::Operation(_) => None,
            })
            .collect::<Vec<_>>();

        let operation = timeline
            .entries
            .iter()
            .find_map(|entry| match entry {
                AiEditTimelineEntryPayload::Operation(operation) => Some(operation),
                AiEditTimelineEntryPayload::Snapshot(_) => None,
            })
            .expect("operation should exist");

        assert!(snapshot_scopes.contains(&"task-start"));
        assert!(snapshot_scopes.contains(&"turn-start"));
        assert!(snapshot_scopes.contains(&"manual"));
        assert!(operation.source_snapshot_id.is_some());

        assert_eq!(
            fs::read_to_string(&file_path).expect("patched file should exist"),
            "echo new"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_operation_plans_support_create_delete_and_rename() {
        let temp_dir = temp_dir("aed-auto-apply-ops");
        let create_path = temp_dir.join("created.sh");
        let rename_source_path = temp_dir.join("before-rename.sh");
        let rename_target_path = temp_dir.join("after-rename.sh");
        let delete_path = temp_dir.join("delete-me.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&rename_source_path, "echo rename").expect("rename source should be written");
        fs::write(&delete_path, "echo delete").expect("delete source should be written");

        let state = AiEditState::default();

        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");

        apply_operation_plans(
            &[
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Create,
                    path: create_path.to_string_lossy().to_string(),
                    new_path: None,
                    original_hash: None,
                    original_modified_at: None,
                    original_content: None,
                    updated_content: Some("echo create".to_string()),
                },
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Rename,
                    path: rename_source_path.to_string_lossy().to_string(),
                    new_path: Some(rename_target_path.to_string_lossy().to_string()),
                    original_hash: Some(crate::ai_patch::hash_text("echo rename")),
                    original_modified_at: None,
                    original_content: Some("echo rename".to_string()),
                    updated_content: None,
                },
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Delete,
                    path: delete_path.to_string_lossy().to_string(),
                    new_path: None,
                    original_hash: Some(crate::ai_patch::hash_text("echo delete")),
                    original_modified_at: None,
                    original_content: Some("echo delete".to_string()),
                    updated_content: None,
                },
            ],
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-ops".to_string()),
                turn_id: Some("turn-ops".to_string()),
                reason: Some("批量写入".to_string()),
                tool_call_id: None,
                confirmed_by_user: None,
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
            }),
            "批量写入",
            &state,
            &snapshot_root,
        )
        .expect("mixed operations should succeed");

        let timeline = ai_edit::list_timeline_with_state(
            AiEditListTimelineRequest {
                task_id: None,
                limit: None,
            },
            &state,
            Vec::new(),
            Vec::new(),
        )
        .expect("timeline should be listed");

        let operation_kinds = timeline
            .entries
            .iter()
            .filter_map(|entry| match entry {
                AiEditTimelineEntryPayload::Operation(operation) => Some(operation.kind.as_str()),
                AiEditTimelineEntryPayload::Snapshot(_) => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            fs::read_to_string(&create_path).expect("created file should exist"),
            "echo create"
        );
        assert!(!rename_source_path.exists());
        assert_eq!(
            fs::read_to_string(&rename_target_path).expect("renamed file should exist"),
            "echo rename"
        );
        assert!(!delete_path.exists());

        assert!(operation_kinds.contains(&"create"));
        assert!(operation_kinds.contains(&"rename"));
        assert!(operation_kinds.contains(&"delete"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn modify_rejects_when_file_changed_after_plan_created() {
        let temp_dir = temp_dir("aed-auto-apply-conflict");
        let file_path = temp_dir.join("script.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo changed by user").expect("temp file should be written");

        let state = AiEditState::default();

        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");

        let result = apply_operation_plans(
            &[AiAutoApplyOperationPlan {
                kind: AiAutoApplyOperationKind::Modify,
                path: file_path.to_string_lossy().to_string(),
                new_path: None,
                original_hash: Some(crate::ai_patch::hash_text("echo old")),
                original_modified_at: None,
                original_content: Some("echo old".to_string()),
                updated_content: Some("echo new".to_string()),
            }],
            None,
            "冲突测试",
            &state,
            &snapshot_root,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&file_path).expect("file should still exist"),
            "echo changed by user"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn modify_rejects_when_file_mtime_changed_after_baseline() {
        let temp_dir = temp_dir("aed-auto-apply-mtime-conflict");
        let file_path = temp_dir.join("script.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();

        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");

        let result = apply_operation_plans(
            &[AiAutoApplyOperationPlan {
                kind: AiAutoApplyOperationKind::Modify,
                path: file_path.to_string_lossy().to_string(),
                new_path: None,
                original_hash: Some(crate::ai_patch::hash_text("echo old")),
                original_modified_at: Some(std::time::UNIX_EPOCH),
                original_content: Some("echo old".to_string()),
                updated_content: Some("echo new".to_string()),
            }],
            None,
            "mtime 冲突测试",
            &state,
            &snapshot_root,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&file_path).expect("file should still exist"),
            "echo old"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn rolls_back_previous_create_when_later_operation_fails() {
        let temp_dir = temp_dir("aed-auto-apply-rollback");
        let create_path = temp_dir.join("created.sh");
        let missing_path = temp_dir.join("missing.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");

        let state = AiEditState::default();

        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");

        let result = apply_operation_plans(
            &[
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Create,
                    path: create_path.to_string_lossy().to_string(),
                    new_path: None,
                    original_hash: None,
                    original_modified_at: None,
                    original_content: None,
                    updated_content: Some("echo create".to_string()),
                },
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Delete,
                    path: missing_path.to_string_lossy().to_string(),
                    new_path: None,
                    original_hash: Some(crate::ai_patch::hash_text("echo missing")),
                    original_modified_at: None,
                    original_content: Some("echo missing".to_string()),
                    updated_content: None,
                },
            ],
            None,
            "回滚测试",
            &state,
            &snapshot_root,
        );

        assert!(result.is_err());
        assert!(!create_path.exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn rejects_original_hash_that_does_not_match_original_content() {
        let temp_dir = temp_dir("aed-auto-apply-invalid-hash");
        let file_path = temp_dir.join("script.sh");
        let snapshot_root = temp_dir.join("snapshot-store");

        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        fs::write(&file_path, "echo old").expect("temp file should be written");

        let state = AiEditState::default();

        ai_edit::set_auth_level(
            AiEditSetAuthLevelRequest {
                level: "session".to_string(),
                task_id: None,
            },
            &state,
        )
        .expect("session auth should be set");

        let result = apply_operation_plans(
            &[AiAutoApplyOperationPlan {
                kind: AiAutoApplyOperationKind::Modify,
                path: file_path.to_string_lossy().to_string(),
                new_path: None,
                original_hash: Some("wrong-hash".to_string()),
                original_modified_at: None,
                original_content: Some("echo old".to_string()),
                updated_content: Some("echo new".to_string()),
            }],
            None,
            "非法 hash 测试",
            &state,
            &snapshot_root,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&file_path).expect("file should remain unchanged"),
            "echo old"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
