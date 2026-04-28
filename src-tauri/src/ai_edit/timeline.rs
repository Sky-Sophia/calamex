use crate::commands::contracts::{AiEditListTimelineRequest, AiEditTimelineEntryPayload};

/// 未显式指定 `request.limit` 时的默认条数上限。
const DEFAULT_LIMIT: usize = 200;

/// 按时间戳倒序返回 AED 时间线条目，可按 `task_id` 过滤、按 `limit` 截断。
///
/// - 排序键为 [`entry_timestamp`] 返回的 ISO-8601 字符串，只要写入端使用同一
///   格式（RFC3339），字典序即等价于时间倒序。
/// - `request.task_id` 为空时不做过滤；非空时同时匹配 `Snapshot.task_id` 与
///   `Operation.task_id`。
/// - 函数实现先以引用过滤、再排序、最后仅克隆落入结果的条目，避免对最终
///   被丢弃的条目做多余的 `clone`。
pub fn list_entries(
    request: AiEditListTimelineRequest,
    entries: &[AiEditTimelineEntryPayload],
) -> Vec<AiEditTimelineEntryPayload> {
    // 直接借用 request 中的 task_id，避免多余 String 分配；request 在整个
    // 函数体内被持有，借用安全有效。
    let requested_task_id = request.task_id.as_deref();
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT as _) as usize;

    if limit == 0 {
        return Vec::new();
    }

    let mut filtered: Vec<&AiEditTimelineEntryPayload> = entries
        .iter()
        .filter(|entry| matches_task_id(requested_task_id, entry))
        .collect();

    // 倒序：右值在前 -> 字典序最大者排在最前，对 ISO-8601 等价于时间最近者优先。
    filtered.sort_by(|left, right| entry_timestamp(right).cmp(entry_timestamp(left)));

    filtered.into_iter().take(limit).cloned().collect()
}

/// 当 `requested` 为 `None` 时直接放行；否则对应取出 `task_id` 字段做精确匹配。
fn matches_task_id(requested: Option<&str>, entry: &AiEditTimelineEntryPayload) -> bool {
    let Some(task_id) = requested else {
        return true;
    };
    match entry {
        AiEditTimelineEntryPayload::Snapshot(snapshot) => snapshot.task_id == task_id,
        AiEditTimelineEntryPayload::Operation(operation) => operation.task_id == task_id,
    }
}

/// 取出条目用于排序的时间戳字段：快照用 `created_at`、操作用 `applied_at`。
fn entry_timestamp(entry: &AiEditTimelineEntryPayload) -> &str {
    match entry {
        AiEditTimelineEntryPayload::Snapshot(snapshot) => &snapshot.created_at,
        AiEditTimelineEntryPayload::Operation(operation) => &operation.applied_at,
    }
}