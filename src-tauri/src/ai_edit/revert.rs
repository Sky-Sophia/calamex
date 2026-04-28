use crate::ai::audit::{self, AiAuditEventKind};
use crate::ai_edit::{self, edit_journal, errors, snapshot, AiEditState};
use crate::ai_patch;
use crate::commands::contracts::{
	AiEditListTimelineRequest, AiEditOperationPayload, AiEditRestoreSnapshotPayload,
	AiEditRestoreSnapshotRequest, AiEditRevertTaskPayload, AiEditRevertTaskRequest,
	AiEditTimelineEntryPayload, AiEditUndoOperationPayload, AiEditUndoOperationRequest,
	AiSnapshotPayload,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

struct UndoExecutionResult {
	restored_files: Vec<String>,
	pre_revert_snapshot: AiSnapshotPayload,
	restored_snapshot: AiSnapshotPayload,
	source_snapshot_id: Option<String>,
}

pub fn restore_snapshot(
	payload: AiEditRestoreSnapshotRequest,
	storage_root: &Path,
	state: &AiEditState,
) -> Result<AiEditRestoreSnapshotPayload, String> {
	let snapshot_id = payload.snapshot_id.trim();
	if snapshot_id.is_empty() {
		return Err(errors::snapshot_not_found(""));
	}

	let target_snapshot = snapshot::load_stored_snapshot(storage_root, snapshot_id)?;
	ai_edit::ensure_write_authorized(
		state,
		"AED 快照恢复",
		Some(target_snapshot.snapshot.task_id.as_str()),
	)?;
	let current_files = target_snapshot
		.files
		.iter()
		.map(|file| {
			let current_content = fs::read_to_string(&file.path).map_err(|error| {
				errors::restore_conflict(format!("读取当前文件失败（{}）：{error}", file.path))
			})?;
			Ok(snapshot::StoredSnapshotFile {
				path: file.path.clone(),
				content_hash: ai_patch::hash_text(&current_content),
				content: current_content,
			})
		})
		.collect::<Result<Vec<_>, String>>()?;
	let current_sources = as_snapshot_sources(&current_files);

	let pre_revert_snapshot = snapshot::store_pre_revert_snapshot(
		storage_root,
		&target_snapshot.snapshot.task_id,
		&format!("恢复前快照：{}", target_snapshot.snapshot.label),
		&current_sources,
	)?;
	ai_edit::append_snapshot(state, pre_revert_snapshot.clone())?;

	for file in &target_snapshot.files {
		if let Some(parent) = PathBuf::from(&file.path).parent() {
			if !parent.as_os_str().is_empty() {
				fs::create_dir_all(parent).map_err(|error| {
					errors::restore_failed(format!(
						"创建恢复目录失败（{}）：{error}",
						parent.display()
					))
				})?;
			}
		}
		fs::write(&file.path, file.content.as_bytes()).map_err(|error| {
			errors::restore_failed(format!("写回恢复文件失败（{}）：{error}", file.path))
		})?;
	}

	let restored_sources = as_snapshot_sources(&target_snapshot.files);
	let restored_snapshot = snapshot::store_revert_snapshot(
		storage_root,
		&target_snapshot.snapshot.task_id,
		&format!("恢复到快照：{}", target_snapshot.snapshot.label),
		&restored_sources,
	)?;
	ai_edit::append_snapshot(state, restored_snapshot.clone())?;

	tracing::info!(
		target: "ai.audit",
		event = "ai.edit.snapshot_restored",
		snapshot_id = snapshot_id,
		pre_revert_snapshot_id = pre_revert_snapshot.id.as_str(),
		restored_snapshot_id = restored_snapshot.id.as_str(),
		task_id = target_snapshot.snapshot.task_id.as_str(),
		restored_file_count = target_snapshot.files.len(),
		"AI edit snapshot restored"
	);
	audit::emit(AiAuditEventKind::AiEditSnapshotRestored);

	Ok(AiEditRestoreSnapshotPayload {
		snapshot_id: snapshot_id.to_string(),
		restored_files: target_snapshot
			.files
			.iter()
			.map(|file| file.path.clone())
			.collect(),
		pre_revert_snapshot,
		restored_snapshot,
	})
}

pub fn undo_operation(
	payload: AiEditUndoOperationRequest,
	storage_root: &Path,
	state: &AiEditState,
) -> Result<AiEditUndoOperationPayload, String> {
	let operation_id = payload.operation_id.trim();
	if operation_id.is_empty() {
		return Err(errors::operation_not_found(""));
	}

	let operation = resolve_operation(storage_root, state, operation_id)?;
	ai_edit::ensure_write_authorized(
		state,
		"AED 单条编辑撤销",
		Some(operation.task_id.as_str()),
	)?;
	let result = execute_undo_operation(storage_root, state, &operation)?;
	emit_operation_reverted(&operation, &result);

	Ok(AiEditUndoOperationPayload {
		operation_id: operation.id,
		restored_files: result.restored_files,
		pre_revert_snapshot: result.pre_revert_snapshot,
		restored_snapshot: result.restored_snapshot,
	})
}

pub fn revert_task(
	payload: AiEditRevertTaskRequest,
	storage_root: &Path,
	state: &AiEditState,
) -> Result<AiEditRevertTaskPayload, String> {
	let task_id = payload.task_id.trim();
	if task_id.is_empty() {
		return Err(errors::task_not_found(""));
	}
	ai_edit::ensure_write_authorized(state, "AED 任务回滚", Some(task_id))?;

	let operations = list_task_operations(storage_root, state, task_id)?;
	let mut reverted_operation_ids = Vec::new();
	let mut restored_files = Vec::new();
	let mut restored_file_set = HashSet::new();
	let mut pre_revert_snapshots = Vec::new();
	let mut restored_snapshots = Vec::new();

	for operation in operations {
		if is_operation_already_reverted(storage_root, &operation)? {
			continue;
		}

		let result = execute_undo_operation(storage_root, state, &operation)?;
		emit_operation_reverted(&operation, &result);

		for path in &result.restored_files {
			if restored_file_set.insert(path.clone()) {
				restored_files.push(path.clone());
			}
		}
		reverted_operation_ids.push(operation.id.clone());
		pre_revert_snapshots.push(result.pre_revert_snapshot);
		restored_snapshots.push(result.restored_snapshot);
	}

	if reverted_operation_ids.is_empty() {
		return Err(errors::restore_conflict(format!(
			"任务 {task_id} 当前没有可撤销的 AED 编辑。"
		)));
	}

	tracing::info!(
		target: "ai.audit",
		event = "ai.edit.task_reverted",
		task_id = task_id,
		reverted_operation_count = reverted_operation_ids.len(),
		restored_file_count = restored_files.len(),
		"AI edit task reverted"
	);

	Ok(AiEditRevertTaskPayload {
		task_id: task_id.to_string(),
		reverted_operation_ids,
		restored_files,
		pre_revert_snapshots,
		restored_snapshots,
	})
}

fn resolve_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation_id: &str,
) -> Result<AiEditOperationPayload, String> {
	{
		let guard = state.timeline.lock().map_err(|_| errors::state_poisoned())?;
		if let Some(operation) = guard.iter().find_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) if operation.id == operation_id => {
				Some(operation.clone())
			}
			_ => None,
		}) {
			return Ok(operation);
		}
	}

	edit_journal::list_operations(storage_root)?
		.into_iter()
		.find(|operation| operation.id == operation_id)
		.ok_or_else(|| errors::operation_not_found(operation_id))
}

fn list_task_operations(
	storage_root: &Path,
	state: &AiEditState,
	task_id: &str,
) -> Result<Vec<AiEditOperationPayload>, String> {
	let timeline = ai_edit::list_timeline_with_state(
		AiEditListTimelineRequest {
			task_id: Some(task_id.to_string()),
			limit: None,
		},
		state,
		Vec::new(),
		edit_journal::list_operations(storage_root)?,
	)?;
	let operations = timeline
		.entries
		.into_iter()
		.filter_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) => Some(operation),
			AiEditTimelineEntryPayload::Snapshot(_) => None,
		})
		.collect::<Vec<_>>();

	if operations.is_empty() {
		return Err(errors::task_not_found(task_id));
	}

	Ok(operations)
}

fn execute_undo_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation: &AiEditOperationPayload,
) -> Result<UndoExecutionResult, String> {
	let source_snapshot = operation
		.source_snapshot_id
		.as_deref()
		.map(|snapshot_id| snapshot::load_stored_snapshot(storage_root, snapshot_id))
		.transpose()?;

	match operation.kind.as_str() {
		"modify" => undo_modify_operation(storage_root, state, operation, source_snapshot.as_ref()),
		"create" => undo_create_operation(storage_root, state, operation),
		"delete" => undo_delete_operation(storage_root, state, operation, source_snapshot.as_ref()),
		"rename" => undo_rename_operation(storage_root, state, operation, source_snapshot.as_ref()),
		other => Err(errors::restore_conflict(format!(
			"当前不支持撤销该操作类型：{other}"
		))),
	}
}

fn emit_operation_reverted(operation: &AiEditOperationPayload, result: &UndoExecutionResult) {
	tracing::info!(
		target: "ai.audit",
		event = "ai.edit.operation_reverted",
		operation_id = operation.id.as_str(),
		source_snapshot_id = result.source_snapshot_id.as_deref().unwrap_or(""),
		pre_revert_snapshot_id = result.pre_revert_snapshot.id.as_str(),
		restored_snapshot_id = result.restored_snapshot.id.as_str(),
		task_id = operation.task_id.as_str(),
		restored_file_count = result.restored_files.len(),
		"AI edit operation reverted"
	);
	audit::emit(AiAuditEventKind::AiEditOperationReverted);
}

fn is_operation_already_reverted(
	storage_root: &Path,
	operation: &AiEditOperationPayload,
) -> Result<bool, String> {
	match operation.kind.as_str() {
		"modify" => {
			if !PathBuf::from(&operation.path).exists() {
				return Ok(false);
			}
			let source_snapshot = operation
				.source_snapshot_id
				.as_deref()
				.map(|snapshot_id| snapshot::load_stored_snapshot(storage_root, snapshot_id))
				.transpose()?
				.ok_or_else(|| errors::restore_conflict("未找到 modify 撤销所需的源快照。"))?;
			let source_file = require_source_file(&source_snapshot, &operation.path)?;
			let current_file = read_snapshot_file(&operation.path)?;
			Ok(current_file.content_hash == source_file.content_hash)
		}
		"create" => Ok(!PathBuf::from(&operation.path).exists()),
		"delete" => {
			if !PathBuf::from(&operation.path).exists() {
				return Ok(false);
			}
			let source_snapshot = operation
				.source_snapshot_id
				.as_deref()
				.map(|snapshot_id| snapshot::load_stored_snapshot(storage_root, snapshot_id))
				.transpose()?
				.ok_or_else(|| errors::restore_conflict("未找到 delete 撤销所需的源快照。"))?;
			let source_file = require_source_file(&source_snapshot, &operation.path)?;
			let current_file = read_snapshot_file(&operation.path)?;
			Ok(current_file.content_hash == source_file.content_hash)
		}
		"rename" => {
			let current_path = operation
				.new_path
				.as_deref()
				.ok_or_else(|| errors::restore_conflict("rename 操作缺少 newPath，无法判断回滚状态。"))?;
			if PathBuf::from(current_path).exists() || !PathBuf::from(&operation.path).exists() {
				return Ok(false);
			}
			let source_snapshot = operation
				.source_snapshot_id
				.as_deref()
				.map(|snapshot_id| snapshot::load_stored_snapshot(storage_root, snapshot_id))
				.transpose()?
				.ok_or_else(|| errors::restore_conflict("未找到 rename 撤销所需的源快照。"))?;
			let source_file = require_source_file(&source_snapshot, &operation.path)?;
			let current_file = read_snapshot_file(&operation.path)?;
			Ok(current_file.content_hash == source_file.content_hash)
		}
		other => Err(errors::restore_conflict(format!(
			"当前不支持检查该操作类型的回滚状态：{other}"
		))),
	}
}

fn undo_modify_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation: &AiEditOperationPayload,
	source_snapshot: Option<&snapshot::StoredSnapshot>,
) -> Result<UndoExecutionResult, String> {
	let source_snapshot_id = operation
		.source_snapshot_id
		.clone()
		.ok_or_else(|| errors::restore_conflict("该编辑没有可用的源快照引用。"))?;
	let source_snapshot = source_snapshot
		.ok_or_else(|| errors::restore_conflict("未找到 modify 撤销所需的源快照。"))?;
	let source_file = require_source_file(source_snapshot, &operation.path)?;
	let current_file = read_snapshot_file(&operation.path)?;

	let pre_revert_snapshot = append_pre_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销前快照：{}", operation.path),
		std::slice::from_ref(&current_file),
	)?;
	ensure_parent_dir(&operation.path, "撤销目录")?;
	fs::write(&operation.path, source_file.content.as_bytes()).map_err(|error| {
		errors::restore_failed(format!(
			"写回撤销文件失败（{}）：{error}",
			operation.path
		))
	})?;
	let restored_snapshot = append_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销编辑：{}", operation.path),
		std::slice::from_ref(&source_file),
	)?;

	Ok(UndoExecutionResult {
		restored_files: vec![operation.path.clone()],
		pre_revert_snapshot,
		restored_snapshot,
		source_snapshot_id: Some(source_snapshot_id),
	})
}

fn undo_create_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation: &crate::commands::contracts::AiEditOperationPayload,
) -> Result<UndoExecutionResult, String> {
	let current_file = read_snapshot_file(&operation.path)?;
	let pre_revert_snapshot = append_pre_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销前快照：{}", operation.path),
		std::slice::from_ref(&current_file),
	)?;
	fs::remove_file(&operation.path).map_err(|error| {
		errors::restore_failed(format!(
			"删除撤销文件失败（{}）：{error}",
			operation.path
		))
	})?;
	let restored_snapshot = append_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销创建：{}", operation.path),
		&[],
	)?;

	Ok(UndoExecutionResult {
		restored_files: vec![operation.path.clone()],
		pre_revert_snapshot,
		restored_snapshot,
		source_snapshot_id: operation.source_snapshot_id.clone(),
	})
}

fn undo_delete_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation: &crate::commands::contracts::AiEditOperationPayload,
	source_snapshot: Option<&snapshot::StoredSnapshot>,
) -> Result<UndoExecutionResult, String> {
	if PathBuf::from(&operation.path).exists() {
		return Err(errors::restore_conflict(format!(
			"当前文件已存在，无法撤销 delete 操作：{}",
			operation.path
		)));
	}
	let source_snapshot_id = operation
		.source_snapshot_id
		.clone()
		.ok_or_else(|| errors::restore_conflict("该删除操作没有可用的源快照引用。"))?;
	let source_snapshot = source_snapshot
		.ok_or_else(|| errors::restore_conflict("未找到 delete 撤销所需的源快照。"))?;
	let source_file = require_source_file(source_snapshot, &operation.path)?;

	let pre_revert_snapshot = append_pre_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销前快照：{}", operation.path),
		&[],
	)?;
	ensure_parent_dir(&operation.path, "撤销目录")?;
	fs::write(&operation.path, source_file.content.as_bytes()).map_err(|error| {
		errors::restore_failed(format!(
			"写回删除文件失败（{}）：{error}",
			operation.path
		))
	})?;
	let restored_snapshot = append_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销删除：{}", operation.path),
		std::slice::from_ref(&source_file),
	)?;

	Ok(UndoExecutionResult {
		restored_files: vec![operation.path.clone()],
		pre_revert_snapshot,
		restored_snapshot,
		source_snapshot_id: Some(source_snapshot_id),
	})
}

fn undo_rename_operation(
	storage_root: &Path,
	state: &AiEditState,
	operation: &crate::commands::contracts::AiEditOperationPayload,
	source_snapshot: Option<&snapshot::StoredSnapshot>,
) -> Result<UndoExecutionResult, String> {
	let current_path = operation
		.new_path
		.as_deref()
		.ok_or_else(|| errors::restore_conflict("rename 操作缺少 newPath，无法撤销。"))?;
	if PathBuf::from(&operation.path).exists() {
		return Err(errors::restore_conflict(format!(
			"原路径已存在，无法撤销 rename 操作：{}",
			operation.path
		)));
	}
	let current_file = read_snapshot_file(current_path)?;
	let source_snapshot_id = operation
		.source_snapshot_id
		.clone()
		.ok_or_else(|| errors::restore_conflict("该重命名操作没有可用的源快照引用。"))?;
	let source_snapshot = source_snapshot
		.ok_or_else(|| errors::restore_conflict("未找到 rename 撤销所需的源快照。"))?;
	let source_file = require_source_file(source_snapshot, &operation.path)?;

	let pre_revert_snapshot = append_pre_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销前快照：{}", current_path),
		std::slice::from_ref(&current_file),
	)?;
	ensure_parent_dir(&operation.path, "撤销目录")?;
	fs::rename(current_path, &operation.path).map_err(|error| {
		errors::restore_failed(format!(
			"撤销重命名失败（{} -> {}）：{error}",
			current_path,
			operation.path
		))
	})?;
	let restored_snapshot = append_revert_snapshot(
		storage_root,
		state,
		&operation.task_id,
		&format!("撤销重命名：{}", operation.path),
		std::slice::from_ref(&source_file),
	)?;

	Ok(UndoExecutionResult {
		restored_files: vec![operation.path.clone(), current_path.to_string()],
		pre_revert_snapshot,
		restored_snapshot,
		source_snapshot_id: Some(source_snapshot_id),
	})
}

fn append_pre_revert_snapshot(
	storage_root: &Path,
	state: &AiEditState,
	task_id: &str,
	label: &str,
	files: &[snapshot::StoredSnapshotFile],
) -> Result<AiSnapshotPayload, String> {
	let snapshot = snapshot::store_pre_revert_snapshot(
		storage_root,
		task_id,
		label,
		&as_snapshot_sources(files),
	)?;
	ai_edit::append_snapshot(state, snapshot.clone())?;
	Ok(snapshot)
}

fn append_revert_snapshot(
	storage_root: &Path,
	state: &AiEditState,
	task_id: &str,
	label: &str,
	files: &[snapshot::StoredSnapshotFile],
) -> Result<AiSnapshotPayload, String> {
	let snapshot = snapshot::store_revert_snapshot(
		storage_root,
		task_id,
		label,
		&as_snapshot_sources(files),
	)?;
	ai_edit::append_snapshot(state, snapshot.clone())?;
	Ok(snapshot)
}

fn require_source_file(
	source_snapshot: &snapshot::StoredSnapshot,
	path: &str,
) -> Result<snapshot::StoredSnapshotFile, String> {
	source_snapshot
		.files
		.iter()
		.find(|file| file.path == path)
		.cloned()
		.ok_or_else(|| errors::restore_conflict(format!("源快照中未找到待撤销文件：{path}")))
}

fn read_snapshot_file(path: &str) -> Result<snapshot::StoredSnapshotFile, String> {
	let current_content = fs::read_to_string(path).map_err(|error| {
		errors::restore_conflict(format!("读取当前文件失败（{path}）：{error}"))
	})?;
	Ok(snapshot::StoredSnapshotFile {
		path: path.to_string(),
		content_hash: ai_patch::hash_text(&current_content),
		content: current_content,
	})
}

fn ensure_parent_dir(path: &str, context: &str) -> Result<(), String> {
	if let Some(parent) = PathBuf::from(path).parent() {
		if !parent.as_os_str().is_empty() {
			fs::create_dir_all(parent).map_err(|error| {
				errors::restore_failed(format!(
					"创建{context}失败（{}）：{error}",
					parent.display()
				))
			})?;
		}
	}
	Ok(())
}

fn as_snapshot_sources(files: &[snapshot::StoredSnapshotFile]) -> Vec<snapshot::SnapshotSourceFile<'_>> {
	files
		.iter()
		.map(|file| snapshot::SnapshotSourceFile {
			path: file.path.as_str(),
			content_hash: file.content_hash.as_str(),
			content: file.content.as_str(),
		})
		.collect()
}

#[cfg(test)]
mod tests {
	use super::{restore_snapshot, revert_task, undo_operation};
	use crate::ai_edit::{
		auto_apply::{
		apply_operation_plans, AiAutoApplyOperationKind, AiAutoApplyOperationPlan,
		},
		errors, self, edit_journal, snapshot, AiEditState,
	};
	use crate::commands::contracts::{
		AiApplyPatchRequest, AiEditListTimelineRequest, AiEditRestoreSnapshotRequest,
		AiEditRevertTaskRequest, AiEditSetAuthLevelRequest, AiEditTimelineEntryPayload,
		AiEditUndoOperationRequest, AiPatchFilePayload, AiPatchHunkPayload,
		AiPatchSetPayload, AiApplyPatchMetadataRequest,
	};
	use std::fs;

	#[test]
	fn restore_snapshot_restores_file_content_and_records_snapshots() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-restore-snapshot-{}",
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
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&state,
		)
		.expect("session auth should be set");
		crate::ai_patch::apply_patch(
			AiApplyPatchRequest {
				patch: AiPatchSetPayload {
					summary: "应用 AI 代码块".to_string(),
					files: vec![AiPatchFilePayload {
						path: file_path.to_string_lossy().to_string(),
						original_hash: crate::ai_patch::hash_text("echo old"),
						hunks: vec![AiPatchHunkPayload {
							old_start: 1,
							old_lines: 1,
							new_start: 1,
							new_lines: 1,
							lines: vec!["-echo old".to_string(), "+echo new".to_string()],
						}],
					}],
				},
				metadata: None,
			},
			&state,
			&snapshot_root,
		)
		.expect("patch should apply");

		let stored_snapshots = snapshot::list_stored_snapshots(&snapshot_root)
			.expect("snapshots should be listed");
		assert_eq!(stored_snapshots.len(), 2);
		let target_snapshot = stored_snapshots
			.iter()
			.find(|snapshot| snapshot.scope == "pre-tool")
			.expect("pre-tool snapshot should exist");

		let restore_payload = restore_snapshot(
			AiEditRestoreSnapshotRequest {
				snapshot_id: target_snapshot.id.clone(),
			},
			&snapshot_root,
			&state,
		)
		.expect("snapshot should restore");
		let restored_content = fs::read_to_string(&file_path).expect("file should still exist");
		let timeline = ai_edit::list_timeline_with_state(
			AiEditListTimelineRequest {
				task_id: None,
				limit: None,
			},
			&state,
			snapshot::list_stored_snapshots(&snapshot_root).expect("snapshots should be listed"),
			edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
		)
		.expect("timeline should be listed");

		assert_eq!(restored_content, "echo old");
		assert_eq!(restore_payload.restored_files.len(), 1);
		assert_eq!(timeline.entries.len(), 5);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn undo_operation_restores_file_content_from_source_snapshot() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-undo-operation-{}",
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
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&state,
		)
		.expect("session auth should be set");
		crate::ai_patch::apply_patch(
			AiApplyPatchRequest {
				patch: AiPatchSetPayload {
					summary: "应用 AI 代码块".to_string(),
					files: vec![AiPatchFilePayload {
						path: file_path.to_string_lossy().to_string(),
						original_hash: crate::ai_patch::hash_text("echo old"),
						hunks: vec![AiPatchHunkPayload {
							old_start: 1,
							old_lines: 1,
							new_start: 1,
							new_lines: 1,
							lines: vec!["-echo old".to_string(), "+echo new".to_string()],
						}],
					}],
				},
				metadata: None,
			},
			&state,
			&snapshot_root,
		)
		.expect("patch should apply");

		let operation_id = ai_edit::list_timeline_with_state(
			AiEditListTimelineRequest {
				task_id: None,
				limit: None,
			},
			&state,
			Vec::new(),
			edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
		)
		.expect("timeline should be listed")
		.entries
		.into_iter()
		.find_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) => Some(operation.id),
			AiEditTimelineEntryPayload::Snapshot(_) => None,
		})
		.expect("operation should exist");
		let revert_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&revert_state,
		)
		.expect("session auth should be set after restart");

		let undo_payload = undo_operation(
			AiEditUndoOperationRequest { operation_id },
			&snapshot_root,
			&revert_state,
		)
		.expect("operation should be reverted");
		let restored_content = fs::read_to_string(&file_path).expect("file should still exist");

		assert_eq!(restored_content, "echo old");
		assert_eq!(undo_payload.restored_files, vec![file_path.to_string_lossy().to_string()]);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn restore_snapshot_rejects_mismatched_per_task_auth_mode() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-restore-auth-blocked-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let file_path = temp_dir.join("script.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&file_path, "echo old").expect("temp file should be written");

		let apply_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&apply_state,
		)
		.expect("session auth should be set");
		crate::ai_patch::apply_patch(
			AiApplyPatchRequest {
				patch: AiPatchSetPayload {
					summary: "应用 AI 代码块".to_string(),
					files: vec![AiPatchFilePayload {
						path: file_path.to_string_lossy().to_string(),
						original_hash: crate::ai_patch::hash_text("echo old"),
						hunks: vec![AiPatchHunkPayload {
							old_start: 1,
							old_lines: 1,
							new_start: 1,
							new_lines: 1,
							lines: vec!["-echo old".to_string(), "+echo new".to_string()],
						}],
					}],
				},
				metadata: Some(AiApplyPatchMetadataRequest {
					task_id: Some("task-restore".to_string()),
					turn_id: Some("turn-restore".to_string()),
					reason: Some("恢复鉴权测试".to_string()),
					tool_call_id: None,
					confirmed_by_user: None,
				}),
			},
			&apply_state,
			&snapshot_root,
		)
		.expect("patch should apply");

		let target_snapshot = snapshot::list_stored_snapshots(&snapshot_root)
			.expect("snapshots should be listed")
			.into_iter()
			.find(|item| item.scope == "pre-tool")
			.expect("pre-tool snapshot should exist");

		let revert_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "per_task".to_string(),
				task_id: Some("task-other".to_string()),
			},
			&revert_state,
		)
		.expect("per-task auth should be set");

		let error = restore_snapshot(
			AiEditRestoreSnapshotRequest {
				snapshot_id: target_snapshot.id,
			},
			&snapshot_root,
			&revert_state,
		)
		.expect_err("mismatched per-task auth should block restore");

		assert!(error.contains(errors::AI_EDIT_AUTH_BLOCKED));
		assert_eq!(
			fs::read_to_string(&file_path).expect("file should still exist"),
			"echo new"
		);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn undo_operation_rejects_manual_auth_mode() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-undo-auth-blocked-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let file_path = temp_dir.join("script.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&file_path, "echo old").expect("temp file should be written");

		let apply_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&apply_state,
		)
		.expect("session auth should be set");
		crate::ai_patch::apply_patch(
			AiApplyPatchRequest {
				patch: AiPatchSetPayload {
					summary: "应用 AI 代码块".to_string(),
					files: vec![AiPatchFilePayload {
						path: file_path.to_string_lossy().to_string(),
						original_hash: crate::ai_patch::hash_text("echo old"),
						hunks: vec![AiPatchHunkPayload {
							old_start: 1,
							old_lines: 1,
							new_start: 1,
							new_lines: 1,
							lines: vec!["-echo old".to_string(), "+echo new".to_string()],
						}],
					}],
				},
				metadata: Some(AiApplyPatchMetadataRequest {
					task_id: Some("task-undo".to_string()),
					turn_id: Some("turn-undo".to_string()),
					reason: Some("撤销鉴权测试".to_string()),
					tool_call_id: None,
					confirmed_by_user: None,
				}),
			},
			&apply_state,
			&snapshot_root,
		)
		.expect("patch should apply");

		let operation_id = edit_journal::list_operations(&snapshot_root)
			.expect("operations should be listed")
			.into_iter()
			.find(|operation| operation.kind == "modify")
			.expect("modify operation should exist")
			.id;

		let revert_state = AiEditState::default();
		let error = undo_operation(
			AiEditUndoOperationRequest { operation_id },
			&snapshot_root,
			&revert_state,
		)
		.expect_err("manual auth should block undo");

		assert!(error.contains(errors::AI_EDIT_AUTH_BLOCKED));
		assert_eq!(
			fs::read_to_string(&file_path).expect("file should still exist"),
			"echo new"
		);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn undo_create_operation_removes_created_file() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-undo-create-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let file_path = temp_dir.join("created.sh");
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
		apply_operation_plans(
			&[AiAutoApplyOperationPlan {
				kind: AiAutoApplyOperationKind::Create,
				path: file_path.to_string_lossy().to_string(),
				new_path: None,
				original_hash: None,
				original_content: None,
				updated_content: Some("echo created".to_string()),
			}],
			Some(&AiApplyPatchMetadataRequest {
				task_id: Some("task-create".to_string()),
				turn_id: Some("turn-create".to_string()),
				reason: Some("创建文件".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"创建文件",
			&state,
			&snapshot_root,
		)
		.expect("create operation should apply");

		let operation_id = ai_edit::list_timeline_with_state(
			AiEditListTimelineRequest {
				task_id: None,
				limit: None,
			},
			&state,
			Vec::new(),
			edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
		)
		.expect("timeline should be listed")
		.entries
		.into_iter()
		.find_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) if operation.kind == "create" => {
				Some(operation.id)
			}
			_ => None,
		})
		.expect("create operation should exist");

		let undo_payload = undo_operation(
			AiEditUndoOperationRequest { operation_id },
			&snapshot_root,
			&AiEditState::default(),
		)
		.expect("create operation should be reverted");

		assert!(!file_path.exists());
		assert_eq!(undo_payload.restored_files, vec![file_path.to_string_lossy().to_string()]);

		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn undo_delete_operation_restores_file_content() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-undo-delete-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let file_path = temp_dir.join("deleted.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&file_path, "echo deleted").expect("temp file should be written");

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
			&[AiAutoApplyOperationPlan {
				kind: AiAutoApplyOperationKind::Delete,
				path: file_path.to_string_lossy().to_string(),
				new_path: None,
				original_hash: Some(crate::ai_patch::hash_text("echo deleted")),
				original_content: Some("echo deleted".to_string()),
				updated_content: None,
			}],
			Some(&AiApplyPatchMetadataRequest {
				task_id: Some("task-delete".to_string()),
				turn_id: Some("turn-delete".to_string()),
				reason: Some("删除文件".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"删除文件",
			&state,
			&snapshot_root,
		)
		.expect("delete operation should apply");

		let operation_id = ai_edit::list_timeline_with_state(
			AiEditListTimelineRequest {
				task_id: None,
				limit: None,
			},
			&state,
			Vec::new(),
			edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
		)
		.expect("timeline should be listed")
		.entries
		.into_iter()
		.find_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) if operation.kind == "delete" => {
				Some(operation.id)
			}
			_ => None,
		})
		.expect("delete operation should exist");

		let undo_payload = undo_operation(
			AiEditUndoOperationRequest { operation_id },
			&snapshot_root,
			&AiEditState::default(),
		)
		.expect("delete operation should be reverted");

		assert_eq!(fs::read_to_string(&file_path).expect("restored file should exist"), "echo deleted");
		assert_eq!(undo_payload.restored_files, vec![file_path.to_string_lossy().to_string()]);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn undo_rename_operation_restores_original_path() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-undo-rename-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let source_path = temp_dir.join("before.sh");
		let target_path = temp_dir.join("after.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&source_path, "echo rename").expect("temp file should be written");

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
			&[AiAutoApplyOperationPlan {
				kind: AiAutoApplyOperationKind::Rename,
				path: source_path.to_string_lossy().to_string(),
				new_path: Some(target_path.to_string_lossy().to_string()),
				original_hash: Some(crate::ai_patch::hash_text("echo rename")),
				original_content: Some("echo rename".to_string()),
				updated_content: None,
			}],
			Some(&AiApplyPatchMetadataRequest {
				task_id: Some("task-rename".to_string()),
				turn_id: Some("turn-rename".to_string()),
				reason: Some("重命名文件".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"重命名文件",
			&state,
			&snapshot_root,
		)
		.expect("rename operation should apply");

		let operation_id = ai_edit::list_timeline_with_state(
			AiEditListTimelineRequest {
				task_id: None,
				limit: None,
			},
			&state,
			Vec::new(),
			edit_journal::list_operations(&snapshot_root).expect("operations should be listed"),
		)
		.expect("timeline should be listed")
		.entries
		.into_iter()
		.find_map(|entry| match entry {
			AiEditTimelineEntryPayload::Operation(operation) if operation.kind == "rename" => {
				Some(operation.id)
			}
			_ => None,
		})
		.expect("rename operation should exist");

		let undo_payload = undo_operation(
			AiEditUndoOperationRequest { operation_id },
			&snapshot_root,
			&AiEditState::default(),
		)
		.expect("rename operation should be reverted");

		assert_eq!(fs::read_to_string(&source_path).expect("source file should exist"), "echo rename");
		assert!(!target_path.exists());
		assert_eq!(
			undo_payload.restored_files,
			vec![
				source_path.to_string_lossy().to_string(),
				target_path.to_string_lossy().to_string(),
			],
		);

		let _ = fs::remove_file(&source_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn revert_task_reverts_all_effective_operations_after_restart() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-revert-task-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let first_path = temp_dir.join("first.sh");
		let second_path = temp_dir.join("second.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&first_path, "echo first-old").expect("first file should be written");
		fs::write(&second_path, "echo second-old").expect("second file should be written");

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
					kind: AiAutoApplyOperationKind::Modify,
					path: first_path.to_string_lossy().to_string(),
					new_path: None,
					original_hash: Some(crate::ai_patch::hash_text("echo first-old")),
					original_content: Some("echo first-old".to_string()),
					updated_content: Some("echo first-new".to_string()),
				},
				AiAutoApplyOperationPlan {
					kind: AiAutoApplyOperationKind::Modify,
					path: second_path.to_string_lossy().to_string(),
					new_path: None,
					original_hash: Some(crate::ai_patch::hash_text("echo second-old")),
					original_content: Some("echo second-old".to_string()),
					updated_content: Some("echo second-new".to_string()),
				},
			],
			Some(&AiApplyPatchMetadataRequest {
				task_id: Some("task-revert-all".to_string()),
				turn_id: Some("turn-revert-all".to_string()),
				reason: Some("批量修改文件".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"批量修改文件",
			&state,
			&snapshot_root,
		)
		.expect("operations should apply");
		let revert_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&revert_state,
		)
		.expect("session auth should be set after restart");

		let revert_payload = revert_task(
			AiEditRevertTaskRequest {
				task_id: "task-revert-all".to_string(),
			},
			&snapshot_root,
			&revert_state,
		)
		.expect("task should be reverted");

		assert_eq!(
			fs::read_to_string(&first_path).expect("first file should exist"),
			"echo first-old"
		);
		assert_eq!(
			fs::read_to_string(&second_path).expect("second file should exist"),
			"echo second-old"
		);
		assert_eq!(revert_payload.task_id, "task-revert-all");
		assert_eq!(revert_payload.reverted_operation_ids.len(), 2);
		assert_eq!(revert_payload.pre_revert_snapshots.len(), 2);
		assert_eq!(revert_payload.restored_snapshots.len(), 2);

		let _ = fs::remove_file(&first_path);
		let _ = fs::remove_file(&second_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}

	#[test]
	fn revert_task_rejects_manual_auth_mode() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-revert-task-auth-blocked-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		let file_path = temp_dir.join("task.sh");
		let snapshot_root = temp_dir.join("snapshot-store");
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");
		fs::write(&file_path, "echo old").expect("temp file should be written");

		let apply_state = AiEditState::default();
		ai_edit::set_auth_level(
			AiEditSetAuthLevelRequest {
				level: "session".to_string(),
				task_id: None,
			},
			&apply_state,
		)
		.expect("session auth should be set");
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
				task_id: Some("task-blocked".to_string()),
				turn_id: Some("turn-blocked".to_string()),
				reason: Some("任务回滚鉴权测试".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"任务回滚鉴权测试",
			&apply_state,
			&snapshot_root,
		)
		.expect("operation should apply");

		let revert_state = AiEditState::default();
		let error = revert_task(
			AiEditRevertTaskRequest {
				task_id: "task-blocked".to_string(),
			},
			&snapshot_root,
			&revert_state,
		)
		.expect_err("manual auth should block task revert");

		assert!(error.contains(errors::AI_EDIT_AUTH_BLOCKED));
		assert_eq!(
			fs::read_to_string(&file_path).expect("file should still exist"),
			"echo new"
		);

		let _ = fs::remove_file(&file_path);
		let _ = fs::remove_dir_all(&temp_dir);
	}
}