use crate::ai_edit::errors;
use crate::commands::contracts::{AiApplyPatchMetadataRequest, AiSnapshotPayload};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const SNAPSHOT_SCOPE_PRE_TOOL: &str = "pre-tool";
const SNAPSHOT_SCOPE_TASK_START: &str = "task-start";
const SNAPSHOT_SCOPE_TURN_START: &str = "turn-start";
const SNAPSHOT_SCOPE_MANUAL: &str = "manual";
const SNAPSHOT_SCOPE_PRE_REVERT: &str = "pre-revert";
const SNAPSHOT_SCOPE_REVERT: &str = "revert";
const SNAPSHOT_MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy)]
pub struct SnapshotSourceFile<'a> {
	pub path: &'a str,
	pub content_hash: &'a str,
	pub content: &'a str,
}

#[derive(Debug, Clone)]
pub struct StoredSnapshotFile {
	pub path: String,
	pub content_hash: String,
	pub content: String,
}

#[derive(Debug, Clone)]
pub struct StoredSnapshot {
	pub snapshot: AiSnapshotPayload,
	pub files: Vec<StoredSnapshotFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifest {
	version: u32,
	id: String,
	scope: String,
	task_id: String,
	created_at: String,
	label: String,
	size_bytes: u64,
	files: Vec<SnapshotManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifestFile {
	path: String,
	content_hash: String,
	blob_key: String,
	byte_size: u64,
}

pub fn store_pre_tool_snapshot(
	storage_root: &Path,
	files: &[SnapshotSourceFile<'_>],
	metadata: Option<&AiApplyPatchMetadataRequest>,
	summary: &str,
) -> Result<AiSnapshotPayload, String> {
	let task_id = resolve_task_id(metadata);
	let label = resolve_label(metadata, summary, "Patch 前快照");

	store_snapshot(storage_root, SNAPSHOT_SCOPE_PRE_TOOL, &task_id, &label, files)
}

pub fn store_task_start_snapshot(
	storage_root: &Path,
	files: &[SnapshotSourceFile<'_>],
	metadata: Option<&AiApplyPatchMetadataRequest>,
	summary: &str,
) -> Result<AiSnapshotPayload, String> {
	let task_id = resolve_task_id(metadata);
	let fallback_label = format!("任务起点：{}", summary.trim());
	let label = resolve_label(metadata, &fallback_label, "任务起点快照");

	store_snapshot(storage_root, SNAPSHOT_SCOPE_TASK_START, &task_id, &label, files)
}

pub fn store_turn_start_snapshot(
	storage_root: &Path,
	files: &[SnapshotSourceFile<'_>],
	metadata: Option<&AiApplyPatchMetadataRequest>,
	summary: &str,
) -> Result<AiSnapshotPayload, String> {
	let task_id = resolve_task_id(metadata);
	let turn_id = metadata
		.and_then(|value| value.turn_id.as_deref())
		.filter(|value| !value.trim().is_empty())
		.unwrap_or("manual-turn");
	let fallback_label = format!("回合起点：{turn_id} · {}", summary.trim());
	let label = resolve_label(metadata, &fallback_label, "回合起点快照");

	store_snapshot(storage_root, SNAPSHOT_SCOPE_TURN_START, &task_id, &label, files)
}

pub fn store_manual_snapshot(
	storage_root: &Path,
	files: &[SnapshotSourceFile<'_>],
	metadata: Option<&AiApplyPatchMetadataRequest>,
	summary: &str,
) -> Result<AiSnapshotPayload, String> {
	let task_id = resolve_task_id(metadata);
	let fallback_label = format!("手动确认：{}", summary.trim());
	let label = resolve_label(metadata, &fallback_label, "手动确认前快照");
	let label = if label.is_empty() {
		"手动确认前快照".to_string()
	} else {
		label
	};

	store_snapshot(storage_root, SNAPSHOT_SCOPE_MANUAL, &task_id, &label, files)
}

pub fn store_pre_revert_snapshot(
	storage_root: &Path,
	task_id: &str,
	label: &str,
	files: &[SnapshotSourceFile<'_>],
) -> Result<AiSnapshotPayload, String> {
	store_snapshot(
		storage_root,
		SNAPSHOT_SCOPE_PRE_REVERT,
		task_id,
		label,
		files,
	)
}

pub fn store_revert_snapshot(
	storage_root: &Path,
	task_id: &str,
	label: &str,
	files: &[SnapshotSourceFile<'_>],
) -> Result<AiSnapshotPayload, String> {
	store_snapshot(storage_root, SNAPSHOT_SCOPE_REVERT, task_id, label, files)
}

pub fn load_stored_snapshot(
	storage_root: &Path,
	snapshot_id: &str,
) -> Result<StoredSnapshot, String> {
	let snapshots_dir = storage_root.join("snapshots");
	if !snapshots_dir.is_dir() {
		return Err(errors::snapshot_not_found(snapshot_id));
	}

	let entries = fs::read_dir(&snapshots_dir)
		.map_err(|error| errors::snapshot_store_failed(format!("读取快照目录失败：{error}")))?;

	for entry in entries {
		let entry = match entry {
			Ok(value) => value,
			Err(error) => {
				tracing::warn!(target: "ai.edit", error = %error, "skip unreadable snapshot entry");
				continue;
			}
		};
		let path = entry.path();
		if path.extension().and_then(|value| value.to_str()) != Some("json") {
			continue;
		}

		let Some((manifest, storage_key)) = read_manifest_from_path(storage_root, &path)? else {
			continue;
		};
		if manifest.id == snapshot_id {
			return manifest.into_stored_snapshot(storage_root, storage_key);
		}
	}

	Err(errors::snapshot_not_found(snapshot_id))
}

fn store_snapshot(
	storage_root: &Path,
	scope: &str,
	task_id: &str,
	label: &str,
	files: &[SnapshotSourceFile<'_>],
) -> Result<AiSnapshotPayload, String> {
	let timestamp = Utc::now();
	let snapshot_id = format!("ai-edit-snapshot-{}", timestamp.timestamp_millis());

	let blobs_dir = storage_root.join("blobs");
	let snapshots_dir = storage_root.join("snapshots");
	fs::create_dir_all(&blobs_dir)
		.map_err(|error| errors::snapshot_store_failed(format!("创建 blobs 目录失败：{error}")))?;
	fs::create_dir_all(&snapshots_dir).map_err(|error| {
		errors::snapshot_store_failed(format!("创建 snapshots 目录失败：{error}"))
	})?;

	let mut manifest_files = Vec::with_capacity(files.len());
	let mut file_refs = Vec::with_capacity(files.len());
	let mut size_bytes = 0_u64;

	for file in files {
		let blob_key = build_blob_key(file.content_hash);
		let blob_path = join_storage_path(storage_root, &blob_key);
		if !blob_path.exists() {
			fs::write(&blob_path, file.content.as_bytes()).map_err(|error| {
				errors::snapshot_store_failed(format!("写入快照 blob 失败：{error}"))
			})?;
		}

		let byte_size = file.content.len() as u64;
		size_bytes += byte_size;
		file_refs.push(file.path.to_string());
		manifest_files.push(SnapshotManifestFile {
			path: file.path.to_string(),
			content_hash: file.content_hash.to_string(),
			blob_key,
			byte_size,
		});
	}

	let storage_key = format!("snapshots/{snapshot_id}.json");
	let manifest = SnapshotManifest {
		version: SNAPSHOT_MANIFEST_VERSION,
		id: snapshot_id.clone(),
		scope: scope.to_string(),
		task_id: task_id.to_string(),
		created_at: timestamp.to_rfc3339(),
		label: label.to_string(),
		size_bytes,
		files: manifest_files,
	};
	let manifest_path = join_storage_path(storage_root, &storage_key);
	let manifest_json = serde_json::to_vec(&manifest)
		.map_err(|error| errors::snapshot_store_failed(format!("序列化快照清单失败：{error}")))?;
	fs::write(&manifest_path, manifest_json)
		.map_err(|error| errors::snapshot_store_failed(format!("写入快照清单失败：{error}")))?;

	Ok(AiSnapshotPayload {
		id: snapshot_id,
		scope: scope.to_string(),
		task_id: task_id.to_string(),
		created_at: timestamp.to_rfc3339(),
		label: label.to_string(),
		file_refs,
		storage_key,
		size_bytes,
	})
}

fn resolve_task_id(metadata: Option<&AiApplyPatchMetadataRequest>) -> String {
	metadata
		.and_then(|value| value.task_id.as_deref())
		.filter(|value| !value.trim().is_empty())
		.unwrap_or("manual-preview")
		.to_string()
}

fn resolve_label(
	metadata: Option<&AiApplyPatchMetadataRequest>,
	fallback: &str,
	empty_label: &str,
) -> String {
	let label = metadata
		.and_then(|value| value.reason.as_deref())
		.filter(|value| !value.trim().is_empty())
		.unwrap_or(fallback)
		.trim()
		.to_string();
    if label.is_empty() {
        empty_label.to_string()
    } else {
        label
    }
}

pub fn list_stored_snapshots(storage_root: &Path) -> Result<Vec<AiSnapshotPayload>, String> {
	let snapshots_dir = storage_root.join("snapshots");
	if !snapshots_dir.is_dir() {
		return Ok(Vec::new());
	}

	let mut snapshots = Vec::new();
	let entries = fs::read_dir(&snapshots_dir).map_err(|error| {
		errors::snapshot_store_failed(format!("读取快照目录失败：{error}"))
	})?;

	for entry in entries {
		let entry = match entry {
			Ok(value) => value,
			Err(error) => {
				tracing::warn!(target: "ai.edit", error = %error, "skip unreadable snapshot entry");
				continue;
			}
		};
		let path = entry.path();
		if path.extension().and_then(|value| value.to_str()) != Some("json") {
			continue;
		}

		let Some((manifest, storage_key)) = read_manifest_from_path(storage_root, &path)? else {
			continue;
		};
		snapshots.push(manifest.into_payload(storage_key));
	}

	Ok(snapshots)
}

fn read_manifest_from_path(
	_storage_root: &Path,
	path: &Path,
) -> Result<Option<(SnapshotManifest, String)>, String> {
	let manifest_text = match fs::read_to_string(path) {
		Ok(value) => value,
		Err(error) => {
			tracing::warn!(target: "ai.edit", path = %path.display(), error = %error, "skip unreadable snapshot manifest");
			return Ok(None);
		}
	};
	let manifest = match serde_json::from_str::<SnapshotManifest>(&manifest_text) {
		Ok(value) => value,
		Err(error) => {
			tracing::warn!(target: "ai.edit", path = %path.display(), error = %error, "skip invalid snapshot manifest");
			return Ok(None);
		}
	};
	let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
		return Ok(None);
	};

	Ok(Some((manifest, format!("snapshots/{file_name}"))))
}

fn build_blob_key(content_hash: &str) -> String {
	format!("blobs/{}.txt", content_hash.replace(':', "-"))
}

fn join_storage_path(storage_root: &Path, relative_key: &str) -> PathBuf {
	relative_key
		.split('/')
		.fold(storage_root.to_path_buf(), |path, segment| path.join(segment))
}

impl SnapshotManifest {
	fn into_payload(self, storage_key: String) -> AiSnapshotPayload {
		AiSnapshotPayload {
			id: self.id,
			scope: self.scope,
			task_id: self.task_id,
			created_at: self.created_at,
			label: self.label,
			file_refs: self.files.into_iter().map(|file| file.path).collect(),
			storage_key,
			size_bytes: self.size_bytes,
		}
	}

	fn into_stored_snapshot(
		self,
		storage_root: &Path,
		storage_key: String,
	) -> Result<StoredSnapshot, String> {
		let mut files = Vec::with_capacity(self.files.len());
		for file in &self.files {
			let blob_path = join_storage_path(storage_root, &file.blob_key);
			let content = fs::read_to_string(&blob_path).map_err(|error| {
				errors::snapshot_store_failed(format!(
					"读取快照 blob 失败（{}）：{error}",
					blob_path.display()
				))
			})?;
			files.push(StoredSnapshotFile {
				path: file.path.clone(),
				content_hash: file.content_hash.clone(),
				content,
			});
		}

		Ok(StoredSnapshot {
			snapshot: self.into_payload(storage_key),
			files,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::{list_stored_snapshots, store_pre_tool_snapshot, SnapshotManifest, SnapshotSourceFile};
	use crate::commands::contracts::AiApplyPatchMetadataRequest;
	use std::fs;

	#[test]
	fn store_pre_tool_snapshot_writes_manifest_and_dedupes_blobs() {
		let temp_dir = std::env::temp_dir().join(format!(
			"aed-snapshot-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.expect("time should move forward")
				.as_nanos()
		));
		fs::create_dir_all(&temp_dir).expect("temp directory should be created");

		let snapshot = store_pre_tool_snapshot(
			&temp_dir,
			&[
				SnapshotSourceFile {
					path: "src/a.sh",
					content_hash: "fnv64:shared",
					content: "echo shared",
				},
				SnapshotSourceFile {
					path: "src/b.sh",
					content_hash: "fnv64:shared",
					content: "echo shared",
				},
			],
			Some(&AiApplyPatchMetadataRequest {
				task_id: Some("task-1".to_string()),
				turn_id: None,
				reason: Some("预快照".to_string()),
				tool_call_id: None,
				confirmed_by_user: None,
			}),
			"应用 AI Patch",
		)
		.expect("snapshot should be written");

		let manifest_path = temp_dir.join(snapshot.storage_key.replace('/', "\\"));
		let manifest = fs::read_to_string(&manifest_path).expect("manifest should exist");
		let manifest: SnapshotManifest =
			serde_json::from_str(&manifest).expect("manifest should be valid json");
		let blobs = fs::read_dir(temp_dir.join("blobs"))
			.expect("blobs directory should exist")
			.collect::<Result<Vec<_>, _>>()
			.expect("blob entries should be readable");

		assert_eq!(snapshot.scope, "pre-tool");
		assert_eq!(snapshot.task_id, "task-1");
		assert_eq!(snapshot.file_refs.len(), 2);
		assert_eq!(manifest.files.len(), 2);
		assert_eq!(blobs.len(), 1);

		let restored = list_stored_snapshots(&temp_dir).expect("snapshots should be listed");
		assert_eq!(restored.len(), 1);
		assert_eq!(restored[0].id, snapshot.id);

		let _ = fs::remove_dir_all(&temp_dir);
	}
}