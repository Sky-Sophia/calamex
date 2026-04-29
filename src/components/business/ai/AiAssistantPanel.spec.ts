import AiAssistantPanel from '@/components/business/ai/AiAssistantPanel.vue';
import type { IAiChatMessage, IAiConfigPayload, IAiContextReference, IAiPatchSet, IAiTaskPlanStep } from '@/types/ai';
import type {
    IActiveRunSummary,
    IAnalyzeScriptPayload,
    IEditorDocument,
    IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';

const useAiAssistantMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useAiAssistant', () => ({
    useAiAssistant: useAiAssistantMock,
}));

interface IAiConversationThreadMock {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: IAiChatMessage[];
}

const createAssistantMock = (
    messagesList: IAiChatMessage[],
    historyThreadsList: IAiConversationThreadMock[] = messagesList.length
        ? [{
            id: 'thread-active',
            title: '当前对话',
            createdAt: messagesList[0]?.createdAt ?? '2026-04-28T10:00:00.000Z',
            updatedAt: messagesList.at(-1)?.createdAt ?? '2026-04-28T10:00:00.000Z',
            messages: messagesList,
        }]
        : [],
) => {
    const config = ref<IAiConfigPayload>({
        providerType: 'mock',
        selectedModel: 'mock-ide-assistant',
        baseUrl: null,
        isBaseUrlConfigured: false,
        hasCredentials: false,
        isConfigured: true,
        inlineCompletionEnabled: false,
        chatEnabled: true,
        agentEnabled: false,
    });

    const messages = ref<IAiChatMessage[]>(messagesList);
    const historyThreads = ref<IAiConversationThreadMock[]>(historyThreadsList);
    const activeConversationId = ref<string | null>(historyThreadsList.at(-1)?.id ?? null);
    const activeMode = ref<'chat' | 'agent'>('chat');
    const isSettingsOpen = ref(false);
    const isClearDialogOpen = ref(false);
    const isSending = ref(false);
    const draft = ref('');
    const errorMessage = ref('');
    const currentReferences = ref<IAiContextReference[]>([]);
    const agentSteps = ref<IAiTaskPlanStep[]>([]);
    const attachedFiles = ref([] as Array<{ id: string; name: string; sizeLabel: string; kind: 'text' | 'image' }>);
    const proposedPatch = ref<IAiPatchSet | null>(null);
    const isApplyingPatch = ref(false);

    return {
        config,
        messages,
        historyThreads,
        activeConversationId,
        activeMode,
        isSettingsOpen,
        isClearDialogOpen,
        isSending,
        draft,
        errorMessage,
        currentReferences,
        agentSteps,
        attachedFiles,
        proposedPatch,
        isApplyingPatch,
        canPreviewPatch: computed(() => false),
        sendButtonLabel: computed(() => '发送'),
        loadConfig: vi.fn().mockResolvedValue(undefined),
        loadTools: vi.fn().mockResolvedValue(undefined),
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveCredentials: vi.fn().mockResolvedValue(undefined),
        testProviderConfig: vi.fn().mockResolvedValue('ok'),
        connectProvider: vi.fn().mockResolvedValue('ok'),
        testProvider: vi.fn().mockResolvedValue('ok'),
        previewPatchFromCodeBlock: vi.fn(),
        previewPatchFromLastAnswer: vi.fn(),
        applyProposedPatch: vi.fn(),
        sendMessage: vi.fn(),
        handleMessageAction: vi.fn(),
        stopCurrentRequest: vi.fn(),
        startNewConversation: vi.fn(),
        switchConversation: vi.fn(),
        attachFile: vi.fn(),
        removeAttachedFile: vi.fn(),
        clearConversation: vi.fn(),
    };
};

const createMessage = (index: number): IAiChatMessage => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `第 ${index} 条对话内容\n这是完整内容 ${index}`,
    createdAt: new Date(Date.UTC(2026, 3, 28, 10, index % 60, 0)).toISOString(),
    references: [],
});

const createThread = (index: number): IAiConversationThreadMock => {
    const message = createMessage(index);
    return {
        id: `thread-${index}`,
        title: `第 ${index} 组对话`,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        messages: [message],
    };
};

const createDocument = (): IEditorDocument => ({
    id: 'doc-1',
    path: 'src/app.ts',
    name: 'app.ts',
    kind: 'text',
    content: 'const ready = true;',
    encoding: 'utf-8',
    savedContent: 'const ready = true;',
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

describe('AiAssistantPanel', () => {
    it('renders a scrollable history view with the latest 20 conversations', async () => {
        const historyThreads = Array.from({ length: 25 }, (_value, index) => createThread(index + 1));
        useAiAssistantMock.mockReturnValue(
            createAssistantMock(historyThreads.at(-1)?.messages ?? [], historyThreads),
        );

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiEditTimeline: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiTaskPlan: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="对话记录"]').trigger('click');

        expect(wrapper.findAll('.ai-history-item')).toHaveLength(20);
        expect(wrapper.text()).toContain('最近 20 组');
        expect(wrapper.text()).toContain('第 25 组对话');
        expect(wrapper.text()).not.toContain('第 5 组对话');
        expect(wrapper.find('.ai-history-list').exists()).toBe(true);
    });

    it('starts a new conversation from the header action', async () => {
        const assistantMock = createAssistantMock([]);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiEditTimeline: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="新建对话"]').trigger('click');

        expect(assistantMock.startNewConversation).toHaveBeenCalledTimes(1);
    });

    it('switches to a selected history conversation', async () => {
        const historyThreads = [createThread(1), createThread(2)];
        const assistantMock = createAssistantMock(historyThreads[1]?.messages ?? [], historyThreads);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
                onOpenCodePath: () => undefined,
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiEditTimeline: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        await wrapper.get('[aria-label="对话记录"]').trigger('click');
        await wrapper.findAll('.ai-history-button')[1]?.trigger('click');

        expect(assistantMock.switchConversation).toHaveBeenCalledWith('thread-1');
    });
});
