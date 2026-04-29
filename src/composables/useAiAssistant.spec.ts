import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useAiAssistant } from '@/composables/useAiAssistant';
import { useAiConversationStore } from '@/store/aiConversation';
import type { IAiChatStreamEventPayload } from '@/types/ai';
import type { IAnalyzeScriptPayload, IEditorDocument } from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STREAM_ID = 'stream-1' as const;
const ASSISTANT_MESSAGE_ID = 'assistant-1' as const;
const MOCK_MODEL = 'mock-ide-assistant' as const;
const WORKSPACE_ROOT = 'd:/com.xiaojianc/my_desktop_app' as const;

// ---------------------------------------------------------------------------
// AI service mock (hoisted so vi.mock factory can reach it)
// ---------------------------------------------------------------------------

const aiServiceMock = vi.hoisted(() => {
    type StreamHandler = (payload: IAiChatStreamEventPayload) => void;

    let streamHandler: StreamHandler | null = null;

    const onChatStream = vi.fn(async (handler: StreamHandler) => {
        streamHandler = handler;
        return vi.fn(); // unsubscribe
    });

    const chatStream = vi.fn(async () => ({
        streamId: STREAM_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        providerType: 'mock',
        model: MOCK_MODEL,
    }));

    const cancel = vi.fn(async (payload: { streamId: string }) => {
        void payload;
    });

    const queryIndex = vi.fn(async () => ({
        rootPath: WORKSPACE_ROOT,
        results: [],
    }));

    return {
        onChatStream,
        chatStream,
        cancel,
        queryIndex,
        emit(event: IAiChatStreamEventPayload): void {
            streamHandler?.(event);
        },
        emitDelta(delta: string): void {
            streamHandler?.({
                streamId: STREAM_ID,
                assistantMessageId: ASSISTANT_MESSAGE_ID,
                kind: 'delta',
                delta,
                message: null,
                model: MOCK_MODEL,
            });
        },
        reset(): void {
            streamHandler = null;
            onChatStream.mockClear();
            chatStream.mockClear();
            cancel.mockClear();
            queryIndex.mockClear();
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const waitForStartedStream = async (
    resolveMessageId: () => string | undefined,
    expectedId: string = ASSISTANT_MESSAGE_ID,
    maxAttempts = 8,
): Promise<void> => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (resolveMessageId() === expectedId) {
            return;
        }
        await flushMicrotasks();
    }
    throw new Error(
        `assistant stream did not start in time (expected id="${expectedId}" within ${maxAttempts} ticks)`,
    );
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

const createAssistantHarness = (): ReturnType<typeof useAiAssistant> =>
    useAiAssistant({
        document: ref(createDocument()),
        activeRun: ref(null),
        analysis: ref(createAnalysis()),
        selection: ref(null),
        gitStatus: ref(createGitStatus()),
        workspaceRootPath: ref(WORKSPACE_ROOT),
    });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useAiAssistant streaming integration', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        aiServiceMock.reset();
        vi.stubGlobal(
            'requestAnimationFrame',
            (callback: FrameRequestCallback): number => {
                callback(0);
                return 1;
            },
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('pipes streaming delta through the fence parser into message.stream', async () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '解释这段代码';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('前文 **markdown**\n\n```ts\nconst pending = true;');
        await flushMicrotasks();

        const assistantMessage = assistant.messages.value.at(-1);
        expect(assistantMessage?.content).toBe(
            '前文 **markdown**\n\n```ts\nconst pending = true;',
        );
        expect(assistantMessage?.stream?.stableContent).toBe('前文 **markdown**\n\n');
        expect(assistantMessage?.stream?.status).toBe('streaming');
        expect(assistantMessage?.stream?.openBlock?.id).toBe(`${ASSISTANT_MESSAGE_ID}:0`);
        expect(assistantMessage?.stream?.openBlock?.content).toBe('const pending = true;');
        expect(assistantMessage?.stream?.openBlock?.streamState).toBe('open');

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('marks the open block cancelled immediately on stop and ignores late delta', async () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '继续';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('```ts\nconst pending = true;\n');
        await flushMicrotasks();

        assistant.stopCurrentRequest();

        const cancelledMessage = assistant.messages.value.at(-1);
        expect(aiServiceMock.cancel).toHaveBeenCalledWith({ streamId: STREAM_ID });
        expect(cancelledMessage?.stream?.status).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.streamState).toBe('cancelled');
        expect(cancelledMessage?.stream?.openBlock?.content).toBe('const pending = true;\n');

        const contentBeforeLateDelta = cancelledMessage?.content;

        // Late delta arriving after cancel must not mutate the message.
        aiServiceMock.emitDelta('```\n不应该进入消息');
        await flushMicrotasks();

        expect(assistant.messages.value.at(-1)?.content).toBe(contentBeforeLateDelta);

        await sendPromise;
    });

    it('accepts image attachments and includes them in outgoing references', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
            width: 640,
            height: 480,
            close: vi.fn(),
        })));

        const assistant = createAssistantHarness();
        const image = new File(['image-bytes'], 'pasted-image.png', { type: 'image/png' });

        await assistant.attachFile(image);

        expect(assistant.attachedFiles.value).toHaveLength(1);
        expect(assistant.attachedFiles.value[0]?.kind).toBe('image');
        expect(assistant.attachedFiles.value[0]?.detailLabel).toBe('640 × 480');
        expect(assistant.attachedFiles.value[0]?.reference.kind).toBe('image-attachment');
        expect(assistant.attachedFiles.value[0]?.reference.content).toBeUndefined();

        assistant.draft.value = '';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.chatStream.mock.calls[0]?.[0]?.references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'image-attachment',
                    label: '图片附件 · pasted-image.png',
                }),
            ]),
        );

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('starts a new conversation by clearing draft and transient state', () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '还没发送的内容';
        assistant.messages.value = [{
            id: 'assistant-1',
            role: 'assistant',
            content: '旧会话消息',
            createdAt: '2026-04-28T10:00:00.000Z',
            references: [],
        }];
        assistant.currentReferences.value = [{
            id: 'ref-1',
            kind: 'current-file',
            label: '当前文件',
            path: 'src/app.ts',
            range: null,
            contentPreview: 'const start = true;',
            redacted: false,
        }];
        assistant.errorMessage.value = '旧错误';

        assistant.startNewConversation();

        expect(assistant.draft.value).toBe('');
        expect(assistant.messages.value).toHaveLength(0);
        expect(assistant.historyThreads.value).toHaveLength(1);
        expect(assistant.historyThreads.value[0]?.messages[0]?.id).toBe('assistant-1');
        expect(assistant.currentReferences.value).toHaveLength(0);
        expect(assistant.errorMessage.value).toBe('');
    });

    it('hydrates persisted messages from the conversation store', () => {
        const conversationStore = useAiConversationStore();

        conversationStore.replaceMessages([
            {
                id: 'persisted-message',
                role: 'assistant',
                content: '持久化历史消息',
                createdAt: '2026-04-28T10:00:00.000Z',
                references: [],
            },
        ]);

        const assistant = createAssistantHarness();

        expect(assistant.messages.value).toHaveLength(1);
        expect(assistant.messages.value[0]?.id).toBe('persisted-message');
    });

    it('asks for confirmation before starting agent execution', async () => {
        const assistant = createAssistantHarness();

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '在当前文件里整理数据库备份示例';

        await assistant.sendMessage();

        expect(aiServiceMock.chatStream).not.toHaveBeenCalled();
        expect(assistant.messages.value).toHaveLength(2);
        expect(assistant.messages.value[0]?.role).toBe('user');
        expect(assistant.messages.value[1]?.content).toContain('是否允许 AI 开始执行这个任务');
        expect(assistant.messages.value[1]?.actions).toEqual([
            {
                id: 'allow-agent-execution',
                label: '允许执行',
            },
        ]);

        const confirmPromise = assistant.handleMessageAction(
            assistant.messages.value[1]?.id ?? '',
            'allow-agent-execution',
        );

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.chatStream.mock.calls[0]?.[0]?.messages[0]).toEqual(
            expect.objectContaining({
                role: 'system',
            }),
        );
        expect(assistant.messages.value[1]?.content).toContain('已允许开始执行');

        assistant.stopCurrentRequest();
        await confirmPromise;
    });
});