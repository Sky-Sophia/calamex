import { aiEditService } from '@/services/ipc/ai-edit.service';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiEditStore } from './aiEdit';

const tauriServiceMock = vi.hoisted(() => ({
    aiEditGetAuthLevel: vi.fn(),
    aiEditSetAuthLevel: vi.fn(),
    aiEditListTimeline: vi.fn(),
    aiEditRestoreSnapshot: vi.fn(),
    aiEditUndoOperation: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
    tauriService: tauriServiceMock,
}));

describe('AED service and store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('service 通过统一 tauriService 读取授权状态', async () => {
        tauriServiceMock.aiEditGetAuthLevel.mockResolvedValueOnce({
            level: 'manual',
            taskId: null,
            updatedAt: '2026-04-28T10:00:00.000Z',
        });

        await expect(aiEditService.getAuthLevel()).resolves.toEqual({
            level: 'manual',
            taskId: null,
            updatedAt: '2026-04-28T10:00:00.000Z',
        });
    });

    it('store 可以加载授权状态并派生 auto-apply 标志', async () => {
        tauriServiceMock.aiEditGetAuthLevel.mockResolvedValueOnce({
            level: 'per_task',
            taskId: 'task-1',
            updatedAt: '2026-04-28T10:00:00.000Z',
        });

        const store = useAiEditStore();
        await store.loadAuthState();

        expect(store.authState.level).toBe('per_task');
        expect(store.isAutoApplyEnabled).toBe(true);
    });

    it('store 可以加载时间线条目', async () => {
        tauriServiceMock.aiEditListTimeline.mockResolvedValueOnce({
            entries: [
                {
                    type: 'snapshot',
                    data: {
                        id: 'snapshot-1',
                        scope: 'task-start',
                        taskId: 'task-1',
                        createdAt: '2026-04-28T10:00:00.000Z',
                        label: '任务开始',
                        fileRefs: ['src/main.ts'],
                        storageKey: 'sha256:test',
                        sizeBytes: 64,
                    },
                },
            ],
        });

        const store = useAiEditStore();
        await store.loadTimeline({ taskId: 'task-1' });

        expect(store.timelineEntries).toHaveLength(1);
        expect(store.hasTimelineEntries).toBe(true);
    });
});
