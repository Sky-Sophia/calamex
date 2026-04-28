use crate::ai_edit::errors;
use crate::commands::contracts::AiEditOperationPayload;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

/// 操作日志在 storage_root 下的相对目录。
const OPERATIONS_DIR: &str = "operations";
/// 操作日志文件名。NDJSON 格式，一行一条 [`AiEditOperationPayload`]。
const JOURNAL_FILE: &str = "journal.ndjson";

/// 计算操作日志文件在指定 storage_root 下的绝对路径。
/// 唯一的路径派生入口，避免目录与文件路径出现不一致的事实源。
fn journal_path(storage_root: &Path) -> PathBuf {
    storage_root.join(OPERATIONS_DIR).join(JOURNAL_FILE)
}

/// 把若干条操作以 NDJSON 形式追加到操作日志文件。
///
/// - 空切片直接返回 `Ok(())`，不触发任何 I/O。
/// - 文件以 append 模式打开，调用结束前会显式 `flush`。
/// - 任意一步失败均返回 [`errors::journal_failed`] 包装的错误，调用方可继续向上传递。
pub fn append_operations(
    storage_root: &Path,
    operations: &[AiEditOperationPayload],
) -> Result<(), String> {
    if operations.is_empty() {
        return Ok(());
    }

    let path = journal_path(storage_root);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            errors::journal_failed(format!("创建 operations 目录失败：{error}"))
        })?;
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            errors::journal_failed(format!(
                "打开操作日志失败（{}）：{error}",
                path.display()
            ))
        })?;

    let mut writer = BufWriter::new(file);

    for operation in operations {
        serde_json::to_writer(&mut writer, operation).map_err(|error| {
            errors::journal_failed(format!("序列化操作日志失败：{error}"))
        })?;
        writer.write_all(b"\n").map_err(|error| {
            errors::journal_failed(format!(
                "写入操作日志失败（{}）：{error}",
                path.display()
            ))
        })?;
    }

    // 显式 flush，避免 BufWriter 在 drop 时吞掉错误。
    writer.flush().map_err(|error| {
        errors::journal_failed(format!(
            "写入操作日志失败（{}）：{error}",
            path.display()
        ))
    })
}

/// 读取并反序列化整份操作日志。
///
/// - 日志不存在或路径不是普通文件时返回空集合。
/// - 单行不可读或解析失败仅 `tracing::warn!` 并跳过，不影响其他行。
pub fn list_operations(storage_root: &Path) -> Result<Vec<AiEditOperationPayload>, String> {
    let path = journal_path(storage_root);

    if !path.is_file() {
        return Ok(Vec::new());
    }

    let file = match File::open(&path) {
        Ok(file) => file,
        // is_file 与 open 之间存在被并发清理的竞态窗口，按空日志处理。
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(errors::journal_failed(format!(
                "读取操作日志失败（{}）：{error}",
                path.display()
            )));
        }
    };

    let reader = BufReader::new(file);
    let mut operations = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(
                    target: "ai.edit",
                    path = %path.display(),
                    error = %error,
                    "skip unreadable journal line"
                );
                continue;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<AiEditOperationPayload>(&line) {
            Ok(operation) => operations.push(operation),
            Err(error) => {
                tracing::warn!(
                    target: "ai.edit",
                    path = %path.display(),
                    error = %error,
                    "skip invalid operation journal line"
                );
            }
        }
    }

    Ok(operations)
}

#[cfg(test)]
mod tests {
    use super::{append_operations, list_operations};
    use crate::commands::contracts::AiEditOperationPayload;
    use std::fs;

    #[test]
    fn append_and_list_operations_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!(
            "aed-edit-journal-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).expect("temp directory should be created");

        append_operations(
            &temp_dir,
            &[AiEditOperationPayload {
                id: "operation-1".to_string(),
                task_id: "task-1".to_string(),
                turn_id: "turn-1".to_string(),
                kind: "modify".to_string(),
                path: "src/main.ts".to_string(),
                new_path: None,
                source_snapshot_id: Some("snapshot-1".to_string()),
                before_hash: Some("fnv64:before".to_string()),
                after_hash: Some("fnv64:after".to_string()),
                bytes_before: Some(32),
                bytes_after: Some(48),
                applied_at: "2026-04-28T10:00:01.000Z".to_string(),
                reason: "测试日志".to_string(),
                tool_call_id: None,
            }],
        )
        .expect("operations should be appended");

        let operations = list_operations(&temp_dir).expect("operations should be listed");

        assert_eq!(operations.len(), 1);
        assert_eq!(operations[0].id, "operation-1");
        assert_eq!(operations[0].source_snapshot_id.as_deref(), Some("snapshot-1"));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}