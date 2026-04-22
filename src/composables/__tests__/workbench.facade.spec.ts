/**
 * T-2.2 特征化测试：workbench façade 快照
 * 目的：拆分前锁定 useWorkbench 对外可观察行为，作为 T-2.6 的安全网。
 * 约束：MUST NOT 依赖真实 Tauri / Monaco / xterm。
 */
import { useAppStore } from '@/store/app';
import { useEditorStore } from '@/store/editor';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { useWorkbench } from '../useWorkbench';

// ─────────────────────────────────────────────
// Mock 变量（vi.hoisted 保证提升前可访问）
// ─────────────────────────────────────────────
const {
    mockTauriService,
    mockDialogConfirm,
    mockMessages,
    mockAppWindow,
} = vi.hoisted(() => ({
    mockTauriService: {
        detectEnvironment: vi.fn(),
        getStartupWorkspace: vi.fn(),
        listWorkspaceEntries: vi.fn(),
        loadScript: vi.fn(),
        saveScript: vi.fn(),
        pickOpenPath: vi.fn(),
        pickOpenFolderPath: vi.fn(),
        pickSavePath: vi.fn(),
        dispatchScriptToTerminal: vi.fn(),
        ensureTerminalSession: vi.fn(),
        writeTerminalInput: vi.fn(),
        resizeTerminalSession: vi.fn(),
    },
    mockDialogConfirm: vi.fn<[], Promise<'confirm' | 'cancel' | 'dismiss'>>(),
    mockMessages: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    },
    mockAppWindow: { close: vi.fn(() => Promise.resolve()) },
}));

vi.mock('@/services/tauri', () => ({
    tauriService: mockTauriService,
}));

// ─────────────────────────────────────────────
// Mock：useDialog（覆盖事件系统）
// ─────────────────────────────────────────────
vi.mock('@/composables/useDialog', () => ({
    useDialog: () => ({ confirm: mockDialogConfirm }),
    dismissDialog: vi.fn(),
}));

// ─────────────────────────────────────────────
// Mock：useMessage（避免 jsdom CustomEvent 噪音）
// ─────────────────────────────────────────────
vi.mock('@/composables/useMessage', () => ({
    useMessage: () => mockMessages,
}));

// ─────────────────────────────────────────────
// Mock：desktop-runtime（始终返回 true）
// ─────────────────────────────────────────────
vi.mock('@/utils/desktop-runtime', () => ({
    waitForDesktopRuntime: vi.fn(() => Promise.resolve(true)),
    desktopRuntimeReady: { value: true },
}));

// ─────────────────────────────────────────────
// Mock：Tauri window（避免真实窗口操作）
// ─────────────────────────────────────────────
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => mockAppWindow),
}));

// ─────────────────────────────────────────────
// Mock：window-close 工具
// ─────────────────────────────────────────────
vi.mock('@/utils/window-close', () => ({
    allowNextProgrammaticWindowClose: vi.fn(),
    clearProgrammaticWindowCloseAllowance: vi.fn(),
}));

// ─────────────────────────────────────────────
// Mock：shfmt（格式化 wasm，动态导入）
// ─────────────────────────────────────────────
vi.mock('@/utils/shfmt', () => ({
    formatShellScript: vi.fn((source: string) => Promise.resolve(source)),
}));

// ─────────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────────
describe('useWorkbench 特征化快照', () => {
    let scope: EffectScope;
    let workbench: ReturnType<typeof useWorkbench>;
    let editorStore: ReturnType<typeof useEditorStore>;
    let appStore: ReturnType<typeof useAppStore>;

    beforeEach(() => {
        setActivePinia(createPinia());

        scope = effectScope();
        scope.run(() => {
            workbench = useWorkbench();
        });

        editorStore = useEditorStore();
        appStore = useAppStore();

        // 关闭 formatOnSave，隔离 shfmt 动态导入
        appStore.settings.editor.formatOnSave = false;

        vi.clearAllMocks();
    });

    afterEach(() => {
        scope.stop();
    });

    // ── 1. canRun / canSave 计算属性 ──
    describe('canRun / canSave 计算属性', () => {
        it('无活动文档时 canRun 为 false', () => {
            expect(workbench.canRun.value).toBe(false);
        });

        it('无活动文档时 canSave 为 false', () => {
            expect(workbench.canSave.value).toBe(false);
        });

        it('文档内容为空时 canRun 为 false', () => {
            editorStore.createDocumentTab({ content: '' });
            expect(workbench.canRun.value).toBe(false);
        });

        it('有内容但无可用环境时 canRun 为 false', () => {
            editorStore.createDocumentTab({ content: '#!/bin/bash\necho hi' });
            editorStore.setEnvironment({ hasAny: false, executors: [], recommended: 'wsl' });
            expect(workbench.canRun.value).toBe(false);
        });

        it('有文本文档时 canSave 为 true', () => {
            editorStore.createDocumentTab({ content: '#!/bin/bash\necho hi' });
            expect(workbench.canSave.value).toBe(true);
        });

        it('有内容且有可用环境时 canRun 为 true', () => {
            editorStore.createDocumentTab({ content: '#!/bin/bash\necho hi' });
            editorStore.setEnvironment({ hasAny: true, executors: [], recommended: 'wsl' });
            expect(workbench.canRun.value).toBe(true);
        });
    });

    // ── 2. createNewDocument ──
    describe('createNewDocument()', () => {
        it('调用后文档数量增加 1', () => {
            expect(editorStore.documents.length).toBe(0);
            workbench.createNewDocument();
            expect(editorStore.documents.length).toBe(1);
        });

        it('新文档以默认 shebang 开头', () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0];
            expect(doc?.content.startsWith('#!/usr/bin/env bash')).toBe(true);
        });

        it('严格模式默认开启时包含 set -euo pipefail', () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0];
            expect(doc?.content).toContain('set -euo pipefail');
        });
    });

    // ── 3. requestCloseDocument ──
    describe('requestCloseDocument()', () => {
        it('关闭干净文档时不显示对话框', async () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0]!;

            await workbench.requestCloseDocument(doc.id);

            expect(mockDialogConfirm).not.toHaveBeenCalled();
            expect(editorStore.documents.length).toBe(0);
        });

        it('关闭脏文档时显示对话框', async () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0]!;
            editorStore.updateDocumentContent(doc.id, doc.content + '\n# dirty');

            mockDialogConfirm.mockResolvedValueOnce('cancel' as 'confirm' | 'cancel' | 'dismiss');
            await workbench.requestCloseDocument(doc.id);

            expect(mockDialogConfirm).toHaveBeenCalledOnce();
            expect(editorStore.documents.length).toBe(0);
        });

        it('脏文档对话框选取消时不关闭', async () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0]!;
            editorStore.updateDocumentContent(doc.id, doc.content + '\n# dirty');

            mockDialogConfirm.mockResolvedValueOnce('dismiss' as 'confirm' | 'cancel' | 'dismiss');
            await workbench.requestCloseDocument(doc.id);

            expect(editorStore.documents.length).toBe(1);
        });
    });

    // ── 4. saveDocument ──
    describe('saveDocument()', () => {
        it('已有路径时调用 tauriService.saveScript 并返回 true', async () => {
            editorStore.openDocumentTab({
                path: '/home/test/script.sh',
                name: 'script.sh',
                content: '#!/bin/bash\necho hi',
                encoding: 'utf-8',
            });
            const doc = editorStore.documents[0]!;
            editorStore.updateDocumentContent(doc.id, '#!/bin/bash\necho updated');

            mockTauriService.saveScript.mockResolvedValueOnce({
                path: '/home/test/script.sh',
                name: 'script.sh',
                content: '#!/bin/bash\necho updated',
                encoding: 'utf-8',
                isDirty: false,
            });

            const result = await workbench.saveDocument(doc.id);

            expect(result).toBe(true);
            expect(mockTauriService.saveScript).toHaveBeenCalledOnce();
        });
    });

    // ── 5. runScript ──
    describe('runScript()', () => {
        it('canRun=false 时发出 warning 且 isRunning 保持 false', async () => {
            await workbench.runScript();
            expect(mockMessages.warning).toHaveBeenCalledOnce();
            expect(editorStore.isRunning).toBe(false);
        });

        it('canRun=true 时 dispatch 后 isRunning 为 true', async () => {
            editorStore.createDocumentTab({ content: '#!/bin/bash\necho hi' });
            editorStore.setEnvironment({ hasAny: true, executors: [], recommended: 'wsl' });

            mockTauriService.dispatchScriptToTerminal.mockResolvedValueOnce({
                sessionId: 'main-terminal',
                cwd: '/home',
                commandLine: 'bash /tmp/script.sh',
                usedTempFile: true,
                startedAt: new Date().toISOString(),
            });

            await workbench.runScript();

            expect(editorStore.isRunning).toBe(true);
            expect(mockTauriService.dispatchScriptToTerminal).toHaveBeenCalledOnce();
        });
    });

    // ── 6. handleIntegratedTerminalRunComplete ──
    describe('handleIntegratedTerminalRunComplete()', () => {
        it('runId 匹配时清除 isRunning 并写入运行历史', async () => {
            editorStore.createDocumentTab({ content: '#!/bin/bash\necho hi' });
            editorStore.setEnvironment({ hasAny: true, executors: [], recommended: 'wsl' });

            let capturedRunId = '';
            mockTauriService.dispatchScriptToTerminal.mockImplementation(
                (req: { runId: string }) => {
                    capturedRunId = req.runId;
                    return Promise.resolve({
                        sessionId: 'main-terminal',
                        cwd: '/home',
                        commandLine: 'bash /tmp/script.sh',
                        usedTempFile: true,
                        startedAt: new Date().toISOString(),
                    });
                },
            );

            await workbench.runScript();

            const finishedAt = new Date().toISOString();
            workbench.handleIntegratedTerminalRunComplete({
                sessionId: 'main-terminal',
                runId: capturedRunId,
                exitCode: 0,
                finishedAt,
            });

            expect(editorStore.isRunning).toBe(false);
            expect(editorStore.runHistory.length).toBe(1);
            expect(editorStore.runHistory[0]?.exitCode).toBe(0);
        });
    });

    // ── 7. toggleTheme ──
    describe('toggleTheme()', () => {
        it('从 dark 切换为 light', () => {
            appStore.applyTheme('dark');
            workbench.toggleTheme();
            expect(appStore.settings.appearance.themePreference).toBe('light');
        });

        it('从 light 切换为 dark', () => {
            appStore.applyTheme('light');
            workbench.toggleTheme();
            expect(appStore.settings.appearance.themePreference).toBe('dark');
        });
    });

    // ── 8. requestCloseApplication ──
    describe('requestCloseApplication()', () => {
        it('无脏文档时直接关闭窗口', async () => {
            await workbench.requestCloseApplication();
            expect(mockAppWindow.close).toHaveBeenCalledOnce();
        });

        it('有脏文档且选取消时不关闭窗口', async () => {
            workbench.createNewDocument();
            const doc = editorStore.documents[0]!;
            editorStore.updateDocumentContent(doc.id, doc.content + '\n# dirty');

            mockDialogConfirm.mockResolvedValueOnce('dismiss' as 'confirm' | 'cancel' | 'dismiss');
            await workbench.requestCloseApplication();

            expect(mockAppWindow.close).not.toHaveBeenCalled();
        });
    });
});
