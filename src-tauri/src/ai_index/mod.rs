//! 工作区文件索引（轻量级）模块。
//!
//! 当前实现是"按需 grep"：每次 [`query_index`] 都会重新走一遍工作区，并对
//! 文本文件做大小写不敏感的子串匹配。
//!
//! ## 安全过滤
//!
//! [`is_sensitive_path`] 会跳过敏感文件 / 构建产物。**已知限制**：当前实现
//! 是路径串的子串匹配，会对 `src/targeting.rs`、`src/distilled.rs` 等带有
//! `target` / `dist` 子串的普通源文件产生**误报**。若需精确匹配，请改走
//! `protected_paths::is_builtin_protected_path`（按目录段判定）。

use crate::ai::errors;
use crate::commands::contracts::{
    AiBuildIndexPayload, AiBuildIndexRequest, AiIndexResultPayload, AiQueryIndexPayload,
    AiQueryIndexRequest,
};
use ignore::WalkBuilder;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// 调参常量
// ============================================================================

/// 单个文件参与索引 / 查询的最大字节数；超过则跳过。
const MAX_INDEX_FILE_BYTES: u64 = 512 * 1024;
/// 单次 [`query_index`] 返回结果数的硬上限。
const MAX_QUERY_RESULTS: usize = 80;
/// 调用方未显式指定 `limit` 时使用的默认上限。
const DEFAULT_QUERY_LIMIT: usize = 30;
/// 命中文件路径时的得分。
const PATH_HIT_SCORE: u32 = 100;
/// 命中文件内容时的得分。
const CONTENT_HIT_SCORE: u32 = 80;
/// 单条结果 `preview` 字段裁剪到的最大字符数。
const CONTENT_PREVIEW_CHARS: usize = 240;

// ============================================================================
// 对外 API
// ============================================================================

/// 走一遍工作区目录，统计可被索引的文件数与被跳过的文件数。
///
/// 当前实现并不真正写出索引数据，仅返回 `(indexed, skipped)` 概览，真正的
/// 持久化索引由子模块各自负责。
pub fn build_index(payload: AiBuildIndexRequest) -> Result<AiBuildIndexPayload, String> {
    let root = validate_root(&payload.workspace_root_path)?;
    let mut indexed_file_count = 0usize;
    let mut skipped_file_count = 0usize;

    for entry in WalkBuilder::new(&root).hidden(false).build() {
        let Ok(entry) = entry else {
            skipped_file_count += 1;
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            skipped_file_count += 1;
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if metadata.len() > MAX_INDEX_FILE_BYTES || is_sensitive_path(entry.path()) {
            skipped_file_count += 1;
            continue;
        }
        indexed_file_count += 1;
    }

    Ok(AiBuildIndexPayload {
        root_path: root.to_string_lossy().to_string(),
        indexed_file_count,
        skipped_file_count,
    })
}

/// 在工作区中按 `query` 做大小写不敏感的子串查询。
///
/// - 文件路径命中得分 [`PATH_HIT_SCORE`]，文件内容命中得分 [`CONTENT_HIT_SCORE`]。
/// - `limit` 默认 [`DEFAULT_QUERY_LIMIT`]，硬上限 [`MAX_QUERY_RESULTS`]。
/// - 空查询直接返回空结果。
pub fn query_index(payload: AiQueryIndexRequest) -> Result<AiQueryIndexPayload, String> {
    let root = validate_root(&payload.workspace_root_path)?;
    let query = payload.query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(AiQueryIndexPayload {
            root_path: root.to_string_lossy().to_string(),
            results: Vec::new(),
        });
    }

    let limit = payload
        .limit
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .min(MAX_QUERY_RESULTS);
    let mut results: Vec<AiIndexResultPayload> = Vec::with_capacity(limit);

    for entry in WalkBuilder::new(&root).hidden(false).build() {
        if results.len() >= limit {
            break;
        }
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if !metadata.is_file() || metadata.len() > MAX_INDEX_FILE_BYTES || is_sensitive_path(path) {
            continue;
        }

        let relative_path = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();

        // 路径命中：直接收一条 PATH_HIT_SCORE 的结果。
        if relative_path.to_lowercase().contains(&query) {
            results.push(AiIndexResultPayload {
                path: path.to_string_lossy().to_string(),
                line_number: None,
                preview: relative_path,
                score: i64::from(PATH_HIT_SCORE),
            });
            continue;
        }

        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };

        // 整文件 lowercase 一次性早退：未命中直接跳过，避免对每一行都做
        // to_lowercase 分配。命中后再进入逐行扫描定位行号。
        if !content.to_lowercase().contains(&query) {
            continue;
        }

        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&query) {
                results.push(AiIndexResultPayload {
                    path: path.to_string_lossy().to_string(),
                    line_number: Some(index + 1),
                    preview: line.chars().take(CONTENT_PREVIEW_CHARS).collect(),
                    score: i64::from(CONTENT_HIT_SCORE),
                });
                break;
            }
        }
    }

    Ok(AiQueryIndexPayload {
        root_path: root.to_string_lossy().to_string(),
        results,
    })
}

// ============================================================================
// 内部辅助
// ============================================================================

/// 把用户传入的 root 解析为存在的、规范化后的绝对路径。
fn validate_root(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if !path.is_dir() {
        return Err(errors::error("AI_INDEX_NOT_READY", "工作区目录不可用。"));
    }
    path.canonicalize().map_err(|error| {
        errors::error(
            "AI_INDEX_BUILD_FAILED",
            format!("索引目录解析失败：{error}"),
        )
    })
}

/// 命中即跳过索引 / 查询的"敏感文件"启发式判定。
///
/// **已知限制**：当前用子串匹配，会对 `src/targeting.rs`、`src/distilled.rs`
/// 等带有 `target` / `dist` 子串的源文件产生**误报**。若需消除误报，请改为
/// 按路径段（`/`-分隔）做精确匹配，或复用
/// `protected_paths::is_builtin_protected_path`。
fn is_sensitive_path(path: &Path) -> bool {
    /// 任意一项作为子串出现在路径中即视为敏感。新增条目时追加一行即可。
    const SENSITIVE_FRAGMENTS: &[&str] = &[
        ".env",
        "id_rsa",
        "id_ed25519",
        ".pem",
        ".key",
        "node_modules",
        "target",
        "dist",
    ];

    let value = path.to_string_lossy().to_lowercase();
    SENSITIVE_FRAGMENTS
        .iter()
        .any(|fragment| value.contains(fragment))
}
