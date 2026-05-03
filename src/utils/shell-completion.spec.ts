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

vi.mock('@/services/shell-command-catalog', () => ({
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

const createModel = (source: string) => ({
    getValue: () => source,
    getLineContent: () => source,
    getOffsetAt: (position: { column: number }) => position.column - 1,
});

const createMonaco = () => {
    let provider:
        | {
            provideCompletionItems: (
                model: ReturnType<typeof createModel>,
                position: { lineNumber: number; column: number },
                context: unknown,
                token: { isCancellationRequested: boolean },
            ) => Promise<{ suggestions: Array<{ label: string }> }>;
        }
        | null = null;

    class MockRange {
        constructor(
            public startLineNumber: number,
            public startColumn: number,
            public endLineNumber: number,
            public endColumn: number,
        ) { }
    }

    const monaco = {
        Range: MockRange,
        languages: {
            CompletionItemKind: {
                Keyword: 1,
                Function: 2,
                Property: 3,
                Value: 4,
                Variable: 5,
                Snippet: 6,
                Operator: 7,
            },
            CompletionItemInsertTextRule: {
                InsertAsSnippet: 4,
            },
            registerCompletionItemProvider: vi.fn((_languageId: string, nextProvider: typeof provider) => {
                provider = nextProvider;
                return {
                    dispose: vi.fn(),
                };
            }),
        },
    };

    return {
        monaco,
        getProvider: () => provider,
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

    it('Tree-sitter 初始化失败后，后续补全请求仍可重试恢复', async () => {
        mocks.parserInit
            .mockRejectedValueOnce(new Error('tree-sitter init failed'))
            .mockResolvedValue(undefined);

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { registerShellCompletionProvider } = await import('./shell-completion');
        const { monaco, getProvider } = createMonaco();

        registerShellCompletionProvider(monaco as never);
        const provider = getProvider();

        expect(provider).not.toBeNull();

        const model = createModel('gi');
        const position = { lineNumber: 1, column: 3 };
        const token = { isCancellationRequested: false };

        await expect(provider!.provideCompletionItems(model, position, {}, token)).resolves.toEqual({
            suggestions: [],
        });

        const recovered = await provider!.provideCompletionItems(model, position, {}, token);

        expect(mocks.parserInit).toHaveBeenCalledTimes(2);
        expect(recovered.suggestions.some((entry) => entry.label === 'git')).toBe(true);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Shell completion provider failed',
            expect.any(Error),
        );
    });
});