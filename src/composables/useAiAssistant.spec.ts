import { useAiAssistant } from '@/composables/useAiAssistant';
import type { IAiChatStreamEventPayload } from '@/types/ai';
import type { IAnalyzeScriptPayload, IEditorDocument } from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const aiServiceMock = vi.hoisted(() => {
    let streamHandler: ((payload: IAiChatStreamEventPayload) => void) | null = null;

    return {
        onChatStream: vi.fn(async (handler: (payload: IAiChatStreamEventPayload) => void) => {
            streamHandler = handler;
            return vi.fn();
        }),
        chatStream: vi.fn(async () => ({
            streamId: 'stream-1',
            assistantMessageId: 'assistant-1',
            providerType: 'mock',
            model: 'mock-ide-assistant',
        })),
        cancel: vi.fn(async () => undefined),
        queryIndex: vi.fn(async () => ({
            rootPath: 'd:/com.xiaojianc/my_desktop_app',
            results: [],
        })),
        emit(event: IAiChatStreamEventPayload) {
            streamHandler?.(event);
        },
        reset() {
            streamHandler = null;
            this.onChatStream.mockClear();
            this.chatStream.mockClear();
            this.cancel.mockClear();
            this.queryIndex.mockClear();
        },
    };
});

vi.mock('@/services/modules/ai', () => ({
    aiService: {
        onChatStream: aiServiceMock.onChatStream,
        chatStream: aiServiceMock.chatStream,
        cancel: aiServiceMock.cancel,
        queryIndex: aiServiceMock.queryIndex,
    },
}));

const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const waitForStartedStream = async (
    resolveMessageId: () => string | undefined,
): Promise<void> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (resolveMessageId() === 'assistant-1') {
            return;
        }
        await flushMicrotasks();
    }
    throw new Error('assistant stream did not start in time');
};

const createDocument = (): IEditorDocument => ({
    id: 'doc-1',
    path: 'src/app.ts',
    name: 'app.ts',
    kind: 'text',
    content: 'const start = true;',
    encoding: 'utf-8',
    savedContent: 'const start = true;',
    savedEncoding: 'utf-8',
    isDirty: false,
    lineCount: 1,
    charCount: 19,
});

const createAnalysis = (): IAnalyzeScriptPayload => ({
    available: true,
    message: null,
    dialect: 'typescript',
    diagnostics: [],
});

const createGitStatus = (): IGitRepositoryStatusPayload => ({
    available: false,
    message: null,
    repositoryRootPath: null,
    repositoryName: null,
    gitDirPath: null,
    headBranchName: null,
    headShortName: null,
    headShortOid: null,
    isDetached: false,
    isClean: true,
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    files: [],
    lastCommit: null,
});

describe('useAiAssistant streaming integration', () => {
    beforeEach(() => {
        aiServiceMock.reset();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('pipes streaming delta through the fence parser into message.stream', async () => {
        const assistant = useAiAssistant({
            document: ref(createDocument()),
            activeRun: ref(null),
            analysis: ref(createAnalysis()),
            selection: ref(null),
            gitStatus: ref(createGitStatus()),
            workspaceRootPath: ref('d:/com.xiaojianc/my_desktop_app'),
        });
        assistant.draft.value = '解释这段代码';

        const sendPromise = assistant.sendMessage();
        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emit({
            streamId: 'stream-1',
            assistantMessageId: 'assistant-1',
            kind: 'delta',
            delta: '前文 **markdown**\n\n```ts\nconst pending = true;',
            message: null,
            model: 'mock-ide-assistant',
        });
        await flushMicrotasks();

        const assistantMessage = assistant.messages.value.at(-1);
        expect(assistantMessage?.content).toBe('前文 **markdown**\n\n```ts\nconst pending = true;');
        expect(assistantMessage?.stream?.stableContent).toBe('前文 **markdown**\n\n');
        expect(assistantMessage?.stream?.status).toBe('streaming');
        expect(assistantMessage?.stream?.openBlock?.id).toBe('assistant-1:0');
        expect(assistantMessage?.stream?.openBlock?.content).toBe('const pending = true;');
        expect(assistantMessage?.stream?.openBlock?.streamState).toBe('open');

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('marks the open block cancelled immediately on stop and ignores late delta', async () => {
        const assistant = useAiAssistant({
            document: ref(createDocument()),
            activeRun: ref(null),
            analysis: ref(createAnalysis()),
            selection: ref(null),
            gitStatus: ref(createGitStatus()),
            workspaceRootPath: ref('d:/com.xiaojianc/my_desktop_app'),
        });
        assistant.draft.value = '继续';

        const sendPromise = assistant.sendMessage();
        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emit({
            streamId: 'stream-1',
            assistantMessageId: 'assistant-1',
            kind: 'delta',
            delta: '```ts\nconst pending = true;\n',
            message: null,
            model: 'mock-ide-assistant',
        });
        await flushMicrotasks();

        assistant.stopCurrentRequest();

        const cancelledMessage = assistant.messages.value.at(-1);
        expect(aiServiceMock.cancel).toHaveBeenCalledWith({ streamId: 'stream-1' });
        expect(cancelledMessage?.stream?.status).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.streamState).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.content).toBe('const pending = true;\n');

        const contentBeforeLateDelta = cancelledMessage?.content;
        aiServiceMock.emit({
            streamId: 'stream-1',
            assistantMessageId: 'assistant-1',
            kind: 'delta',
            delta: '```\n不应该进入消息',
            message: null,
            model: 'mock-ide-assistant',
        });
        await flushMicrotasks();

        expect(assistant.messages.value.at(-1)?.content).toBe(contentBeforeLateDelta);

        await sendPromise;
    });
});