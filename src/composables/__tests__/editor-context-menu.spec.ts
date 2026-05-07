import type { IEditorContextMenuItem } from '@/components/editor/editor-context-menu.types';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, type ComponentPublicInstance } from 'vue';

const monacoMock = vi.hoisted(() => {
    class MockRange {
        constructor(
            public startLineNumber: number,
            public startColumn: number,
            public endLineNumber: number,
            public endColumn: number,
        ) { }
    }

    class MockSelection extends MockRange {
        containsPosition(position: { lineNumber: number; column: number }): boolean {
            return position.lineNumber >= this.startLineNumber
                && position.lineNumber <= this.endLineNumber
                && position.column >= this.startColumn
                && position.column <= this.endColumn;
        }
    }

    return {
        monaco: {
            Range: MockRange,
            Selection: MockSelection,
            editor: {
                EditorOption: {
                    readOnly: 'readOnly',
                },
            },
        },
    };
});

vi.mock('@/utils/monaco', () => monacoMock);
vi.mock('@/utils/clipboard', () => ({
    tryReadClipboardText: vi.fn(async () => null),
    writeClipboardText: vi.fn(async () => undefined),
}));

import { useEditorContextMenu } from '@/composables/useEditorContextMenu';

type TEditorContextMenuApi = ReturnType<typeof useEditorContextMenu>;

interface IMountedEditorContextMenu {
    api: TEditorContextMenuApi;
    wrapper: VueWrapper<ComponentPublicInstance>;
}

const createMockEditor = () => {
    const selection = {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 12,
        containsPosition: () => true,
    };

    const model = {
        getValueInRange: () => 'echo hello',
        getEOL: () => '\n',
    };

    return {
        getOption: vi.fn(() => false),
        getAction: vi.fn(() => ({
            isSupported: () => true,
            run: vi.fn(async () => undefined),
        })),
        getModel: vi.fn(() => model),
        getSelection: vi.fn(() => selection),
        getSelections: vi.fn(() => [selection]),
        getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
        setSelection: vi.fn(),
        setPosition: vi.fn(),
        focus: vi.fn(),
    };
};

const mountContextMenu = (): IMountedEditorContextMenu => {
    let api: TEditorContextMenuApi | null = null;
    const editor = createMockEditor();

    const wrapper = mount(
        defineComponent({
            setup() {
                api = useEditorContextMenu({
                    getEditor: () => editor as never,
                    canRunCurrentScript: () => true,
                    onOpenTerminalRequest: vi.fn(),
                    onFormatRequest: vi.fn(),
                    onCommandPaletteRequest: vi.fn(),
                    onRunCurrentScriptRequest: vi.fn(),
                    onAiCodeActionRequest: vi.fn(),
                });
                return () => null;
            },
        }),
    );

    if (api === null) {
        throw new Error('editor context menu host failed to initialize');
    }

    return { api, wrapper };
};

const findRootItem = (
    api: TEditorContextMenuApi,
    key: string,
): IEditorContextMenuItem => {
    const item = api.contextMenuGroups.value
        .flatMap((group) => group.items)
        .find((candidate) => candidate.key === key);
    if (!item) {
        throw new Error(`missing root item: ${key}`);
    }
    return item;
};

describe('useEditorContextMenu', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('Monaco 右键按下事件也能打开编辑器菜单', () => {
        const { api, wrapper } = mountContextMenu();
        const browserEvent = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: 40,
            clientY: 56,
        });

        api.handleEditorMouseDown({
            target: {
                position: { lineNumber: 1, column: 4 },
            },
            event: {
                rightButton: true,
                browserEvent,
            },
        } as never);

        expect(browserEvent.defaultPrevented).toBe(true);
        expect(api.contextMenuState.open).toBe(true);
        expect(api.contextMenuGroups.value.length).toBeGreaterThan(0);

        wrapper.unmount();
    });

    it('浏览器原生右键事件也能打开编辑器菜单', () => {
        const { api, wrapper } = mountContextMenu();
        const browserEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 48,
            clientY: 64,
        });

        api.handleBrowserContextMenu(browserEvent, {
            lineNumber: 1,
            column: 4,
        });

        expect(browserEvent.defaultPrevented).toBe(true);
        expect(api.contextMenuState.open).toBe(true);
        expect(api.contextMenuGroups.value.length).toBeGreaterThan(0);

        wrapper.unmount();
    });

    it('将 AI 动作整合为单个二级菜单入口', () => {
        const { api, wrapper } = mountContextMenu();
        const browserEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 32,
        });

        void api.handleEditorContextMenu({
            target: {
                position: { lineNumber: 1, column: 4 },
            },
            event: {
                browserEvent,
            },
        } as never);

        expect(api.contextMenuState.open).toBe(true);
        expect(api.contextMenuGroups.value.find((group) => group.key === 'ai-actions')).toBeUndefined();

        const aiItem = findRootItem(api, 'ai-tools');
        expect(aiItem.label).toBe('AI');
        expect(aiItem.children?.map((item) => item.key)).toEqual([
            'ai-explain-selection',
            'ai-fix-diagnostic',
            'ai-generate-tests',
        ]);

        const runActions = api.contextMenuGroups.value.find((group) => group.key === 'run-actions');
        expect(runActions?.items.some((item) => item.key === 'open-terminal')).toBe(true);

        wrapper.unmount();
    });
});