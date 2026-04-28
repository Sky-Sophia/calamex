import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiRevert } from './useAiRevert';

const tauriServiceMock = vi.hoisted(() => ({
    aiEditGetAuthLevel: vi.fn(),
    aiEditSetAuthLevel: vi.fn(),
    aiEditListTimeline: vi.fn(),
    aiEditRevertTask: vi.fn(),
    aiEditRestoreSnapshot: vi.fn(),
    aiEditUndoOperation: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
    tauriService: tauriServiceMock,
}));

describe('useAiRevert', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('restoreSnapshot 调用 AED 恢复接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRestoreSnapshot.mockResolvedValueOnce({
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
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.restoreSnapshot('snapshot-1');

        expect(result.status).toBe('success');
        expect(revert.canRestoreSnapshot.value).toBe(true);
        expect(tauriServiceMock.aiEditRestoreSnapshot).toHaveBeenCalledWith({
            snapshotId: 'snapshot-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({});
    });

    it('undoOperation 调用 AED 撤销接口并刷新时间线', async () => {
        tauriServiceMock.aiEditUndoOperation.mockResolvedValueOnce({
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
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.undoOperation('operation-1');

        expect(result.status).toBe('success');
        expect(revert.canUndo.value).toBe(true);
        expect(tauriServiceMock.aiEditUndoOperation).toHaveBeenCalledWith({
            operationId: 'operation-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({});
    });

    it('revertTask 调用 AED 任务回滚接口并刷新时间线', async () => {
        tauriServiceMock.aiEditRevertTask.mockResolvedValueOnce({
            taskId: 'task-1',
            revertedOperationIds: ['operation-2', 'operation-1'],
            restoredFiles: ['src/main.ts', 'src/lib.ts'],
            preRevertSnapshots: [
                {
                    id: 'snapshot-pre-revert-1',
                    scope: 'pre-revert',
                    taskId: 'task-1',
                    createdAt: '2026-04-28T10:00:00.000Z',
                    label: '撤销前快照 1',
                    fileRefs: ['src/main.ts'],
                    storageKey: 'snapshots/pre-revert-1.json',
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
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({ entries: [] });

        const revert = useAiRevert();
        const result = await revert.revertTask('task-1');

        expect(result.status).toBe('success');
        expect(tauriServiceMock.aiEditRevertTask).toHaveBeenCalledWith({
            taskId: 'task-1',
        });
        expect(tauriServiceMock.aiEditListTimeline).toHaveBeenCalledWith({});
    });
});