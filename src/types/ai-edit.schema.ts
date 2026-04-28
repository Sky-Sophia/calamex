import { z } from 'zod';

import {
    AI_EDIT_AUTH_LEVELS,
    AI_EDIT_OPERATION_KINDS,
    AI_EDIT_REVERT_GRANULARITIES,
    AI_EDIT_SNAPSHOT_SCOPES,
    AI_EDIT_TIMELINE_ENTRY_TYPES,
} from '@/types/ai-edit';

/**
 * AED 授权等级 schema。
 */
export const aiEditAuthLevelSchema = z.enum(AI_EDIT_AUTH_LEVELS);

/**
 * AED 编辑操作类型 schema。
 */
export const aiEditOperationKindSchema = z.enum(AI_EDIT_OPERATION_KINDS);

/**
 * AED 快照作用域 schema。
 */
export const aiEditSnapshotScopeSchema = z.enum(AI_EDIT_SNAPSHOT_SCOPES);

/**
 * AED 时间线条目类型 schema。
 */
export const aiEditTimelineEntryTypeSchema = z.enum(AI_EDIT_TIMELINE_ENTRY_TYPES);

/**
 * AED 回滚粒度 schema。
 */
export const aiEditRevertGranularitySchema = z.enum(AI_EDIT_REVERT_GRANULARITIES);

/**
 * AED 单次编辑操作 schema。
 */
export const aiEditOperationSchema = z.object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    turnId: z.string().min(1),
    kind: aiEditOperationKindSchema,
    path: z.string().min(1),
    newPath: z.string().min(1).optional(),
    sourceSnapshotId: z.string().min(1).nullable().optional(),
    beforeHash: z.string().min(1).nullable(),
    afterHash: z.string().min(1).nullable(),
    bytesBefore: z.number().int().nonnegative().nullable(),
    bytesAfter: z.number().int().nonnegative().nullable(),
    appliedAt: z.string().min(1),
    reason: z.string().min(1),
    toolCallId: z.string().min(1).nullable(),
});

/**
 * AED 本地快照 schema。
 */
export const aiSnapshotSchema = z.object({
    id: z.string().min(1),
    scope: aiEditSnapshotScopeSchema,
    taskId: z.string().min(1),
    createdAt: z.string().min(1),
    label: z.string().min(1),
    fileRefs: z.array(z.string().min(1)),
    storageKey: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
});

/**
 * AED 时间线条目 schema。
 */
export const aiEditTimelineEntrySchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        data: aiSnapshotSchema,
    }),
    z.object({
        type: z.literal('operation'),
        data: aiEditOperationSchema,
    }),
]);

/**
 * AED 授权状态 schema。
 */
export const aiEditAuthStateSchema = z.object({
    level: aiEditAuthLevelSchema,
    taskId: z.string().min(1).nullable(),
    updatedAt: z.string().min(1),
});

/**
 * AED 设置授权等级请求 schema。
 */
export const aiEditSetAuthLevelRequestSchema = z.object({
    level: aiEditAuthLevelSchema,
    taskId: z.string().min(1).nullable().optional(),
});

/**
 * AED 时间线查询请求 schema。
 */
export const aiEditListTimelineRequestSchema = z.object({
    taskId: z.string().min(1).nullable().optional(),
    limit: z.number().int().positive().max(500).optional(),
});

/**
 * AED 时间线查询结果 schema。
 */
export const aiEditListTimelinePayloadSchema = z.object({
    entries: z.array(aiEditTimelineEntrySchema),
});

/**
 * AED 恢复快照请求 schema。
 */
export const aiEditRestoreSnapshotRequestSchema = z.object({
    snapshotId: z.string().min(1),
});

/**
 * AED 恢复快照结果 schema。
 */
export const aiEditRestoreSnapshotPayloadSchema = z.object({
    snapshotId: z.string().min(1),
    restoredFiles: z.array(z.string().min(1)),
    preRevertSnapshot: aiSnapshotSchema,
    restoredSnapshot: aiSnapshotSchema,
});

/**
 * AED 撤销单条编辑请求 schema。
 */
export const aiEditUndoOperationRequestSchema = z.object({
    operationId: z.string().min(1),
});

/**
 * AED 撤销单条编辑结果 schema。
 */
export const aiEditUndoOperationPayloadSchema = z.object({
    operationId: z.string().min(1),
    restoredFiles: z.array(z.string().min(1)),
    preRevertSnapshot: aiSnapshotSchema,
    restoredSnapshot: aiSnapshotSchema,
});

/**
 * AED 按任务回滚请求 schema。
 */
export const aiEditRevertTaskRequestSchema = z.object({
    taskId: z.string().min(1),
});

/**
 * AED 按任务回滚结果 schema。
 */
export const aiEditRevertTaskPayloadSchema = z.object({
    taskId: z.string().min(1),
    revertedOperationIds: z.array(z.string().min(1)),
    restoredFiles: z.array(z.string().min(1)),
    preRevertSnapshots: z.array(aiSnapshotSchema),
    restoredSnapshots: z.array(aiSnapshotSchema),
});

/**
 * AED 快照保留策略 schema。
 */
export const aiEditStorageBudgetSchema = z.object({
    maxTaskCount: z.number().int().positive(),
    maxRetentionDays: z.number().int().positive(),
    warnTaskSizeBytes: z.number().int().positive(),
});