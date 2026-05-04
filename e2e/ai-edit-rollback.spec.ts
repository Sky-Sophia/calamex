import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

type IAedCommandCall = {
    command: string;
    args: unknown;
};

declare global {
    interface Window {
        __AED_E2E__?: {
            calls: IAedCommandCall[];
        };
        __TAURI_EVENT_PLUGIN_INTERNALS__?: {
            unregisterListener: (event: string, eventId: number) => void;
        };
        __TAURI_INTERNALS__?: {
            invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
            transformCallback?: (callback: unknown, once?: boolean) => number;
            unregisterCallback?: (id: number) => void;
            metadata?: {
                currentWindow: {
                    label: string;
                };
            };
        };
    }
}

const installAedRuntimeMock = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
        const timestamp = '2026-04-28T00:00:00.000Z';
        const taskId = 'task-aed';
        const filePath = 'workspace/script.sh';

        const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
        const createSnapshot = (id: string, label: string, scope: string) => ({
            id,
            scope,
            taskId,
            createdAt: timestamp,
            label,
            fileRefs: [filePath],
            storageKey: `snapshots/${id}.json`,
            sizeBytes: 128,
        });
        const toSnapshotEntry = (id: string, label: string, scope: string) => ({
            type: 'snapshot',
            data: createSnapshot(id, label, scope),
        });
        const operationEntry = {
            type: 'operation',
            data: {
                id: 'op-1',
                taskId,
                turnId: 'turn-1',
                kind: 'modify',
                path: filePath,
                sourceSnapshotId: 'snapshot-task-start',
                beforeHash: 'fnv64:before',
                afterHash: 'fnv64:after',
                bytesBefore: 27,
                bytesAfter: 43,
                appliedAt: timestamp,
                reason: '更新 Shell 脚本',
                toolCallId: null,
            },
        };
        const state = {
            authState: {
                level: 'session',
                taskId: null,
                updatedAt: timestamp,
            },
            calls: [] as IAedCommandCall[],
            nextCallbackId: 1,
            nextListenerId: 1,
            nextSnapshotSerial: 1,
            callbacks: new Map<number, unknown>(),
            timelineEntries: [
                clone(operationEntry),
                toSnapshotEntry('snapshot-task-start', 'Task start', 'task-start'),
            ],
            diffByPath: {
                [filePath]: {
                    taskId,
                    path: filePath,
                    operationId: 'op-1',
                    kind: 'modify',
                    additions: 2,
                    deletions: 2,
                    hunks: [
                        {
                            hunkIndex: 0,
                            oldStart: 2,
                            oldLines: 1,
                            newStart: 2,
                            newLines: 1,
                            lines: ['-line-2', '+line-2-updated'],
                        },
                        {
                            hunkIndex: 1,
                            oldStart: 4,
                            oldLines: 1,
                            newStart: 4,
                            newLines: 1,
                            lines: ['-line-4', '+line-4-updated'],
                        },
                    ],
                },
            } as Record<string, {
                taskId: string;
                path: string;
                operationId: string;
                kind: 'modify';
                additions: number;
                deletions: number;
                hunks: Array<{
                    hunkIndex: number;
                    oldStart: number;
                    oldLines: number;
                    newStart: number;
                    newLines: number;
                    lines: string[];
                }>;
            }>,
        };

        const recountDiff = (path: string): void => {
            const diff = state.diffByPath[path];
            if (!diff) {
                return;
            }

            diff.additions = diff.hunks
                .flatMap((hunk) => hunk.lines)
                .filter((line) => line.startsWith('+')).length;
            diff.deletions = diff.hunks
                .flatMap((hunk) => hunk.lines)
                .filter((line) => line.startsWith('-')).length;
        };

        const prependSnapshot = (label: string, scope: string) => {
            const id = `snapshot-${scope}-${state.nextSnapshotSerial++}`;
            const entry = toSnapshotEntry(id, label, scope);
            state.timelineEntries = [entry, ...state.timelineEntries];
            return entry.data;
        };

        window.localStorage.setItem(
            'shell-ide.ai-conversation',
            JSON.stringify({
                activeThreadId: taskId,
                threads: [
                    {
                        id: taskId,
                        title: 'AED 验收',
                        updatedAt: timestamp,
                        createdAt: timestamp,
                        messages: [
                            {
                                id: 'msg-1',
                                role: 'user',
                                content: '验收 AED rollback',
                                createdAt: timestamp,
                                references: [],
                            },
                        ],
                    },
                ],
            }),
        );

        window.__AED_E2E__ = {
            calls: state.calls,
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
            unregisterListener: () => undefined,
        };
        window.__TAURI_INTERNALS__ = {
            metadata: {
                currentWindow: {
                    label: 'main',
                },
            },
            transformCallback: (callback: unknown) => {
                const id = state.nextCallbackId++;
                state.callbacks.set(id, callback);
                return id;
            },
            unregisterCallback: (id: number) => {
                state.callbacks.delete(id);
            },
            invoke: async (command: string, args?: Record<string, unknown>) => {
                const payload = args && typeof args === 'object' && 'payload' in args
                    ? args.payload
                    : undefined;
                state.calls.push({
                    command,
                    args: clone(args ?? null),
                });

                switch (command) {
                    case 'plugin:event|listen':
                        return state.nextListenerId++;
                    case 'plugin:event|unlisten':
                        return null;
                    case 'plugin:window|is_maximized':
                        return false;
                    case 'plugin:window|start_resize_dragging':
                    case 'plugin:window|toggle_maximize':
                    case 'plugin:window|minimize':
                    case 'plugin:window|close':
                        return null;
                    case 'detect_execution_environment':
                        return {
                            recommended: 'wsl',
                            hasAny: true,
                            executors: [
                                {
                                    type: 'wsl',
                                    label: 'WSL',
                                    available: true,
                                    description: 'Windows Subsystem for Linux',
                                    commandPath: '/bin/bash',
                                },
                            ],
                        };
                    case 'ai_get_config':
                        return {
                            providerType: 'mock',
                            selectedModel: null,
                            baseUrl: null,
                            isBaseUrlConfigured: false,
                            hasCredentials: false,
                            isConfigured: false,
                            inlineCompletionEnabled: false,
                            chatEnabled: true,
                            agentEnabled: true,
                        };
                    case 'ai_list_tools':
                        return [];
                    case 'ai_edit_get_auth_level':
                        return clone(state.authState);
                    case 'ai_edit_set_auth_level': {
                        const nextLevel = payload && typeof payload === 'object' && 'level' in payload
                            ? payload.level
                            : 'manual';
                        const nextTaskId = payload && typeof payload === 'object' && 'taskId' in payload
                            ? payload.taskId
                            : null;
                        state.authState = {
                            level: typeof nextLevel === 'string' ? nextLevel : 'manual',
                            taskId: typeof nextTaskId === 'string' ? nextTaskId : null,
                            updatedAt: timestamp,
                        };
                        return clone(state.authState);
                    }
                    case 'ai_edit_list_timeline': {
                        const request = payload && typeof payload === 'object' ? payload : {};
                        const entries = request && 'taskId' in request && typeof request.taskId === 'string'
                            ? state.timelineEntries.filter((entry) => entry.data.taskId === request.taskId)
                            : state.timelineEntries;
                        return {
                            entries: clone(entries),
                        };
                    }
                    case 'ai_edit_create_snapshot': {
                        const label = payload && typeof payload === 'object' && 'label' in payload && typeof payload.label === 'string' && payload.label.trim()
                            ? payload.label
                            : 'Pin checkpoint';
                        const snapshot = prependSnapshot(label, 'manual');
                        return { snapshot };
                    }
                    case 'ai_edit_get_diff': {
                        const path = payload && typeof payload === 'object' && 'path' in payload && typeof payload.path === 'string'
                            ? payload.path
                            : filePath;
                        return clone(state.diffByPath[path]);
                    }
                    case 'ai_edit_revert_hunk': {
                        const path = payload && typeof payload === 'object' && 'path' in payload && typeof payload.path === 'string'
                            ? payload.path
                            : filePath;
                        const hunkIndex = payload && typeof payload === 'object' && 'hunkIndex' in payload && typeof payload.hunkIndex === 'number'
                            ? payload.hunkIndex
                            : 0;
                        const diff = state.diffByPath[path];
                        diff.hunks = diff.hunks.filter((hunk) => hunk.hunkIndex !== hunkIndex);
                        recountDiff(path);
                        const preRevertSnapshot = prependSnapshot(`按 hunk 回滚前 · #${hunkIndex + 1}`, 'pre-revert');
                        const restoredSnapshot = prependSnapshot(`按 hunk 回滚后 · #${hunkIndex + 1}`, 'revert');
                        return {
                            taskId,
                            path,
                            operationId: 'op-1',
                            hunkIndex,
                            restoredFiles: [path],
                            preRevertSnapshot,
                            restoredSnapshot,
                        };
                    }
                    case 'ai_edit_revert_file': {
                        const path = payload && typeof payload === 'object' && 'path' in payload && typeof payload.path === 'string'
                            ? payload.path
                            : filePath;
                        state.diffByPath[path] = {
                            ...state.diffByPath[path],
                            additions: 0,
                            deletions: 0,
                            hunks: [],
                        };
                        const preRevertSnapshot = prependSnapshot('按文件回滚前', 'pre-revert');
                        const restoredSnapshot = prependSnapshot('按文件回滚后', 'revert');
                        return {
                            taskId,
                            path,
                            operationId: 'op-1',
                            restoredFiles: [path],
                            preRevertSnapshot,
                            restoredSnapshot,
                        };
                    }
                    case 'ai_edit_undo_operation': {
                        const operationId = payload && typeof payload === 'object' && 'operationId' in payload && typeof payload.operationId === 'string'
                            ? payload.operationId
                            : 'op-1';
                        state.timelineEntries = state.timelineEntries.filter(
                            (entry) => entry.type !== 'operation' || entry.data.id !== operationId,
                        );
                        const preRevertSnapshot = prependSnapshot('撤销前快照', 'pre-revert');
                        const restoredSnapshot = prependSnapshot('撤销后快照', 'revert');
                        return {
                            operationId,
                            restoredFiles: [filePath],
                            preRevertSnapshot,
                            restoredSnapshot,
                        };
                    }
                    case 'ai_edit_restore_snapshot': {
                        const snapshotId = payload && typeof payload === 'object' && 'snapshotId' in payload && typeof payload.snapshotId === 'string'
                            ? payload.snapshotId
                            : 'snapshot-manual';
                        const preRevertSnapshot = prependSnapshot('恢复前快照', 'pre-revert');
                        const restoredSnapshot = prependSnapshot('恢复后快照', 'revert');
                        return {
                            snapshotId,
                            restoredFiles: [filePath],
                            preRevertSnapshot,
                            restoredSnapshot,
                        };
                    }
                    case 'ai_edit_revert_task': {
                        state.timelineEntries = state.timelineEntries.filter((entry) => entry.type === 'snapshot');
                        state.diffByPath[filePath] = {
                            ...state.diffByPath[filePath],
                            additions: 0,
                            deletions: 0,
                            hunks: [],
                        };
                        const preRevertSnapshot = prependSnapshot('任务回滚前', 'pre-revert');
                        const restoredSnapshot = prependSnapshot('任务回滚后', 'revert');
                        return {
                            taskId,
                            revertedOperationIds: ['op-1'],
                            restoredFiles: [filePath],
                            preRevertSnapshots: [preRevertSnapshot],
                            restoredSnapshots: [restoredSnapshot],
                        };
                    }
                    default:
                        if (command.startsWith('plugin:window|')) {
                            return null;
                        }

                        throw new Error(`Unhandled mock Tauri command: ${command}`);
                }
            },
        };
    });
};

const openAiAssistantPanel = async (page: Page): Promise<void> => {
    await page.goto('/');
    const aiToggle = page.getByRole('button', { name: 'AI 助手' });
    await expect(aiToggle).toBeVisible({ timeout: 45_000 });
    await aiToggle.click();
    await expect(page.locator('section[aria-label="AI 助手面板"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('section[aria-label="AED 时间线"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('workspace/script.sh')).toBeVisible({ timeout: 10_000 });
};

const getAedCommandCalls = async (page: Page): Promise<IAedCommandCall[]> =>
    page.evaluate(() => window.__AED_E2E__?.calls ?? []);

test.beforeEach(async ({ page }) => {
    await installAedRuntimeMock(page);
});

test('AED 时间线支持 checkpoint、恢复快照与撤销单条编辑', async ({ page }) => {
    await openAiAssistantPanel(page);

    await page.getByRole('button', { name: 'Pin checkpoint' }).click();
    await expect(page.getByText('Pin checkpoint')).toHaveCount(2);

    const checkpointEntry = page.locator('.ai-edit-timeline__entry').filter({
        hasText: 'Pin checkpoint',
    }).first();
    await checkpointEntry.getByRole('button', { name: '恢复' }).click();
    await page.getByRole('button', { name: '确认恢复' }).click();

    const operationEntry = page.locator('.ai-edit-timeline__entry').filter({
        hasText: 'workspace/script.sh',
    }).first();
    await operationEntry.getByRole('button', { name: '撤销' }).click();
    await page.getByRole('button', { name: '确认撤销' }).click();

    await expect(page.getByText('workspace/script.sh')).toHaveCount(0);

    const calls = await getAedCommandCalls(page);
    expect(calls.map((call) => call.command)).toEqual(
        expect.arrayContaining([
            'ai_edit_create_snapshot',
            'ai_edit_restore_snapshot',
            'ai_edit_undo_operation',
        ]),
    );
});

test('AED 时间线支持 diff 预览、hunk 回滚、文件回滚与任务回滚', async ({ page }) => {
    await openAiAssistantPanel(page);

    const operationEntry = page.locator('.ai-edit-timeline__entry').filter({
        hasText: 'workspace/script.sh',
    }).first();
    await operationEntry.getByRole('button', { name: '查看 Diff' }).click();

    await expect(page.getByText('Diff Preview')).toBeVisible();
    await expect(page.getByText('Hunk #1')).toBeVisible();
    await expect(page.getByText('Hunk #2')).toBeVisible();

    await page.getByRole('button', { name: /Revert hunk/ }).first().click();
    await expect(page.getByText('Hunk #1')).toHaveCount(0);
    await expect(page.getByText('Hunk #2')).toBeVisible();

    await page.getByRole('button', { name: '回滚整个文件' }).click();
    await page.getByRole('button', { name: '确认回滚文件' }).click();
    await expect(page.getByText('当前文件没有剩余 diff')).toBeVisible();

    await page.getByRole('button', { name: '回滚当前任务' }).click();
    await page.getByRole('button', { name: '确认回滚' }).click();
    await expect(page.getByText('workspace/script.sh')).toHaveCount(0);

    const calls = await getAedCommandCalls(page);
    expect(calls.map((call) => call.command)).toEqual(
        expect.arrayContaining([
            'ai_edit_get_diff',
            'ai_edit_revert_hunk',
            'ai_edit_revert_file',
            'ai_edit_revert_task',
        ]),
    );
});