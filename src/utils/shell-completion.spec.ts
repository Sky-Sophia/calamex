import { EditorState } from '@codemirror/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    parserInit: vi.fn(),
    languageLoad: vi.fn(),
    parserDelete: vi.fn(),
    treeDelete: vi.fn(),
    parserSetLanguage: vi.fn(),
    listShellCommandLabels: vi.fn(),
}));

vi.mock('tree-sitter-bash/tree-sitter-bash.wasm?url', () => ({
    default: '/mock/tree-sitter-bash.wasm',
}));

vi.mock('web-tree-sitter/web-tree-sitter.wasm?url', () => ({
    default: '/mock/web-tree-sitter.wasm',
}));

vi.mock('@/services/shell/command-catalog', () => ({
    listShellCommandLabels: mocks.listShellCommandLabels,
}));

vi.mock('web-tree-sitter', () => {
    class MockParser {
        static init = mocks.parserInit;

        setLanguage = mocks.parserSetLanguage;

        parse(source: string) {
            return createTree(source);
        }

        delete = mocks.parserDelete;
    }

    return {
        Parser: MockParser,
        Language: {
            load: mocks.languageLoad,
        },
    };
});

const createTree = (source: string) => {
    const rootNode = {
        type: 'program',
        text: source,
        parent: null,
        parseState: 0,
        nextParseState: 0,
        endIndex: source.length,
        namedDescendantForPosition: () => null,
        descendantForPosition: () => null,
        descendantsOfType: () => [],
        childForFieldName: () => null,
    };

    return {
        rootNode,
        delete: mocks.treeDelete,
    };
};

describe('shell-completion provider', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.parserInit.mockReset();
        mocks.languageLoad.mockReset();
        mocks.parserDelete.mockReset();
        mocks.treeDelete.mockReset();
        mocks.parserSetLanguage.mockReset();
        mocks.listShellCommandLabels.mockReset();

        mocks.listShellCommandLabels.mockResolvedValue(['git']);
        mocks.languageLoad.mockResolvedValue({
            lookaheadIterator: () => null,
        });
    });

    it('Tree-sitter 初始化失败后，后续 CodeMirror 补全请求仍可重试恢复', async () => {
        mocks.parserInit
            .mockRejectedValueOnce(new Error('tree-sitter init failed'))
            .mockResolvedValue(undefined);

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { createShellCodeMirrorCompletionSource } = await import('./shell-completion');
        const source = createShellCodeMirrorCompletionSource();
        const state = EditorState.create({ doc: 'gi' });

        await expect(source({ state, pos: 2, explicit: true, aborted: false } as never)).resolves.toBeNull();

        const recovered = await source({ state, pos: 2, explicit: true, aborted: false } as never);

        expect(mocks.parserInit).toHaveBeenCalledTimes(2);
        expect(recovered?.options.some((entry) => entry.label === 'git')).toBe(true);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Shell completion provider failed',
            expect.any(Error),
        );
    });
});
