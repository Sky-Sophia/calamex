import AiAssistantPanel from '@/components/business/ai/AiAssistantPanel.vue';
import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';
import type {
    IAiAgentRun,
    IAiAgentStepFinalAnswer,
    IAiChatMessage,
    IAiConfigPayload,
    IAiContextReference,
    IAiPatchSet,
    IAiTaskPlanStep,
    IAiToolActivityInline,
    IAiToolConfirmationRequest,
} from '@/types/ai';
import type {
    IActiveRunSummary,
    IAnalyzeScriptPayload,
    IEditorDocument,
    IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { createDefaultAiModelEndpointConfig } from '@/utils/ai-config';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        providerType: 'litellm',
        selectedModel: 'openai/gpt-5.5',
        baseUrl: 'http://127.0.0.1:4000/v1',
        isBaseUrlConfigured: true,
        hasCredentials: false,
        isConfigured: true,
        inlineCompletionEnabled: false,
        chatEnabled: true,
        agentEnabled: false,
        activeProfileId: null,
        narrator: createDefaultAiModelEndpointConfig('zhipu/glm-4-flash'),
    });

    const messages = ref<IAiChatMessage[]>(messagesList);
    const historyThreads = ref<IAiConversationThreadMock[]>(historyThreadsList);
    const activeConversationId = ref<string | null>(historyThreadsList.at(-1)?.id ?? null);
    const activeMode = ref<'chat' | 'agent' | 'plan'>('agent');
    const isSettingsOpen = ref(false);
    const isClearDialogOpen = ref(false);
    const isSending = ref(false);
    const draft = ref('');
    const errorMessage = ref('');
    const providerProfiles = ref([]);
    const currentReferences = ref<IAiContextReference[]>([]);
    const agentSteps = ref<IAiTaskPlanStep[]>([]);
    const attachedFiles = ref([] as Array<{ id: string; name: string; sizeLabel: string; kind: 'text' | 'image' }>);
    const proposedPatch = ref<IAiPatchSet | null>(null);
    const isApplyingPatch = ref(false);
    const runtimeTimelineEvents = ref<TAgentRuntimeEvent[]>([]);
    const fileRollbackPrompt = ref<{
        operationId: string;
        fileCount: number;
        status: 'ready' | 'reverting' | 'reverted';
        updatedAt: string;
        restoredFileCount?: number;
    } | null>(null);
    const agentPlanStore = {
        mode: 'chat' as const,
        activeGoal: '',
        steps: [] as IAiTaskPlanStep[],
        classification: null,
        classificationReason: '',
        shouldEnterPlanMode: false,
        isPlanning: false,
        isApproving: false,
        approvedAt: null,
        errorMessage: '',
        hasPlan: false,
        isClassifying: false,
        activeRunId: null as string | null,
        activeRun: null as IAiAgentRun | null,
        stepDetails: {},
        stepFinalAnswers: {},
        patchSummaries: {},
        toolActivities: {},
        pendingToolConfirmation: null as IAiToolConfirmationRequest | null,
        activeToolActivity: null,
        getToolActivities: vi.fn((): IAiToolActivityInline[] => []),
        getStepFinalAnswers: vi.fn((): IAiAgentStepFinalAnswer[] => []),
        getPatchSummaries: vi.fn(() => []),
        appendStepToolResults: vi.fn(),
        setStepWebSources: vi.fn(),
    };

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
        providerProfiles,
        currentReferences,
        agentSteps,
        attachedFiles,
        proposedPatch,
        isApplyingPatch,
        runtimeTimelineEvents,
        fileRollbackPrompt,
        agentPlan: {
            store: agentPlanStore,
            classifyTask: vi.fn(),
            createPlan: vi.fn(),
            regeneratePlan: vi.fn(),
            updateStep: vi.fn(),
            removeStep: vi.fn(),
            approvePlan: vi.fn(),
            resetPlan: vi.fn(),
        },
        canPreviewPatch: computed(() => false),
        sendButtonLabel: computed(() => '发送'),
        loadConfig: vi.fn().mockResolvedValue(undefined),
        loadTools: vi.fn().mockResolvedValue(undefined),
        loadProviderProfiles: vi.fn().mockResolvedValue(undefined),
        saveConfig: vi.fn().mockResolvedValue(undefined),
        saveCredentials: vi.fn().mockResolvedValue(undefined),
        getProviderProfileDetail: vi.fn().mockResolvedValue(null),
        testProviderConfig: vi.fn().mockResolvedValue('ok'),
        connectProvider: vi.fn().mockResolvedValue('ok'),
        testProvider: vi.fn().mockResolvedValue('ok'),
        previewPatchFromLastAnswer: vi.fn(),
        applyProposedPatch: vi.fn(),
        rollbackLatestFileChange: vi.fn(),
        resolveSidecarToolConfirmation: vi.fn(),
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

const createPlanStep = (
    id: string,
    title: string,
    status: IAiTaskPlanStep['status'] = 'pending',
): IAiTaskPlanStep => ({
    id,
    index: Number(id.replace('plan-step-', '')) - 1,
    title,
    goal: title,
    kind: status === 'done' ? 'verify' : 'inspect',
    status,
    expectedOutput: `${title}的输出`,
    tools: status === 'running' ? ['read_file'] : ['get_diagnostics'],
    requiresUserApproval: false,
    riskLevel: 'low',
});

const createAgentRun = (
    steps: IAiTaskPlanStep[],
    currentStepId: string | null,
): IAiAgentRun => ({
    id: 'agent-run-complex-1',
    goal: '把 run timeline 改成对话流里的实时活动，修复计划折叠按钮，并补全过程测试',
    status: currentStepId ? 'running-step' : 'completed',
    steps,
    currentStepId,
    createdAt: '2026-04-29T10:00:00.000Z',
    updatedAt: '2026-04-29T10:00:03.000Z',
    startedAt: '2026-04-29T10:00:00.000Z',
    completedAt: currentStepId ? null : '2026-04-29T10:00:03.000Z',
    errorMessage: null,
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
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('顶部使用当前模型平台图标，不再直接显示模型 id', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.config.value.selectedModel = 'deepseek/deepseek-v4-pro';
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        const modelButton = wrapper.get('.ai-model-button');

        expect(modelButton.find('.ai-provider-icon').exists()).toBe(true);
        expect(modelButton.text()).not.toContain('deepseek/deepseek-v4-pro');
        expect(modelButton.attributes('title')).toContain('DeepSeek');
    });

    it('将预览 Patch 入口放在预览面板下方并保留点击动作', async () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.canPreviewPatch = computed(() => true);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div class="patch-preview-stub" />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        const html = wrapper.html();
        expect(html.indexOf('patch-preview-stub')).toBeLessThan(html.indexOf('ai-patch-entry__button'));

        const trigger = wrapper.get('.ai-patch-entry__button');
        expect(trigger.text()).toContain('预览为 Patch');
        expect(trigger.find('svg').exists()).toBe(true);

        await trigger.trigger('click');

        expect(assistantMock.previewPatchFromLastAnswer).toHaveBeenCalledTimes(1);
    });

    it('AI 修改文件后在对话框下方显示低调回滚入口', async () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.fileRollbackPrompt.value = {
            operationId: 'operation-rollback-1',
            fileCount: 2,
            status: 'ready',
            updatedAt: '2026-04-29T00:00:00.000Z',
        };
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div data-testid="chat-thread" />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div class="patch-preview-stub" />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        const html = wrapper.html();
        const rollbackButton = wrapper.get('.ai-file-rollback-entry__button');

        expect(html.indexOf('chat-thread')).toBeLessThan(html.indexOf('ai-file-rollback-entry__button'));
        expect(html.indexOf('ai-file-rollback-entry__button')).toBeLessThan(html.indexOf('patch-preview-stub'));
        expect(rollbackButton.text()).toContain('AI 已修改文件，可回滚最近一次');
        expect(rollbackButton.find('svg').exists()).toBe(true);

        await rollbackButton.trigger('click');

        expect(assistantMock.rollbackLatestFileChange).toHaveBeenCalledTimes(1);
    });

    it('在对话框下方显示低调 Agent 事件时间线', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.runtimeTimelineEvents.value = [
            {
                id: 'runtime-started',
                type: 'agent.run.started',
                runId: 'run-1',
                sessionId: 'session-1',
                agentId: 'agent-1',
                timestamp: '2026-05-02T10:00:00.000Z',
                seq: 0,
                schemaVersion: 1,
                redacted: true,
                visibility: 'user',
                level: 'info',
                inputPreview: '检查并修改当前文件',
            },
            {
                id: 'runtime-tool-completed',
                type: 'agent.tool.completed',
                runId: 'run-1',
                sessionId: 'session-1',
                agentId: 'agent-1',
                timestamp: '2026-05-02T10:00:01.000Z',
                seq: 1,
                schemaVersion: 1,
                redacted: true,
                visibility: 'user',
                level: 'info',
                toolName: 'edit_file',
                ok: true,
                resultPreview: '已更新 src/app.ts',
            },
            {
                id: 'runtime-completed',
                type: 'agent.run.completed',
                runId: 'run-1',
                sessionId: 'session-1',
                agentId: 'agent-1',
                timestamp: '2026-05-02T10:00:02.000Z',
                seq: 2,
                schemaVersion: 1,
                redacted: true,
                visibility: 'user',
                level: 'info',
                stopReason: 'end_turn',
            },
        ];
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div data-testid="chat-thread" />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div class="patch-preview-stub" />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
                    teleport: true,
                },
            },
        });

        const html = wrapper.html();

        expect(html.indexOf('chat-thread')).toBeLessThan(html.indexOf('ai-runtime-timeline'));
        expect(wrapper.text()).toContain('完成调用 edit_file');
        expect(wrapper.text()).toContain('已更新 src/app.ts');
    });

    it('shows plan panel only in plan mode when a plan exists', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.activeMode.value = 'plan';
        assistantMock.agentPlan.store.hasPlan = true;
        assistantMock.agentPlan.store.activeGoal = '补齐计划模式 UI 接线';
        assistantMock.agentPlan.store.steps = [
            {
                id: 'plan-step-1',
                index: 0,
                title: '收集上下文',
                goal: '收集上下文',
                kind: 'inspect',
                status: 'pending',
                expectedOutput: '影响范围',
                tools: ['search_text'],
                requiresUserApproval: false,
                riskLevel: 'low',
            },
            {
                id: 'plan-step-2',
                index: 1,
                title: '输出计划',
                goal: '输出计划',
                kind: 'summarize',
                status: 'pending',
                expectedOutput: '可执行计划',
                tools: ['get_diagnostics'],
                requiresUserApproval: true,
                riskLevel: 'medium',
            },
        ];
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(true);
    });

    it('does not show the plan panel in agent mode even when stale plan state exists', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.activeMode.value = 'agent';
        assistantMock.agentPlan.store.hasPlan = true;
        assistantMock.agentPlan.store.steps = [createPlanStep('plan-step-1', 'stale plan')];
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(false);
    });

    it('简单工具确认不再冒充计划面板', () => {
        const assistantMock = createAssistantMock([]);
        assistantMock.activeMode.value = 'agent';
        assistantMock.agentPlan.store.pendingToolConfirmation = {
            id: 'call-run-command',
            runId: 'agent-tool-loop-test',
            stepId: 'call-run-command',
            toolName: 'run_command',
            question: '允许 Agent 执行 pnpm test 吗？',
            summary: '运行最小验证命令。',
            riskLevel: 'medium',
            impact: '会在当前工作区执行测试命令。',
            reversible: false,
            createdAt: '2026-04-29T00:00:00.000Z',
            options: [
                { id: 'allow-once', label: '允许一次', tone: 'primary' },
                { id: 'deny', label: '拒绝' },
                { id: 'stop', label: '停止', tone: 'danger' },
            ],
        };
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('允许 Agent 执行 pnpm test 吗？');
        expect(wrapper.text()).toContain('允许一次');
    });

    it('简单任务的工具活动只留在对话流，不触发计划框', () => {
        const assistantMock = createAssistantMock([{
            id: 'message-user-simple',
            role: 'user',
            content: '解释当前脚本',
            createdAt: '2026-04-29T10:00:00.000Z',
            references: [],
        }]);
        assistantMock.activeMode.value = 'agent';
        assistantMock.agentPlan.store.classificationReason = '任务可在单轮内完成，可直接执行。';
        assistantMock.agentPlan.store.activeToolActivity = {
            id: 'activity-read-file',
            stepId: 'tool-call-step:read_file:call-read',
            toolName: 'read_file',
            state: 'running',
            label: '正在读取 test.sh…',
            startedAt: '2026-04-29T10:00:01.000Z',
        };
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: {
                        props: ['messages'],
                        template: `
                            <section data-testid="chat-thread">
                                <p v-for="message in messages" :key="message.id">{{ message.content }}</p>
                            </section>
                        `,
                    },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        expect(wrapper.find('[data-testid="plan-mode-panel"]').exists()).toBe(false);
        expect(wrapper.get('[data-testid="chat-thread"]').text()).toContain('解释当前脚本');
    });

    it('把复杂任务全过程显示在对话流里，包含用户提问、运行活动和 AI 最终回答', () => {
        const userQuestion = '把 run timeline 改成对话流里的实时活动，修复计划折叠按钮，并补全过程测试';
        const finalAnswer = '已修复：运行活动进入对话流，计划按钮可收起，并补齐全过程测试。';
        const assistantMock = createAssistantMock([
            {
                id: 'message-user-complex',
                role: 'user',
                content: userQuestion,
                createdAt: '2026-04-29T10:00:00.000Z',
                references: [],
            },
        ]);
        const steps = [
            createPlanStep('plan-step-1', '定位对话流运行反馈', 'done'),
            createPlanStep('plan-step-2', '修复计划折叠交互', 'running'),
            createPlanStep('plan-step-3', '执行全过程测试', 'pending'),
        ];
        const activeRun = createAgentRun(steps, 'plan-step-2');

        assistantMock.activeMode.value = 'plan';
        assistantMock.agentPlan.store.hasPlan = true;
        assistantMock.agentPlan.store.activeGoal = userQuestion;
        assistantMock.agentPlan.store.steps = steps;
        assistantMock.agentPlan.store.activeRunId = activeRun.id;
        assistantMock.agentPlan.store.activeRun = activeRun;
        assistantMock.agentPlan.store.getToolActivities = vi.fn((): IAiToolActivityInline[] => [
            {
                id: 'activity-read-file',
                stepId: 'plan-step-2',
                toolName: 'read_file',
                state: 'running',
                label: '正在读取 AiAssistantPanel.vue…',
                startedAt: '2026-04-29T10:00:01.000Z',
            },
            {
                id: 'activity-run-test',
                stepId: 'plan-step-3',
                toolName: 'run_test',
                state: 'succeeded',
                label: '已运行全过程测试',
                startedAt: '2026-04-29T10:00:02.000Z',
            },
        ]);
        assistantMock.agentPlan.store.getStepFinalAnswers = vi.fn((): IAiAgentStepFinalAnswer[] => [
            {
                id: 'final-answer-1',
                runId: activeRun.id,
                stepId: 'plan-step-3',
                content: finalAnswer,
                createdAt: '2026-04-29T10:00:03.000Z',
            },
        ]);
        useAiAssistantMock.mockReturnValue(assistantMock);

        const wrapper = mount(AiAssistantPanel, {
            props: {
                document: createDocument(),
                activeRun: null as IActiveRunSummary | null,
                analysis: createAnalysis(),
                selection: null as IEditorSelectionSummary | null,
                gitStatus: createGitStatus(),
                workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
            },
            global: {
                stubs: {
                    AiChatThread: {
                        props: ['messages'],
                        template: `
                            <section data-testid="chat-thread">
                                <article
                                    v-for="message in messages"
                                    :key="message.id"
                                    :data-role="message.role"
                                >
                                    <p>{{ message.content }}</p>
                                    <ol v-if="message.toolCalls?.length">
                                        <li
                                            v-for="toolCall in message.toolCalls"
                                            :key="toolCall.id"
                                        >
                                            {{ toolCall.name }}:{{ toolCall.status }}:{{ toolCall.summary }}
                                        </li>
                                    </ol>
                                </article>
                            </section>
                        `,
                    },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPromptInput: { template: '<div />' },
                    AiProviderSettings: { template: '<div />' },
                    AiPlanModePanel: { template: '<div data-testid="plan-mode-panel" />' },
                    teleport: true,
                },
            },
        });

        const chatThread = wrapper.get('[data-testid="chat-thread"]');

        expect(chatThread.text()).toContain(userQuestion);
        expect(chatThread.text()).toContain('read_file:running');
        expect(chatThread.text()).toContain('run_test:succeeded');
        expect(chatThread.text()).toContain(finalAnswer);
        expect(wrapper.find('[data-testid="agent-run-timeline"]').exists()).toBe(false);
    });

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
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
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
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
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
            },
            global: {
                stubs: {
                    AiChatThread: { template: '<div />' },
                    AiContextChips: { template: '<div />' },
                    AiPatchPreview: { template: '<div />' },
                    AiPlanModePanel: { template: '<div />' },
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
