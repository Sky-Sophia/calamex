use crate::ai::errors;
use crate::ai_edit::protected_paths;
use crate::ai_edit::snapshot::{self, SnapshotSourceFile};
use crate::ai_edit::{self, AiEditState};
use crate::ai_patch::hash_text;
use crate::commands::contracts::{AiApplyPatchMetadataRequest, AiEditOperationPayload};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};

/// 集中维护错误码字面量，避免散落的字符串拼写漂移。
mod error_codes {
    pub const WRITE_INVALID: &str = "AI_EDIT_WRITE_INVALID";
    pub const WRITE_CONFLICT: &str = "AI_EDIT_WRITE_CONFLICT";
    pub const WRITE_FAILED: &str = "AI_EDIT_WRITE_FAILED";
    pub const PATH_PROTECTED: &str = "AI_EDIT_PATH_PROTECTED";
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

/// 单条自动写盘计划。字段按操作类型不同有不同必填要求，由
/// [`validate_operation_plans`] 统一前置校验。
#[derive(Debug, Clone)]
pub struct AiAutoApplyOperationPlan {
    pub kind: AiAutoApplyOperationKind,
    pub path: String,
    pub new_path: Option<String>,
    pub original_hash: Option<String>,
    pub original_content: Option<String>,
    pub updated_content: Option<String>,
}

/// 单条操作执行成功后的反馈。
#[derive(Debug, Clone)]
pub struct AiAutoApplyFileResult {
    pub path: String,
    pub byte_size: u64,
}

/// 已落盘动作的回滚指令。`rollback` 会按 LIFO 顺序执行。
enum RollbackAction {
    Delete { path: PathBuf },
    Restore { path: PathBuf, content: String },
    Rename { from: PathBuf, to: PathBuf },
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
    validate_operation_plans(plans)?;

    let source_snapshot_id =
        capture_checkpoint_snapshots(plans, metadata, summary, state, storage_root)?;

    let mut rollback_actions: Vec<RollbackAction> = Vec::with_capacity(plans.len());
    let mut operation_payloads: Vec<AiEditOperationPayload> = Vec::with_capacity(plans.len());
    let mut results: Vec<AiAutoApplyFileResult> = Vec::with_capacity(plans.len());

    for (index, plan) in plans.iter().enumerate() {
        // 任意一步失败都必须回滚之前已经落盘的改动，避免文件系统出现半完成状态。
        match apply_operation_plan(plan, &mut rollback_actions) {
            Ok(result) => {
                operation_payloads.push(build_operation_payload(
                    index,
                    plan,
                    source_snapshot_id.as_deref(),
                    metadata,
                    summary,
                ));
                results.push(result);
            }
            Err(error) => {
                rollback(&rollback_actions);
                return Err(error);
            }
        }
    }

    if let Err(error) = ai_edit::append_operations(state, storage_root, &operation_payloads) {
        rollback(&rollback_actions);
        return Err(error);
    }

    Ok(results)
}

fn validate_operation_plans(plans: &[AiAutoApplyOperationPlan]) -> Result<(), String> {
    for plan in plans {
        if plan.path.trim().is_empty() {
            return Err(errors::error(
                error_codes::WRITE_INVALID,
                "AI 写入路径不能为空。",
            ));
        }

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
                if plan.original_hash.is_none()
                    || plan.original_content.is_none()
                    || plan.updated_content.is_none()
                {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "modify 操作缺少前后内容。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Delete => {
                if plan.original_hash.is_none() || plan.original_content.is_none() {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "delete 操作缺少原始内容。",
                    ));
                }
            }
            AiAutoApplyOperationKind::Rename => {
                let target_ok = plan
                    .new_path
                    .as_deref()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false);
                if plan.original_hash.is_none()
                    || plan.original_content.is_none()
                    || !target_ok
                {
                    return Err(errors::error(
                        error_codes::WRITE_INVALID,
                        "rename 操作缺少源内容或目标路径。",
                    ));
                }
            }
        }
    }
    Ok(())
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
        ai_edit::append_snapshot(state, snapshot)?;
    }

    if let Some(turn_id) = resolve_turn_id(metadata) {
        if ai_edit::mark_snapshot_scope(state, format!("turn-start:{turn_id}"))? {
            let snapshot = snapshot::store_turn_start_snapshot(
                storage_root,
                &snapshot_sources,
                metadata,
                summary,
            )?;
            ai_edit::append_snapshot(state, snapshot)?;
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
    ai_edit::append_snapshot(state, source_snapshot)?;
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

fn apply_operation_plan(
    plan: &AiAutoApplyOperationPlan,
    rollback_actions: &mut Vec<RollbackAction>,
) -> Result<AiAutoApplyFileResult, String> {
    match plan.kind {
        AiAutoApplyOperationKind::Create => apply_create(plan, rollback_actions),
        AiAutoApplyOperationKind::Modify => apply_modify(plan, rollback_actions),
        AiAutoApplyOperationKind::Delete => apply_delete(plan, rollback_actions),
        AiAutoApplyOperationKind::Rename => apply_rename(plan, rollback_actions),
    }
}

fn apply_create(
    plan: &AiAutoApplyOperationPlan,
    rollback_actions: &mut Vec<RollbackAction>,
) -> Result<AiAutoApplyFileResult, String> {
    let path = validate_non_protected_path(&plan.path)?;

    if path.exists() {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "create 目标已存在。",
        ));
    }

    ensure_parent_dir(&path)?;

    let updated = plan
        .updated_content
        .as_deref()
        .expect("validated create operation should have updated content");

    fs::write(&path, updated.as_bytes()).map_err(|error| {
        errors::error(error_codes::WRITE_FAILED, format!("写入文件失败：{error}"))
    })?;

    rollback_actions.push(RollbackAction::Delete { path: path.clone() });

    Ok(AiAutoApplyFileResult {
        path: plan.path.clone(),
        byte_size: updated.len() as u64,
    })
}

fn apply_modify(
    plan: &AiAutoApplyOperationPlan,
    rollback_actions: &mut Vec<RollbackAction>,
) -> Result<AiAutoApplyFileResult, String> {
    let path = validate_non_protected_path(&plan.path)?;

    if !path.is_file() {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "modify 目标文件不存在。",
        ));
    }

    let updated = plan
        .updated_content
        .as_deref()
        .expect("validated modify operation should have updated content");
    let original = plan
        .original_content
        .as_deref()
        .expect("validated modify operation should have original content")
        .to_owned();

    fs::write(&path, updated.as_bytes()).map_err(|error| {
        errors::error(error_codes::WRITE_FAILED, format!("写入文件失败：{error}"))
    })?;

    rollback_actions.push(RollbackAction::Restore {
        path: path.clone(),
        content: original,
    });

    Ok(AiAutoApplyFileResult {
        path: plan.path.clone(),
        byte_size: updated.len() as u64,
    })
}

fn apply_delete(
    plan: &AiAutoApplyOperationPlan,
    rollback_actions: &mut Vec<RollbackAction>,
) -> Result<AiAutoApplyFileResult, String> {
    let path = validate_non_protected_path(&plan.path)?;

    if !path.is_file() {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "delete 目标文件不存在。",
        ));
    }

    let original = plan
        .original_content
        .as_deref()
        .expect("validated delete operation should have original content")
        .to_owned();

    fs::remove_file(&path).map_err(|error| {
        errors::error(error_codes::WRITE_FAILED, format!("删除文件失败：{error}"))
    })?;

    rollback_actions.push(RollbackAction::Restore {
        path: path.clone(),
        content: original,
    });

    Ok(AiAutoApplyFileResult {
        path: plan.path.clone(),
        byte_size: 0,
    })
}

fn apply_rename(
    plan: &AiAutoApplyOperationPlan,
    rollback_actions: &mut Vec<RollbackAction>,
) -> Result<AiAutoApplyFileResult, String> {
    let source_path = validate_non_protected_path(&plan.path)?;

    if !source_path.exists() {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "rename 源文件不存在。",
        ));
    }

    let target_raw_path = plan
        .new_path
        .as_deref()
        .expect("validated rename operation should have target path");

    let target_path = validate_non_protected_path(target_raw_path)?;

    if target_path.exists() {
        return Err(errors::error(
            error_codes::WRITE_CONFLICT,
            "rename 目标文件已存在。",
        ));
    }

    ensure_parent_dir(&target_path)?;

    fs::rename(&source_path, &target_path).map_err(|error| {
        errors::error(error_codes::WRITE_FAILED, format!("重命名失败：{error}"))
    })?;

    rollback_actions.push(RollbackAction::Rename {
        from: target_path.clone(),
        to: source_path.clone(),
    });

    Ok(AiAutoApplyFileResult {
        path: target_raw_path.to_string(),
        byte_size: plan
            .original_content
            .as_deref()
            .map(|value| value.len() as u64)
            .unwrap_or(0),
    })
}

/// 在写入前确保父目录存在。对没有父目录或父目录为空字符串（单段相对路径）的情况跳过。
fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| {
                errors::error(error_codes::WRITE_FAILED, format!("创建目录失败：{error}"))
            })?;
        }
    }
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
    }
}

/// 反向执行已积累的回滚动作。
///
/// 这里有意忽略每条回滚的错误：到达此函数时主流程已经失败，没有更优补救策略；
/// 上层调用方会通过原始错误得知失败，回滚仅做尽力恢复。
fn rollback(actions: &[RollbackAction]) {
    for action in actions.iter().rev() {
        match action {
            RollbackAction::Delete { path } => {
                let _ = fs::remove_file(path);
            }
            RollbackAction::Restore { path, content } => {
                let _ = fs::write(path, content.as_bytes());
            }
            RollbackAction::Rename { from, to } => {
                let _ = fs::rename(from, to);
            }
        }
    }
}

fn validate_non_protected_path(raw_path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw_path);
    let normalized = path.to_string_lossy().replace('\\', "/");

    if protected_paths::is_builtin_protected_path(&normalized) {
        return Err(errors::error(
            error_codes::PATH_PROTECTED,
            "AED 受保护路径需要显式二次确认，当前 AI 写入已被拒绝。",
        ));
    }

    Ok(path)
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

    #[test]
    fn apply_operation_plans_capture_task_turn_and_manual_snapshots() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-auto-apply-manual-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
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
                original_content: Some("echo old".to_string()),
                updated_content: Some("echo new".to_string()),
            }],
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: Some("turn-1".to_string()),
                reason: Some("手动应用".to_string()),
                tool_call_id: None,
                confirmed_by_user: Some(true),
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

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn apply_operation_plans_support_create_delete_and_rename() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-auto-apply-ops-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
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
                    original_content: None,
                    updated_content: Some("echo create".to_string()),
                },
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Rename,
                    path: rename_source_path.to_string_lossy().to_string(),
                    new_path: Some(rename_target_path.to_string_lossy().to_string()),
                    original_hash: Some(crate::ai_patch::hash_text("echo rename")),
                    original_content: Some("echo rename".to_string()),
                    updated_content: None,
                },
                AiAutoApplyOperationPlan {
                    kind: AiAutoApplyOperationKind::Delete,
                    path: delete_path.to_string_lossy().to_string(),
                    new_path: None,
                    original_hash: Some(crate::ai_patch::hash_text("echo delete")),
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

        let _ = fs::remove_file(&create_path);
        let _ = fs::remove_file(&rename_target_path);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}