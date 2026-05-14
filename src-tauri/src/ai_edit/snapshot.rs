use crate::ai_edit::{atomic_write, errors, storage_lock};
use crate::commands::contracts::{AiApplyPatchMetadataRequest, AiSnapshotPayload};
use chrono::Utc;
use fjall::{Database, Keyspace, KeyspaceCreateOptions, PersistMode};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const AED_DB_DIR: &str = "fjall";
const SNAPSHOTS_KEYSPACE: &str = "snapshots";
const SNAPSHOT_BLOBS_KEYSPACE: &str = "snapshot_blobs";
const SNAPSHOT_SCOPE_PRE_TOOL: &str = "pre-tool";
const SNAPSHOT_SCOPE_TASK_START: &str = "task-start";
const SNAPSHOT_SCOPE_TURN_START: &str = "turn-start";
const SNAPSHOT_SCOPE_MANUAL: &str = "manual";
const SNAPSHOT_SCOPE_PRE_REVERT: &str = "pre-revert";
const SNAPSHOT_SCOPE_REVERT: &str = "revert";
const SNAPSHOT_MANIFEST_VERSION: u32 = 2;
const SMALL_BLOB_MAX_BYTES: usize = 256 * 1024;

#[derive(Debug, Default)]
pub struct SnapshotPruneOutcome {
    pub removed_snapshot_ids: HashSet<String>,
    pub removed_blob_count: usize,
    pub reclaimed_bytes: u64,
}

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

    store_snapshot(
        storage_root,
        SNAPSHOT_SCOPE_PRE_TOOL,
        &task_id,
        &label,
        files,
    )
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

    store_snapshot(
        storage_root,
        SNAPSHOT_SCOPE_TASK_START,
        &task_id,
        &label,
        files,
    )
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

    store_snapshot(
        storage_root,
        SNAPSHOT_SCOPE_TURN_START,
        &task_id,
        &label,
        files,
    )
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
    storage_lock::with_storage_read_lock(storage_root, "读取 AED 快照", || {
        load_stored_snapshot_locked(storage_root, snapshot_id)
    })
}

fn load_stored_snapshot_locked(
    storage_root: &Path,
    snapshot_id: &str,
) -> Result<StoredSnapshot, String> {
    let store = open_store(storage_root)?;
    let manifest = load_manifest(&store.snapshots, snapshot_id)?
        .ok_or_else(|| errors::snapshot_not_found(snapshot_id))?;
    manifest.into_stored_snapshot(storage_root, &store)
}

pub fn list_stored_snapshots(storage_root: &Path) -> Result<Vec<AiSnapshotPayload>, String> {
    storage_lock::with_storage_read_lock(storage_root, "读取 AED 快照列表", || {
        list_stored_snapshots_locked(storage_root)
    })
}

fn list_stored_snapshots_locked(storage_root: &Path) -> Result<Vec<AiSnapshotPayload>, String> {
    let store = open_store(storage_root)?;
    let mut snapshots = Vec::new();

    for item in store.snapshots.iter() {
        let (_key, value) = item.into_inner().map_err(|error| {
            errors::snapshot_store_failed(format!("读取 fjall 快照清单失败：{error}"))
        })?;

        match serde_json::from_slice::<SnapshotManifest>(&value) {
            Ok(manifest) => snapshots.push(manifest.into_payload()),
            Err(error) => {
                tracing::warn!(
                    target: "ai.edit",
                    error = %error,
                    "skip invalid fjall snapshot manifest"
                );
            }
        }
    }

    Ok(snapshots)
}

pub fn prune_stored_snapshots(
    storage_root: &Path,
    retained_snapshot_ids: &HashSet<String>,
) -> Result<SnapshotPruneOutcome, String> {
    storage_lock::with_storage_write_lock(storage_root, "裁剪 AED 快照", || {
        prune_stored_snapshots_locked(storage_root, retained_snapshot_ids)
    })
}

fn prune_stored_snapshots_locked(
    storage_root: &Path,
    retained_snapshot_ids: &HashSet<String>,
) -> Result<SnapshotPruneOutcome, String> {
    let store = open_store(storage_root)?;
    let manifests = list_manifests(&store.snapshots)?;
    let retained_blob_keys = manifests
        .iter()
        .filter(|manifest| retained_snapshot_ids.contains(&manifest.id))
        .flat_map(|manifest| manifest.files.iter().map(|file| file.blob_key.clone()))
        .collect::<HashSet<_>>();

    let mut blob_keys_to_remove = HashSet::new();
    let mut outcome = SnapshotPruneOutcome::default();
    let mut batch = store.db.batch();

    for manifest in manifests {
        if retained_snapshot_ids.contains(&manifest.id) {
            continue;
        }

        outcome.removed_snapshot_ids.insert(manifest.id.clone());
        outcome.reclaimed_bytes += serialized_manifest_len(&manifest)?;
        batch.remove(&store.snapshots, manifest.id.as_bytes().to_vec());

        for file in manifest.files {
            if !retained_blob_keys.contains(&file.blob_key) {
                blob_keys_to_remove.insert(file.blob_key);
            }
        }
    }

    if outcome.removed_snapshot_ids.is_empty() {
        return Ok(outcome);
    }

    for blob_key in blob_keys_to_remove {
        if retained_blob_keys.contains(&blob_key) {
            continue;
        }

        if let Some(fjall_key) = blob_key.strip_prefix("fjall:") {
            let removed_bytes = store
                .snapshot_blobs
                .size_of(fjall_key)
                .map_err(|error| {
                    errors::snapshot_store_failed(format!("读取 fjall blob 大小失败：{error}"))
                })?
                .unwrap_or_default() as u64;
            batch.remove(&store.snapshot_blobs, fjall_key.as_bytes().to_vec());
            if removed_bytes > 0 {
                outcome.removed_blob_count += 1;
                outcome.reclaimed_bytes += removed_bytes;
            }
            continue;
        }

        if let Some(relative_key) = blob_key.strip_prefix("cas:") {
            let removed_bytes = remove_storage_file(
                &join_storage_path(storage_root, relative_key),
                "删除 CAS blob 失败",
            )?;
            if removed_bytes > 0 {
                outcome.removed_blob_count += 1;
                outcome.reclaimed_bytes += removed_bytes;
            }
        }
    }

    batch
        .commit()
        .map_err(|error| errors::snapshot_store_failed(format!("裁剪 fjall 快照失败：{error}")))?;
    persist(&store.db)?;

    Ok(outcome)
}

fn store_snapshot(
    storage_root: &Path,
    scope: &str,
    task_id: &str,
    label: &str,
    files: &[SnapshotSourceFile<'_>],
) -> Result<AiSnapshotPayload, String> {
    storage_lock::with_storage_write_lock(storage_root, "写入 AED 快照", || {
        store_snapshot_locked(storage_root, scope, task_id, label, files)
    })
}

fn store_snapshot_locked(
    storage_root: &Path,
    scope: &str,
    task_id: &str,
    label: &str,
    files: &[SnapshotSourceFile<'_>],
) -> Result<AiSnapshotPayload, String> {
    let store = open_store(storage_root)?;
    let timestamp = Utc::now();
    let snapshot_id = format!(
        "ai-edit-snapshot-{}",
        timestamp
            .timestamp_nanos_opt()
            .unwrap_or_else(|| timestamp.timestamp_micros() * 1_000)
    );

    let mut manifest_files = Vec::with_capacity(files.len());
    let mut file_refs = Vec::with_capacity(files.len());
    let mut size_bytes = 0_u64;
    let mut batch = store.db.batch();

    for file in files {
        let blob_key = store_blob(storage_root, &store.snapshot_blobs, file, &mut batch)?;
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
    let manifest_json = serde_json::to_vec(&manifest)
        .map_err(|error| errors::snapshot_store_failed(format!("序列化快照清单失败：{error}")))?;
    batch.insert(
        &store.snapshots,
        snapshot_id.as_bytes().to_vec(),
        manifest_json,
    );
    batch
        .commit()
        .map_err(|error| errors::snapshot_store_failed(format!("写入 fjall 快照失败：{error}")))?;
    persist(&store.db)?;

    Ok(AiSnapshotPayload {
        id: snapshot_id,
        scope: scope.to_string(),
        task_id: task_id.to_string(),
        created_at: timestamp.to_rfc3339(),
        label: label.to_string(),
        file_refs,
        storage_key: manifest.storage_key(),
        size_bytes,
    })
}

fn store_blob(
    storage_root: &Path,
    snapshot_blobs: &Keyspace,
    file: &SnapshotSourceFile<'_>,
    batch: &mut fjall::OwnedWriteBatch,
) -> Result<String, String> {
    if file.content.len() <= SMALL_BLOB_MAX_BYTES {
        batch.insert(
            snapshot_blobs,
            file.content_hash.as_bytes().to_vec(),
            file.content.as_bytes().to_vec(),
        );
        return Ok(format!("fjall:{}", file.content_hash));
    }

    let relative_key = build_cas_blob_key(file.content_hash);
    let blob_path = join_storage_path(storage_root, &relative_key);
    if !blob_path.exists() {
        if let Some(parent) = blob_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                errors::snapshot_store_failed(format!("创建 CAS blob 目录失败：{error}"))
            })?;
        }
        atomic_write::write_bytes(&blob_path, file.content.as_bytes()).map_err(|error| {
            errors::snapshot_store_failed(format!("写入 CAS blob 失败：{error}"))
        })?;
    }

    Ok(format!("cas:{relative_key}"))
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

struct SnapshotStore {
    db: Database,
    snapshots: Keyspace,
    snapshot_blobs: Keyspace,
}

fn open_store(storage_root: &Path) -> Result<SnapshotStore, String> {
    let db = Database::builder(storage_root.join(AED_DB_DIR))
        .open()
        .map_err(|error| {
            errors::snapshot_store_failed(format!("打开 fjall AED 存储失败：{error}"))
        })?;
    let snapshots = db
        .keyspace(SNAPSHOTS_KEYSPACE, KeyspaceCreateOptions::default)
        .map_err(|error| {
            errors::snapshot_store_failed(format!("打开 snapshots keyspace 失败：{error}"))
        })?;
    let snapshot_blobs = db
        .keyspace(SNAPSHOT_BLOBS_KEYSPACE, KeyspaceCreateOptions::default)
        .map_err(|error| {
            errors::snapshot_store_failed(format!("打开 snapshot_blobs keyspace 失败：{error}"))
        })?;
    Ok(SnapshotStore {
        db,
        snapshots,
        snapshot_blobs,
    })
}

fn persist(db: &Database) -> Result<(), String> {
    db.persist(PersistMode::SyncAll)
        .map_err(|error| errors::snapshot_store_failed(format!("持久化 fjall 快照失败：{error}")))
}

fn load_manifest(
    snapshots: &Keyspace,
    snapshot_id: &str,
) -> Result<Option<SnapshotManifest>, String> {
    let Some(value) = snapshots.get(snapshot_id).map_err(|error| {
        errors::snapshot_store_failed(format!("读取 fjall 快照清单失败：{error}"))
    })?
    else {
        return Ok(None);
    };

    serde_json::from_slice::<SnapshotManifest>(&value)
        .map(Some)
        .map_err(|error| errors::snapshot_store_failed(format!("解析 fjall 快照清单失败：{error}")))
}

fn list_manifests(snapshots: &Keyspace) -> Result<Vec<SnapshotManifest>, String> {
    let mut manifests = Vec::new();
    for item in snapshots.iter() {
        let (_key, value) = item.into_inner().map_err(|error| {
            errors::snapshot_store_failed(format!("读取 fjall 快照清单失败：{error}"))
        })?;
        match serde_json::from_slice::<SnapshotManifest>(&value) {
            Ok(manifest) => manifests.push(manifest),
            Err(error) => {
                tracing::warn!(
                    target: "ai.edit",
                    error = %error,
                    "skip invalid fjall snapshot manifest during prune"
                );
            }
        }
    }
    Ok(manifests)
}

fn serialized_manifest_len(manifest: &SnapshotManifest) -> Result<u64, String> {
    serde_json::to_vec(manifest)
        .map(|value| value.len() as u64)
        .map_err(|error| errors::snapshot_store_failed(format!("序列化快照清单失败：{error}")))
}

fn build_cas_blob_key(content_hash: &str) -> String {
    let digest = content_hash
        .split_once(':')
        .map(|(_, value)| value)
        .unwrap_or(content_hash);
    let prefix = digest.chars().take(2).collect::<String>();
    let suffix = digest.chars().skip(2).collect::<String>();
    let suffix = if suffix.is_empty() { "blob" } else { &suffix };
    format!("blobs/{prefix}/{suffix}")
}

fn join_storage_path(storage_root: &Path, relative_key: &str) -> PathBuf {
    relative_key
        .split('/')
        .fold(storage_root.to_path_buf(), |path, segment| {
            path.join(segment)
        })
}

fn remove_storage_file(path: &Path, action: &str) -> Result<u64, String> {
    let removed_bytes = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(errors::snapshot_store_failed(format!(
                "{action}（{}）：{error}",
                path.display()
            )));
        }
    };

    fs::remove_file(path).map_err(|error| {
        errors::snapshot_store_failed(format!("{action}（{}）：{error}", path.display()))
    })?;

    Ok(removed_bytes)
}

impl SnapshotManifest {
    fn storage_key(&self) -> String {
        format!("fjall://snapshots/{}", self.id)
    }

    fn into_payload(self) -> AiSnapshotPayload {
        let storage_key = self.storage_key();
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
        store: &SnapshotStore,
    ) -> Result<StoredSnapshot, String> {
        let mut files = Vec::with_capacity(self.files.len());
        for file in &self.files {
            let content = read_blob(storage_root, &store.snapshot_blobs, &file.blob_key)?;
            files.push(StoredSnapshotFile {
                path: file.path.clone(),
                content_hash: file.content_hash.clone(),
                content,
            });
        }

        Ok(StoredSnapshot {
            snapshot: self.into_payload(),
            files,
        })
    }
}

fn read_blob(
    storage_root: &Path,
    snapshot_blobs: &Keyspace,
    blob_key: &str,
) -> Result<String, String> {
    if let Some(fjall_key) = blob_key.strip_prefix("fjall:") {
        let value = snapshot_blobs
            .get(fjall_key)
            .map_err(|error| {
                errors::snapshot_store_failed(format!("读取 fjall blob 失败：{error}"))
            })?
            .ok_or_else(|| errors::snapshot_store_failed("快照 blob 不存在。"))?;
        return String::from_utf8(value.to_vec()).map_err(|error| {
            errors::snapshot_store_failed(format!("快照 blob 不是 UTF-8：{error}"))
        });
    }

    let Some(relative_key) = blob_key.strip_prefix("cas:") else {
        return Err(errors::snapshot_store_failed("快照 blob key 格式无效。"));
    };
    fs::read_to_string(join_storage_path(storage_root, relative_key))
        .map_err(|error| errors::snapshot_store_failed(format!("读取 CAS blob 失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::{
        list_stored_snapshots, load_stored_snapshot, prune_stored_snapshots, store_manual_snapshot,
        store_pre_tool_snapshot, SnapshotSourceFile,
    };
    use crate::commands::contracts::AiApplyPatchMetadataRequest;
    use std::collections::HashSet;
    use std::fs;

    #[test]
    fn store_pre_tool_snapshot_writes_manifest_and_dedupes_small_blobs_in_fjall() {
        let temp_dir = temp_dir("aed-snapshot");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");

        let snapshot = store_pre_tool_snapshot(
            &temp_dir,
            &[
                SnapshotSourceFile {
                    path: "src/a.sh",
                    content_hash: "blake3:shared",
                    content: "echo shared",
                },
                SnapshotSourceFile {
                    path: "src/b.sh",
                    content_hash: "blake3:shared",
                    content: "echo shared",
                },
            ],
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-1".to_string()),
                turn_id: None,
                reason: Some("预快照".to_string()),
                tool_call_id: None,
                confirmed_by_user: None,
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
            }),
            "应用 AI Patch",
        )
        .expect("snapshot should be written");

        let restored = list_stored_snapshots(&temp_dir).expect("snapshots should be listed");
        let stored = load_stored_snapshot(&temp_dir, &snapshot.id).expect("snapshot should load");

        assert_eq!(snapshot.scope, "pre-tool");
        assert_eq!(snapshot.task_id, "task-1");
        assert_eq!(snapshot.file_refs.len(), 2);
        assert!(snapshot.storage_key.starts_with("fjall://snapshots/"));
        assert_eq!(restored.len(), 1);
        assert_eq!(stored.files.len(), 2);
        assert_eq!(stored.files[0].content, "echo shared");
        assert!(!temp_dir.join("snapshots").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn store_manual_snapshot_uses_manual_scope() {
        let temp_dir = temp_dir("aed-manual-snapshot");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");

        let snapshot = store_manual_snapshot(
            &temp_dir,
            &[SnapshotSourceFile {
                path: "src/main.ts",
                content_hash: "blake3:manual",
                content: "console.log('manual');",
            }],
            Some(&AiApplyPatchMetadataRequest {
                task_id: Some("task-manual".to_string()),
                turn_id: None,
                reason: Some("Pin checkpoint".to_string()),
                tool_call_id: None,
                confirmed_by_user: Some(true),
                agent_run_id: None,
                agent_step_id: None,
                workspace_root_path: None,
            }),
            "Pin checkpoint",
        )
        .expect("manual snapshot should be written");

        let restored = list_stored_snapshots(&temp_dir).expect("snapshots should be listed");

        assert_eq!(snapshot.scope, "manual");
        assert_eq!(snapshot.task_id, "task-manual");
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].scope, "manual");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn large_snapshot_blob_uses_cas_directory() {
        let temp_dir = temp_dir("aed-large-snapshot");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");
        let large_content = "x".repeat(super::SMALL_BLOB_MAX_BYTES + 1);

        let snapshot = store_manual_snapshot(
            &temp_dir,
            &[SnapshotSourceFile {
                path: "src/large.sh",
                content_hash: "blake3:largeblob",
                content: &large_content,
            }],
            None,
            "large",
        )
        .expect("large snapshot should be written");

        let stored = load_stored_snapshot(&temp_dir, &snapshot.id).expect("snapshot should load");
        assert_eq!(stored.files[0].content, large_content);
        assert!(temp_dir.join("blobs").is_dir());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn prune_stored_snapshots_removes_old_manifests_and_orphan_blobs() {
        let temp_dir = temp_dir("aed-prune-snapshots");
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");

        let first = store_manual_snapshot(
            &temp_dir,
            &[SnapshotSourceFile {
                path: "src/one.sh",
                content_hash: "blake3:shared",
                content: "echo shared",
            }],
            None,
            "first",
        )
        .expect("first snapshot should be written");
        std::thread::sleep(std::time::Duration::from_millis(1));

        let second = store_manual_snapshot(
            &temp_dir,
            &[SnapshotSourceFile {
                path: "src/two.sh",
                content_hash: "blake3:unique",
                content: "echo unique",
            }],
            None,
            "second",
        )
        .expect("second snapshot should be written");
        std::thread::sleep(std::time::Duration::from_millis(1));

        let third = store_manual_snapshot(
            &temp_dir,
            &[SnapshotSourceFile {
                path: "src/three.sh",
                content_hash: "blake3:shared",
                content: "echo shared",
            }],
            None,
            "third",
        )
        .expect("third snapshot should be written");

        let retained_snapshot_ids = HashSet::from([third.id.clone()]);
        let outcome = prune_stored_snapshots(&temp_dir, &retained_snapshot_ids)
            .expect("snapshots should be pruned");

        let snapshots = list_stored_snapshots(&temp_dir).expect("snapshots should be listed");

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].id, third.id);
        assert!(outcome.removed_snapshot_ids.contains(&first.id));
        assert!(outcome.removed_snapshot_ids.contains(&second.id));
        assert_eq!(outcome.removed_blob_count, 1);
        assert!(outcome.reclaimed_bytes > 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ))
    }
}
