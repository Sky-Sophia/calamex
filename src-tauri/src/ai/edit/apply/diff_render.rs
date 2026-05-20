//! AED 行级 diff 与 hunk 反向应用工具。
//!
//! 设计要点：
//! - `render_patch_hunks` 基于 `diffy-imara` 生成标准 unified diff hunk。
//! - `apply_reverse_hunk` 将单个 hunk 转为 `diffy-imara` patch 后反向作用到「应用后」文本上。
//! - 当前生产路径只支持单 hunk 回滚；批量回滚由 operation/snapshot 层处理。
//! - 行号约定：1-based；`old_lines = 0` 表示纯插入，`new_lines = 0` 表示纯删除。

use crate::commands::contracts::AiPatchHunkPayload;
use diffy_imara::{DiffOptions, Line, Patch};

const NO_NEWLINE_AT_EOF: &str = "\\ No newline at end of file";

#[derive(Debug, Clone)]
pub struct RenderedDiff {
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<AiPatchHunkPayload>,
}

/// 渲染 before → after 的行级 diff。
pub fn render_patch_hunks(before: &str, after: &str) -> RenderedDiff {
    let mut additions = 0u32;
    let mut deletions = 0u32;
    let mut hunks = Vec::new();

    let mut options = DiffOptions::new();
    options.set_context_len(0);
    let patch = options.create_patch(before, after);

    for hunk in patch.hunks() {
        let old_range = hunk.old_range();
        let new_range = hunk.new_range();
        let mut lines = Vec::new();

        for line in hunk.lines() {
            match line {
                Line::Context(value) => push_payload_line(&mut lines, ' ', value),
                Line::Delete(value) => {
                    deletions += 1;
                    push_payload_line(&mut lines, '-', value);
                }
                Line::Insert(value) => {
                    additions += 1;
                    push_payload_line(&mut lines, '+', value);
                }
            }
        }

        hunks.push(AiPatchHunkPayload {
            old_start: old_range.start() as u32,
            old_lines: old_range.len() as u32,
            new_start: new_range.start() as u32,
            new_lines: new_range.len() as u32,
            lines,
        });
    }

    RenderedDiff {
        additions,
        deletions,
        hunks,
    }
}

pub fn render_unified_diff_text(before_path: &str, after_path: &str, before: &str, after: &str) -> String {
    let mut options = DiffOptions::new();
    options.set_context_len(3);
    let patch = options.create_patch(before, after);
    let mut text = String::new();
    text.push_str(&format!("--- {before_path}\n"));
    text.push_str(&format!("+++ {after_path}\n"));
    text.push_str(&patch.to_string());
    text
}

/// 将单个 hunk 反向作用到「应用后」文本上，恢复对应区段为 before 状态。
///
/// 严格校验：当前文件 `[new_start, new_start + new_lines)` 区段必须与 hunk
/// 中的 `+` 行完全一致，否则报错而不是静默写坏。
pub fn apply_reverse_hunk(after: &str, hunk: &AiPatchHunkPayload) -> Result<String, String> {
    ensure_hunk_matches_after_segment(after, hunk)?;
    let patch_text = build_single_hunk_patch(hunk)?;
    let patch = Patch::from_str(&patch_text).map_err(|error| format!("解析 hunk 失败：{error}"))?;
    diffy_imara::apply(after, &patch.reverse())
        .map_err(|error| format!("当前文件片段与目标 hunk 不一致：{error}"))
}

fn ensure_hunk_matches_after_segment(after: &str, hunk: &AiPatchHunkPayload) -> Result<(), String> {
    let lines = split_text_lines(after);
    let start = hunk_start_to_index(hunk.new_start);
    let end = start.saturating_add(hunk.new_lines as usize);

    if start > lines.len() {
        return Err(format!("hunk 起点越界：start={start}, len={}", lines.len()));
    }
    if end > lines.len() {
        return Err(format!(
            "hunk 范围越界：start={start}, end={end}, len={}",
            lines.len()
        ));
    }

    let expected_new_lines = hunk
        .lines
        .iter()
        .filter_map(|line| match line.as_str() {
            NO_NEWLINE_AT_EOF => None,
            _ => line
                .strip_prefix(' ')
                .or_else(|| line.strip_prefix('+'))
                .map(ToOwned::to_owned),
        })
        .collect::<Vec<_>>();

    if expected_new_lines.len() != hunk.new_lines as usize {
        return Err(format!(
            "hunk 自身不一致：new_lines={}，但应用后行数={}",
            hunk.new_lines,
            expected_new_lines.len()
        ));
    }

    if &lines[start..end] != expected_new_lines.as_slice() {
        return Err("当前文件片段与目标 hunk 不一致。".to_string());
    }

    Ok(())
}

fn split_text_lines(value: &str) -> Vec<String> {
    if value.is_empty() {
        return Vec::new();
    }
    value.split('\n').map(ToOwned::to_owned).collect()
}

fn hunk_start_to_index(start: u32) -> usize {
    start.saturating_sub(1) as usize
}

fn build_single_hunk_patch(hunk: &AiPatchHunkPayload) -> Result<String, String> {
    let mut patch = String::from("--- original\n+++ modified\n");
    patch.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
    ));

    for line in &hunk.lines {
        validate_patch_line(line)?;
        patch.push_str(line);
        patch.push('\n');
    }

    Ok(patch)
}

fn validate_patch_line(line: &str) -> Result<(), String> {
    if line.contains('\n') {
        return Err("hunk 行不能包含换行符。".to_string());
    }
    if line == NO_NEWLINE_AT_EOF {
        return Ok(());
    }
    if matches!(line.as_bytes().first(), Some(b' ' | b'+' | b'-')) {
        return Ok(());
    }
    Err("hunk 行必须以空格、+ 或 - 开头。".to_string())
}

fn push_payload_line(lines: &mut Vec<String>, prefix: char, value: &str) {
    lines.push(format!("{prefix}{}", strip_diffy_line(value)));
    if !value.ends_with('\n') {
        lines.push(NO_NEWLINE_AT_EOF.to_string());
    }
}

fn strip_diffy_line(value: &str) -> &str {
    value.strip_suffix('\n').unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::{apply_reverse_hunk, render_patch_hunks};

    #[test]
    fn render_patch_hunks_splits_multiple_change_groups() {
        let rendered = render_patch_hunks(
            "line-1\nline-2\nline-3\nline-4",
            "line-1\nline-2-updated\nline-3\nline-4-updated",
        );
        assert!(rendered.hunks.len() >= 2);
        assert_eq!(rendered.additions, 2);
        assert_eq!(rendered.deletions, 2);
        assert_eq!(rendered.hunks[0].old_start, 2);
        assert!(rendered.hunks.iter().any(|hunk| hunk.old_start == 4));
    }

    #[test]
    fn apply_reverse_hunk_restores_selected_segment() {
        let rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        let reverted =
            apply_reverse_hunk("a\nB\nc", &rendered.hunks[0]).expect("reverse hunk should apply");
        assert_eq!(reverted, "a\nb\nc");
    }

    #[test]
    fn empty_before_pure_insert_round_trip() {
        let before = "";
        let after = "a\nb";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.additions, 2);
        assert_eq!(rendered.deletions, 0);
        assert_eq!(rendered.hunks.len(), 1);

        let reverted = apply_reverse_hunk(after, &rendered.hunks[0]).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn pure_delete_to_empty_round_trip() {
        let before = "a\nb";
        let after = "";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.additions, 0);
        assert_eq!(rendered.deletions, 2);
        assert_eq!(rendered.hunks.len(), 1);

        let reverted = apply_reverse_hunk(after, &rendered.hunks[0]).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn trailing_newline_is_preserved() {
        let before = "a\nb\n";
        let after = "a\nB\n";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 1);
        let reverted = apply_reverse_hunk(after, &rendered.hunks[0]).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn apply_reverse_hunk_detects_drift() {
        let rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        // 文件已经被进一步改动，应该拒绝撤销而不是静默写坏。
        let drifted = "a\nX\nc";
        let err = apply_reverse_hunk(drifted, &rendered.hunks[0])
            .expect_err("should refuse to apply on drifted file");
        assert!(err.contains("不一致"));
    }

    #[test]
    fn pure_insertion_hunk_reverse() {
        let before = "a\nc";
        let after = "a\nb\nc";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 1);
        assert_eq!(rendered.hunks[0].old_lines, 0);
        assert_eq!(rendered.hunks[0].new_lines, 1);

        let reverted = apply_reverse_hunk(after, &rendered.hunks[0]).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn pure_deletion_hunk_reverse() {
        let before = "a\nb\nc";
        let after = "a\nc";
        let rendered = render_patch_hunks(before, after);
        assert_eq!(rendered.hunks.len(), 1);
        assert_eq!(rendered.hunks[0].old_lines, 1);
        assert_eq!(rendered.hunks[0].new_lines, 0);

        let reverted = apply_reverse_hunk(after, &rendered.hunks[0]).expect("reverse ok");
        assert_eq!(reverted, before);
    }

    #[test]
    fn out_of_bounds_hunk_is_rejected() {
        let mut rendered = render_patch_hunks("a\nb\nc", "a\nB\nc");
        // 故意把 new_start 推到越界位置。
        rendered.hunks[0].new_start = 999;
        let err = apply_reverse_hunk("a\nB\nc", &rendered.hunks[0])
            .expect_err("should reject out-of-bounds");
        assert!(err.contains("不一致") || err.contains("解析 hunk 失败") || err.contains("越界"));
    }
}
