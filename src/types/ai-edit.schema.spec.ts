import {
    aiEditAuthStateSchema,
    aiEditListTimelinePayloadSchema,
    aiEditRestoreSnapshotPayloadSchema,
    aiEditRestoreSnapshotRequestSchema,
    aiEditRevertTaskPayloadSchema,
    aiEditRevertTaskRequestSchema,
    aiEditSetAuthLevelRequestSchema,
    aiEditStorageBudgetSchema,
    aiEditTimelineEntrySchema,
    aiEditUndoOperationPayloadSchema,
    aiEditUndoOperationRequestSchema,
} from '@/types/ai-edit.schema'
import { describe, expect, it } from 'vitest'

describe('aiEditTimelineEntrySchema', () => {
    it('接受 snapshot 条目', () => {
        const parsed = aiEditTimelineEntrySchema.parse({
            type: 'snapshot',
            data: {
                id: '01JTESTSNAPSHOT',
                scope: 'task-start',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '任务开始',
                fileRefs: ['src/main.ts'],
                storageKey: 'sha256:abc',
                sizeBytes: 128,
            },
        })

        expect(parsed.type).toBe('snapshot')
        // 👇 用 if 窄化，TS 就知道 data 是 SnapshotData
        if (parsed.type !== 'snapshot') throw new Error('expected snapshot')
        expect(parsed.data.taskId).toBe('task-1')
    })

    it('接受 operation 条目', () => {
        const parsed = aiEditTimelineEntrySchema.parse({
            type: 'operation',
            data: {
                id: '01JTESTOPERATION',
                taskId: 'task-1',
                turnId: 'turn-1',
                kind: 'modify',
                path: 'src/main.ts',
                sourceSnapshotId: 'snapshot-1',
                beforeHash: 'sha256:before',
                afterHash: 'sha256:after',
                bytesBefore: 32,
                bytesAfter: 48,
                appliedAt: '2026-04-28T10:00:01.000Z',
                reason: '补齐 AED 写盘契约',
                toolCallId: 'tool-1',
            },
        })

        expect(parsed.type).toBe('operation')
        if (parsed.type !== 'operation') throw new Error('expected operation')
        expect(parsed.data.path).toBe('src/main.ts')
    })

    it('拒绝类型与 payload 不匹配的条目', () => {
        expect(() =>
            aiEditTimelineEntrySchema.parse({
                type: 'snapshot',
                data: {
                    id: '01JTESTBROKEN',
                    taskId: 'task-1',
                    turnId: 'turn-1',
                    kind: 'modify',
                    path: 'src/main.ts',
                    beforeHash: 'sha256:before',
                    afterHash: 'sha256:after',
                    bytesBefore: 32,
                    bytesAfter: 48,
                    appliedAt: '2026-04-28T10:00:01.000Z',
                    reason: 'invalid',
                    toolCallId: 'tool-1',
                },
            }),
        ).toThrow()
    })
})

describe('aiEditAuthStateSchema', () => {
    it('接受 session 授权状态', () => {
        const parsed = aiEditAuthStateSchema.parse({
            level: 'session',
            taskId: null,
            updatedAt: '2026-04-28T10:00:00.000Z',
        })
        expect(parsed.level).toBe('session')
    })

    it('接受 per_task 授权请求', () => {
        const parsed = aiEditSetAuthLevelRequestSchema.parse({
            level: 'per_task',
            taskId: 'task-1',
        });

        expect(parsed.level).toBe('per_task');
        expect(parsed.taskId).toBe('task-1');
    });
})

describe('aiEditStorageBudgetSchema', () => {
    it('拒绝非正数预算值', () => {
        expect(() =>
            aiEditStorageBudgetSchema.parse({
                maxTaskCount: 0,
                maxRetentionDays: 14,
                warnTaskSizeBytes: 1024,
            }),
        ).toThrow()
    })
})

describe('aiEditListTimelinePayloadSchema', () => {
    it('接受空时间线结果', () => {
        const parsed = aiEditListTimelinePayloadSchema.parse({
            entries: [],
        });

        expect(parsed.entries).toHaveLength(0);
    });
});

describe('aiEditRestoreSnapshot schemas', () => {
    it('接受 restore snapshot 请求', () => {
        const parsed = aiEditRestoreSnapshotRequestSchema.parse({
            snapshotId: 'snapshot-1',
        });

        expect(parsed.snapshotId).toBe('snapshot-1');
    });

    it('接受 restore snapshot 结果', () => {
        const parsed = aiEditRestoreSnapshotPayloadSchema.parse({
            snapshotId: 'snapshot-1',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '恢复前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: '恢复到快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert.json',
                sizeBytes: 64,
            },
        });

        expect(parsed.restoredFiles).toHaveLength(1);
        expect(parsed.restoredSnapshot.scope).toBe('revert');
    });
});

describe('aiEditUndoOperation schemas', () => {
    it('接受 undo operation 请求', () => {
        const parsed = aiEditUndoOperationRequestSchema.parse({
            operationId: 'operation-1',
        });

        expect(parsed.operationId).toBe('operation-1');
    });

    it('接受 undo operation 结果', () => {
        const parsed = aiEditUndoOperationPayloadSchema.parse({
            operationId: 'operation-1',
            restoredFiles: ['src/main.ts'],
            preRevertSnapshot: {
                id: 'snapshot-pre-revert',
                scope: 'pre-revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:00.000Z',
                label: '撤销前快照',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/pre-revert.json',
                sizeBytes: 64,
            },
            restoredSnapshot: {
                id: 'snapshot-revert',
                scope: 'revert',
                taskId: 'task-1',
                createdAt: '2026-04-28T10:00:01.000Z',
                label: '撤销编辑',
                fileRefs: ['src/main.ts'],
                storageKey: 'snapshots/revert.json',
                sizeBytes: 64,
            },
        });

        expect(parsed.operationId).toBe('operation-1');
        expect(parsed.restoredSnapshot.scope).toBe('revert');
    });
});

describe('aiEditRevertTask schemas', () => {
    it('接受 revert task 请求', () => {
        const parsed = aiEditRevertTaskRequestSchema.parse({
            taskId: 'task-1',
        });

        expect(parsed.taskId).toBe('task-1');
    });

    it('接受 revert task 结果', () => {
        const parsed = aiEditRevertTaskPayloadSchema.parse({
            taskId: 'task-1',
            revertedOperationIds: ['operation-2', 'operation-1'],
            restoredFiles: ['src/main.ts', 'src/lib.ts'],
            preRevertSnapshots: [
                {
                    id: 'snapshot-pre-1',
                    scope: 'pre-revert',
                    taskId: 'task-1',
                    createdAt: '2026-04-28T10:00:00.000Z',
                    label: '撤销前快照 1',
                    fileRefs: ['src/main.ts'],
                    storageKey: 'snapshots/pre-1.json',
                    sizeBytes: 64,
                },
            ],
            restoredSnapshots: [
                {
                    id: 'snapshot-revert-1',
                    scope: 'revert',
                    taskId: 'task-1',
                    createdAt: '2026-04-28T10:00:01.000Z',
                    label: '撤销后快照 1',
                    fileRefs: ['src/main.ts'],
                    storageKey: 'snapshots/revert-1.json',
                    sizeBytes: 64,
                },
            ],
        });

        expect(parsed.taskId).toBe('task-1');
        expect(parsed.revertedOperationIds).toHaveLength(2);
        expect(parsed.restoredSnapshots[0].scope).toBe('revert');
    });
});