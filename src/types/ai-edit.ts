/**
 * AED 授权等级。
 */
export const AI_EDIT_AUTH_LEVELS = ['manual', 'per_task', 'session'] as const;

/**
 * AED 授权等级字面量类型。
 */
export type TAiEditAuthLevel = (typeof AI_EDIT_AUTH_LEVELS)[number];

/**
 * AED 编辑操作类型。
 */
export const AI_EDIT_OPERATION_KINDS = ['modify', 'create', 'delete', 'rename'] as const;

/**
 * AED 编辑操作字面量类型。
 */
export type TAiEditOperationKind = (typeof AI_EDIT_OPERATION_KINDS)[number];

/**
 * AED 快照作用域。
 *
 * `pre-revert` 与 `revert` 用于覆盖回滚前后的反向快照路径。
 */
export const AI_EDIT_SNAPSHOT_SCOPES = [
    'turn-start',
    'task-start',
    'pre-tool',
    'manual',
    'pre-revert',
    'revert',
] as const;

/**
 * AED 快照作用域字面量类型。
 */
export type TAiEditSnapshotScope = (typeof AI_EDIT_SNAPSHOT_SCOPES)[number];

/**
 * AED 时间线条目类型。
 */
export const AI_EDIT_TIMELINE_ENTRY_TYPES = ['snapshot', 'operation'] as const;

/**
 * AED 时间线条目字面量类型。
 */
export type TAiEditTimelineEntryType = (typeof AI_EDIT_TIMELINE_ENTRY_TYPES)[number];

/**
 * AED 回滚粒度类型。
 */
export const AI_EDIT_REVERT_GRANULARITIES = [
    'edit',
    'task',
    'snapshot',
    'file',
    'hunk',
] as const;

/**
 * AED 回滚粒度字面量类型。
 */
export type TAiEditRevertGranularity = (typeof AI_EDIT_REVERT_GRANULARITIES)[number];

/**
 * AED 单次编辑操作元数据。
 */
export interface IAiEditOperation {
    id: string;
    taskId: string;
    turnId: string;
    kind: TAiEditOperationKind;
    path: string;
    newPath?: string;
    sourceSnapshotId?: string | null;
    beforeHash: string | null;
    afterHash: string | null;
    bytesBefore: number | null;
    bytesAfter: number | null;
    appliedAt: string;
    reason: string;
    toolCallId: string | null;
}

/**
 * AED 本地快照元数据。
 */
export interface IAiSnapshot {
    id: string;
    scope: TAiEditSnapshotScope;
    taskId: string;
    createdAt: string;
    label: string;
    fileRefs: string[];
    storageKey: string;
    sizeBytes: number;
}

/**
 * AED 时间线条目。
 */
export interface IAiEditTimelineEntry {
    type: TAiEditTimelineEntryType;
    data: IAiSnapshot | IAiEditOperation;
}

/**
 * AED 授权状态。
 */
export interface IAiEditAuthState {
    level: TAiEditAuthLevel;
    taskId: string | null;
    updatedAt: string;
}

/**
 * AED 设置授权等级请求。
 */
export interface IAiEditSetAuthLevelRequest {
    level: TAiEditAuthLevel;
    taskId?: string | null;
}

/**
 * AED 时间线查询请求。
 */
export interface IAiEditListTimelineRequest {
    taskId?: string | null;
    limit?: number;
}

/**
 * AED 时间线查询结果。
 */
export interface IAiEditListTimelinePayload {
    entries: IAiEditTimelineEntry[];
}

/**
 * AED 恢复快照请求。
 */
export interface IAiEditRestoreSnapshotRequest {
    snapshotId: string;
}

/**
 * AED 恢复快照结果。
 */
export interface IAiEditRestoreSnapshotPayload {
    snapshotId: string;
    restoredFiles: string[];
    preRevertSnapshot: IAiSnapshot;
    restoredSnapshot: IAiSnapshot;
}

/**
 * AED 撤销单条编辑请求。
 */
export interface IAiEditUndoOperationRequest {
    operationId: string;
}

/**
 * AED 撤销单条编辑结果。
 */
export interface IAiEditUndoOperationPayload {
    operationId: string;
    restoredFiles: string[];
    preRevertSnapshot: IAiSnapshot;
    restoredSnapshot: IAiSnapshot;
}

/**
 * AED 按任务回滚请求。
 */
export interface IAiEditRevertTaskRequest {
    taskId: string;
}

/**
 * AED 按任务回滚结果。
 */
export interface IAiEditRevertTaskPayload {
    taskId: string;
    revertedOperationIds: string[];
    restoredFiles: string[];
    preRevertSnapshots: IAiSnapshot[];
    restoredSnapshots: IAiSnapshot[];
}

/**
 * AED 快照保留策略。
 */
export interface IAiEditStorageBudget {
    maxTaskCount: number;
    maxRetentionDays: number;
    warnTaskSizeBytes: number;
}

/**
 * AED 快照保留策略默认值。
 */
export const DEFAULT_AI_EDIT_STORAGE_BUDGET: IAiEditStorageBudget = {
    maxTaskCount: 50,
    maxRetentionDays: 14,
    warnTaskSizeBytes: 256 * 1024 * 1024,
};