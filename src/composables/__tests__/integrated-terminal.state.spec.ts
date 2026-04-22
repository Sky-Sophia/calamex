/**
 * T-2.2 特征化测试：终端状态机快照
 * 目的：拆分前锁定 useIntegratedTerminal 状态转移行为，作为 T-2.3 的安全网。
 * 约束：MUST NOT 依赖真实 Tauri / 真实 xterm / 真实 PTY。
 */
import type { TThemeMode } from '@/types/app';
import type { ITerminalSettings } from '@/types/settings';
import type { ITerminalStatusChangePayload } from '@/types/terminal';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import {
    useIntegratedTerminal,
    useIntegratedTerminalControls,
    useIntegratedTerminalStatus,
} from '../useIntegratedTerminal';

// ─────────────────────────────────────────────
// Mock 变量（vi.hoisted 保证提升前可访问）
// ─────────────────────────────────────────────
const {
    capturedListeners,
    mockTerminalInstance,
    mockTauriService,
} = vi.hoisted(() => {
    const capturedListeners = new Map<string, (event: { payload: unknown }) => void>();

    const mockTerminalInstance = {
        open: vi.fn(),
        dispose: vi.fn(),
        // write 立即调用回调，避免死锁
        write: vi.fn((data: string, cb?: () => void) => {
            cb?.();
        }),
        writeln: vi.fn((_data: string, cb?: () => void) => {
            cb?.();
        }),
        clear: vi.fn(),
        reset: vi.fn(),
        focus: vi.fn(),
        loadAddon: vi.fn(),
        getSelection: vi.fn(() => ''),
        onData: vi.fn(),
        onScroll: vi.fn(),
        onResize: vi.fn(),
        onSelectionChange: vi.fn(),
        scrollToBottom: vi.fn(),
        refresh: vi.fn(),
        clearTextureAtlas: vi.fn(),
        buffer: {
            active: { baseY: 0, viewportY: 0, length: 0, getLine: vi.fn(() => null) },
        },
        rows: 28,
        cols: 120,
        options: {} as Record<string, unknown>,
        element: null as HTMLElement | null,
    };

    const mockTauriService = {
        ensureTerminalSession: vi.fn(),
        writeTerminalInput: vi.fn(),
        resizeTerminalSession: vi.fn(),
        closeTerminalSession: vi.fn(),
    };

    return { capturedListeners, mockTerminalInstance, mockTauriService };
});

// ─────────────────────────────────────────────
// Mock：@tauri-apps/api/event（捕获监听器）
// ─────────────────────────────────────────────
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (eventName: string, handler: unknown) => {
        capturedListeners.set(
            eventName,
            handler as (event: { payload: unknown }) => void,
        );
        return () => {
            capturedListeners.delete(eventName);
        };
    }),
}));

// ─────────────────────────────────────────────
// Mock：xterm
// ─────────────────────────────────────────────
vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(() => mockTerminalInstance),
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(() => ({ fit: vi.fn(), dispose: vi.fn() })),
}));

vi.mock('@xterm/addon-webgl', () => ({
    WebglAddon: vi.fn(() => ({
        dispose: vi.fn(),
        clearTextureAtlas: vi.fn(),
        onContextLoss: vi.fn(() => ({ dispose: vi.fn() })),
    })),
}));

// ─────────────────────────────────────────────
// Mock：Tauri 服务层
// ─────────────────────────────────────────────
vi.mock('@/services/tauri', () => ({
    tauriService: mockTauriService,
}));

// ─────────────────────────────────────────────
// Mock：desktop-runtime（始终就绪）
// ─────────────────────────────────────────────
vi.mock('@/utils/desktop-runtime', () => ({
    waitForDesktopRuntime: vi.fn(() => Promise.resolve(true)),
    desktopRuntimeReady: { value: true },
}));

// ─────────────────────────────────────────────
// Mock：clipboard（避免 jsdom 剪切板 API 错误）
// ─────────────────────────────────────────────
vi.mock('@/utils/clipboard', () => ({
    writeClipboardText: vi.fn(() => Promise.resolve()),
}));

// ─────────────────────────────────────────────
// 默认终端设置
// ─────────────────────────────────────────────
const DEFAULT_TERMINAL_SETTINGS: ITerminalSettings = {
    defaultShell: '/bin/bash',
    shellArgs: '-il',
    workingDirectory: 'workspace-root',
    inheritEnvironment: true,
    fontFamily: '',
    fontSize: 13,
    lineHeight: '1.4',
    cursorStyle: 'block',
    cursorBlink: true,
    scrollback: 1000,
    trimFinalNewlineOnCopy: true,
    copyOnSelect: false,
    rightClickBehavior: 'paste',
    bellMode: 'off',
    clickableLinks: true,
};

// ─────────────────────────────────────────────
// 测试组件工厂
// ─────────────────────────────────────────────
const createTestComponent = (
    statusChanges: ITerminalStatusChangePayload[],
    sessionId = 'main-terminal',
) =>
    defineComponent({
        setup() {
            const settings = ref<ITerminalSettings>(DEFAULT_TERMINAL_SETTINGS);
            const visible = ref(true);
            const theme = ref<TThemeMode>('dark');

            const result = useIntegratedTerminal({
                settings,
                visible,
                theme,
                sessionId,
                onStatusChange: (p: ITerminalStatusChangePayload) => statusChanges.push(p),
            });

            return { ...result };
        },
        template: '<div ref="hostRef" style="width:800px;height:400px"></div>',
    });

// ─────────────────────────────────────────────
// 测试套件
// ─────────────────────────────────────────────
describe('useIntegratedTerminal 状态机特征化', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        capturedListeners.clear();
        vi.clearAllMocks();

        // 默认：ensureTerminalSession 成功
        mockTauriService.ensureTerminalSession.mockResolvedValue({
            sessionId: 'main-terminal',
            cwd: '/home/test',
            shellLabel: 'bash',
            created: true,
            initialOutput: null,
        });
        mockTauriService.writeTerminalInput.mockResolvedValue(undefined);
        mockTauriService.resizeTerminalSession.mockResolvedValue(undefined);
    });

    // ── 1. 导出钩子的结构 ──
    describe('useIntegratedTerminalStatus()', () => {
        it('返回含 status 和 statusMessage 的对象', () => {
            const result = useIntegratedTerminalStatus();
            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('statusMessage');
        });
    });

    describe('useIntegratedTerminalControls()', () => {
        it('返回完整的控制接口', () => {
            const controls = useIntegratedTerminalControls();
            expect(controls).toHaveProperty('status');
            expect(controls).toHaveProperty('statusMessage');
            expect(controls).toHaveProperty('session');
            expect(controls).toHaveProperty('retry');
            expect(controls).toHaveProperty('clearScreen');
            expect(controls).toHaveProperty('interrupt');
            expect(controls).toHaveProperty('sendCommand');
        });
    });

    // ── 2. 状态转移：connecting → ready ──
    describe('状态转移：connecting → ready', () => {
        it('ensureSession 成功后 sharedStatus 变为 ready', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const { status } = useIntegratedTerminalStatus();
            expect(status.value).toBe('ready');

            wrapper.unmount();
        });

        it('状态变化回调包含 connecting → ready 顺序', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const states = statusChanges.map((c) => c.state);
            expect(states).toContain('connecting');
            expect(states).toContain('ready');
            expect(states.indexOf('connecting')).toBeLessThan(states.indexOf('ready'));

            wrapper.unmount();
        });

        it('ensureTerminalSession 以正确 sessionId 调用', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            expect(mockTauriService.ensureTerminalSession).toHaveBeenCalledOnce();
            expect(mockTauriService.ensureTerminalSession).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'main-terminal' }),
            );

            wrapper.unmount();
        });
    });

    // ── 3. 状态转移：connecting → error ──
    describe('状态转移：connecting → error', () => {
        it('ensureSession 失败后 sharedStatus 变为 error', async () => {
            mockTauriService.ensureTerminalSession.mockRejectedValue(
                new Error('connection refused'),
            );

            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const { status } = useIntegratedTerminalStatus();
            expect(status.value).toBe('error');

            wrapper.unmount();
        });
    });

    // ── 4. 状态转移：ready → closed（terminal:exit 事件） ──
    describe('状态转移：ready → closed（exit 事件）', () => {
        it('匹配 sessionId 的 exit 事件将状态变为 closed', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            // 确认已就绪
            const { status } = useIntegratedTerminalStatus();
            expect(status.value).toBe('ready');

            // 触发终端退出事件
            const exitHandler = capturedListeners.get('terminal:exit');
            expect(exitHandler).toBeDefined();
            exitHandler?.({ payload: { sessionId: 'main-terminal', exitCode: 0 } });

            expect(status.value).toBe('closed');

            wrapper.unmount();
        });

        it('sessionId 不匹配的 exit 事件被过滤忽略', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const exitHandler = capturedListeners.get('terminal:exit');
            exitHandler?.({ payload: { sessionId: 'OTHER-SESSION', exitCode: 0 } });

            const { status } = useIntegratedTerminalStatus();
            expect(status.value).toBe('ready'); // 保持不变

            wrapper.unmount();
        });
    });

    // ── 5. 事件监听注册 ──
    describe('事件监听注册', () => {
        it('注册 4 个必需的 Tauri 事件监听器', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const { listen } = await import('@tauri-apps/api/event');
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                'terminal:data',
                expect.any(Function),
            );
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                'terminal:run-output',
                expect.any(Function),
            );
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                'terminal:run-complete',
                expect.any(Function),
            );
            expect(vi.mocked(listen)).toHaveBeenCalledWith(
                'terminal:exit',
                expect.any(Function),
            );

            wrapper.unmount();
        });
    });

    // ── 6. 终端数据事件 ──
    describe('terminal:data 事件', () => {
        it('data 事件处理器注册并对匹配 sessionId 无异常响应', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const dataHandler = capturedListeners.get('terminal:data');
            expect(dataHandler).toBeDefined();

            // 调用匹配 sessionId 的数据事件应无异常
            expect(() => {
                dataHandler?.({ payload: { sessionId: 'main-terminal', data: 'hello\n' } });
            }).not.toThrow();

            wrapper.unmount();
        });

        it('sessionId 不匹配的数据事件不写入 terminal', async () => {
            mockTerminalInstance.write.mockClear();

            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            const writeCallsBefore = mockTerminalInstance.write.mock.calls.length;

            const dataHandler = capturedListeners.get('terminal:data');
            dataHandler?.({ payload: { sessionId: 'OTHER-SESSION', data: 'ignored' } });

            await flushPromises();

            expect(mockTerminalInstance.write.mock.calls.length).toBe(writeCallsBefore);

            wrapper.unmount();
        });
    });

    // ── 7. 卸载清理 ──
    describe('卸载时清理资源', () => {
        it('卸载后 terminal:exit 监听器被移除', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();

            expect(capturedListeners.has('terminal:exit')).toBe(true);

            wrapper.unmount();
            await flushPromises();

            expect(capturedListeners.has('terminal:exit')).toBe(false);
        });

        it('卸载后 terminal:data 监听器被移除', async () => {
            const statusChanges: ITerminalStatusChangePayload[] = [];
            const wrapper = mount(createTestComponent(statusChanges), {
                global: { plugins: [createPinia()] },
                attachTo: document.body,
            });

            await flushPromises();
            wrapper.unmount();
            await flushPromises();

            expect(capturedListeners.has('terminal:data')).toBe(false);
        });
    });
});
