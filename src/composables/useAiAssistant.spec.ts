import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useAiAssistant } from '@/composables/useAiAssistant';
import { useAiAgentStore } from '@/store/aiAgent';
import { useAiConversationStore } from '@/store/aiConversation';
import { agentSidecarPlanRequestSchema } from '@/types/agent-sidecar.schema';
import type {
    IAgentSidecarExecuteRequest,
    IAgentSidecarPlanRequest,
    IAgentSidecarResponsePayload,
} from '@/types/agent-sidecar';
import type { IAiAgentRun, IAiChatStreamEventPayload, IAiTaskPlanStep } from '@/types/ai';
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
    let streamSequence = 0;
    const queuedStreamResponses: Array<{
        streamId: string;
        assistantMessageId: string;
        content: string;
        terminalKind: 'done' | 'error';
        terminalMessage: string | null;
    }> = [];

    const onChatStream = vi.fn(async (handler: StreamHandler) => {
        streamHandler = handler;
        return vi.fn(); // unsubscribe
    });

    const chatStream = vi.fn(async () => {
        const queued = queuedStreamResponses.shift();
        if (!queued) {
            return {
                streamId: STREAM_ID,
                assistantMessageId: ASSISTANT_MESSAGE_ID,
                providerType: 'mock',
                model: MOCK_MODEL,
            };
        }

        queueMicrotask(() => {
            streamHandler?.({
                streamId: queued.streamId,
                assistantMessageId: queued.assistantMessageId,
                kind: 'start',
                delta: null,
                message: null,
                model: MOCK_MODEL,
            });
            for (const chunk of queued.content.match(/.{1,24}/g) ?? []) {
                streamHandler?.({
                    streamId: queued.streamId,
                    assistantMessageId: queued.assistantMessageId,
                    kind: 'delta',
                    delta: chunk,
                    message: null,
                    model: MOCK_MODEL,
                });
            }
            streamHandler?.({
                streamId: queued.streamId,
                assistantMessageId: queued.assistantMessageId,
                kind: queued.terminalKind,
                delta: null,
                message: queued.terminalMessage,
                model: MOCK_MODEL,
            });
        });

        return {
            streamId: queued.streamId,
            assistantMessageId: queued.assistantMessageId,
            providerType: 'mock',
            model: MOCK_MODEL,
        };
    });

    const chat = vi.fn(async () => ({
        message: {
            id: ASSISTANT_MESSAGE_ID,
            role: 'assistant',
            content: '{"type":"final","content":"mock agent final"}',
            createdAt: '2026-04-29T00:00:00.000Z',
            references: [],
        },
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

    const proposePatch = vi.fn(async () => ({
        patch: {
            summary: 'mock patch',
            files: [],
        },
    }));

    const applyPatch = vi.fn(async () => ({
        appliedFiles: [],
    }));

    const classifyTask = vi.fn(async () => ({
        classification: 'complex',
        shouldEnterPlanMode: true,
        reason: '任务影响面较大，需要先进入计划模式。',
    }));

    const planTask = vi.fn(async () => ({
        steps: [
            {
                id: 'plan-step-1',
                index: 0,
                title: '收集上下文',
                goal: '收集上下文',
                kind: 'inspect',
                status: 'pending',
                expectedOutput: '浜у嚭褰卞搷鑼冨洿',
                tools: ['search_text'],
                requiresUserApproval: false,
                riskLevel: 'low',
            },
            {
                id: 'plan-step-2',
                index: 1,
                title: '杈撳嚭瀹炴柦璁″垝',
                goal: '杈撳嚭瀹炴柦璁″垝',
                kind: 'summarize',
                status: 'pending',
                expectedOutput: '产出可执行计划',
                tools: ['get_diagnostics'],
                requiresUserApproval: true,
                riskLevel: 'medium',
            },
        ],
    }));

    const createSidecarPlanResponse = (goal: string): IAgentSidecarResponsePayload => ({
        sessionId: 'sidecar-session-1',
        events: [
            {
                type: 'tool_start',
                toolName: 'search_project_files',
                input: { query: goal },
            },
            {
                type: 'tool_result',
                toolName: 'search_project_files',
                output: {
                    path: 'src/composables/useAiAssistant.ts',
                    summary: 'matched plan entry',
                },
            },
            {
                type: 'plan_ready',
                plan: {
                    goal,
                    steps: [
                        {
                            id: 'sidecar-plan-step-1',
                            title: '收集上下文',
                            goal: '璇诲彇褰撳墠闂銆侀」鐩枃浠跺拰鐩稿叧閿欒',
                            status: 'pending',
                            tools: ['search_project_files'],
                            riskLevel: 'low',
                            requiresApproval: false,
                            expectedOutput: '鏄庣‘褰卞搷鑼冨洿',
                        },
                        {
                            id: 'sidecar-plan-step-2',
                            title: '杈撳嚭瀹炴柦璁″垝',
                            goal: '缁欏嚭鍙墽琛屼慨鏀归『搴忓拰楠岃瘉鏂瑰紡',
                            status: 'pending',
                            tools: ['run_shell_command'],
                            riskLevel: 'medium',
                            requiresApproval: true,
                            expectedOutput: '寰楀埌鍙鎵圭殑鎵ц璁″垝',
                        },
                    ],
                },
            },
            {
                type: 'done',
                result: 'sidecar plan ready',
            },
        ],
        result: 'sidecar plan ready',
    });

    const sidecarPlan = vi.fn(async (payload: IAgentSidecarPlanRequest) =>
        createSidecarPlanResponse(payload.goal));

    const createSidecarExecuteResponse = (goal: string): IAgentSidecarResponsePayload => ({
        sessionId: 'sidecar-execute-session-1',
        events: [
            {
                type: 'tool_start',
                toolName: 'read_project_file',
                input: { path: 'src/app.ts' },
            },
            {
                type: 'tool_result',
                toolName: 'read_project_file',
                output: {
                    path: 'src/app.ts',
                    summary: '璇诲彇褰撳墠鑴氭湰瀹屾垚',
                },
            },
            {
                type: 'done',
                result: `已通过 Strands Agent 处理：${goal}`,
            },
        ],
        result: `已通过 Strands Agent 处理：${goal}`,
    });

    const sidecarExecute = vi.fn(async (payload: IAgentSidecarExecuteRequest) =>
        createSidecarExecuteResponse(payload.goal));

    const sidecarResolveApproval = vi.fn(async () => ({
        sessionId: 'sidecar-approval-session-1',
        events: [
            {
                type: 'done',
                result: '审批结果已交给 sidecar。',
            },
        ],
        result: '审批结果已交给 sidecar。',
    }));

    const approvePlan = vi.fn(async () => ({
        approvedAt: '2026-04-29T00:00:00.000Z',
        stepCount: 2,
    }));

    return {
        onChatStream,
        chat,
        chatStream,
        cancel,
        queryIndex,
        proposePatch,
        applyPatch,
        classifyTask,
        planTask,
        sidecarPlan,
        sidecarExecute,
        sidecarResolveApproval,
        approvePlan,
        queueStreamResponse(content: string, terminalKind: 'done' | 'error' = 'done', terminalMessage: string | null = null): void {
            streamSequence += 1;
            queuedStreamResponses.push({
                streamId: `${STREAM_ID}-${streamSequence}`,
                assistantMessageId: `${ASSISTANT_MESSAGE_ID}-${streamSequence}`,
                content,
                terminalKind,
                terminalMessage,
            });
        },
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
            streamSequence = 0;
            queuedStreamResponses.length = 0;
            onChatStream.mockClear();
            chat.mockClear();
            chatStream.mockClear();
            cancel.mockClear();
            queryIndex.mockClear();
            proposePatch.mockClear();
            applyPatch.mockClear();
            classifyTask.mockClear();
            planTask.mockClear();
            sidecarPlan.mockClear();
            sidecarExecute.mockClear();
            sidecarResolveApproval.mockClear();
            approvePlan.mockClear();
        },
    };
});

vi.mock('@/services/modules/ai', () => ({
    aiService: {
        onChatStream: aiServiceMock.onChatStream,
        chat: aiServiceMock.chat,
        chatStream: aiServiceMock.chatStream,
        cancel: aiServiceMock.cancel,
        queryIndex: aiServiceMock.queryIndex,
        proposePatch: aiServiceMock.proposePatch,
        applyPatch: aiServiceMock.applyPatch,
        classifyTask: aiServiceMock.classifyTask,
        planTask: aiServiceMock.planTask,
        sidecarPlan: aiServiceMock.sidecarPlan,
        sidecarExecute: aiServiceMock.sidecarExecute,
        sidecarResolveApproval: aiServiceMock.sidecarResolveApproval,
        approvePlan: aiServiceMock.approvePlan,
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
    expectedOutput: `${title}鐨勮緭鍑篳,
    tools: ['get_diagnostics'],
    requiresUserApproval: false,
    riskLevel: 'low',
});

const createAgentRun = (
    steps: IAiTaskPlanStep[],
    overrides: Partial<IAiAgentRun> = {},
): IAiAgentRun => ({
    id: 'agent-run-stale',
    goal: '旧计划',
    status: 'running-step',
    steps,
    currentStepId: steps[0]?.id ?? null,
    createdAt: '2026-04-29T00:00:00.000Z',
    updatedAt: '2026-04-29T00:00:01.000Z',
    startedAt: '2026-04-29T00:00:00.000Z',
    completedAt: null,
    errorMessage: null,
    ...overrides,
});

const createAssistantHarness = (): ReturnType<typeof useAiAssistant> =>
    createAssistantHarnessContext().assistant;

const createAssistantHarnessContext = (
    overrides: {
        analysis?: IAnalyzeScriptPayload;
    } = {},
) => {
    const document = ref(createDocument());
    const assistant = useAiAssistant({
        document,
        activeRun: ref(null),
        analysis: ref(overrides.analysis ?? createAnalysis()),
        selection: ref(null),
        gitStatus: ref(createGitStatus()),
        workspaceRootPath: ref(WORKSPACE_ROOT),
    });

    return {
        assistant,
        document,
    };
};

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

        assistant.activeMode.value = 'chat';
        assistant.draft.value = '瑙ｉ噴杩欐浠ｇ爜';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('鍓嶆枃 **markdown**\n\n```ts\nconst pending = true;');
        await flushMicrotasks();

        const assistantMessage = assistant.messages.value.at(-1);
        expect(assistantMessage?.content).toBe(
            '鍓嶆枃 **markdown**\n\n```ts\nconst pending = true;',
        );
        expect(assistantMessage?.stream?.status).toBe('streaming');

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('marks the open block cancelled immediately on stop and ignores late delta', async () => {
        const assistant = createAssistantHarness();

        assistant.activeMode.value = 'chat';
        assistant.draft.value = '缁х画';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        aiServiceMock.emitDelta('```ts\nconst pending = true;\n');
        await flushMicrotasks();

        assistant.stopCurrentRequest();

        const cancelledMessage = assistant.messages.value.at(-1);
        expect(aiServiceMock.cancel).toHaveBeenCalledWith({ streamId: STREAM_ID });
        expect(cancelledMessage?.stream?.status).toBe('cancelled');
        expect(cancelledMessage?.content).toBe('```ts\nconst pending = true;\n');

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
        expect(assistant.attachedFiles.value[0]?.detailLabel).toBe('640 脳 480');
        expect(assistant.attachedFiles.value[0]?.reference.kind).toBe('image-attachment');
        expect(assistant.attachedFiles.value[0]?.reference.content).toBeUndefined();

        assistant.activeMode.value = 'chat';
        assistant.draft.value = '';
        const sendPromise = assistant.sendMessage();

        await waitForStartedStream(() => assistant.messages.value.at(-1)?.id);

        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.chatStream.mock.calls[0]?.[0]?.references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'image-attachment',
                    label: '鍥剧墖闄勪欢 路 pasted-image.png',
                }),
            ]),
        );

        assistant.stopCurrentRequest();
        await sendPromise;
    });

    it('starts a new conversation by clearing draft and transient state', () => {
        const assistant = createAssistantHarness();

        assistant.draft.value = '杩樻病鍙戦€佺殑鍐呭';
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
            label: '褰撳墠鏂囦欢',
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

    it('runs a complex sidecar Plan flow and keeps the tool timeline in the conversation', async () => {
        const { assistant } = createAssistantHarnessContext();
        const userQuestion = '请完整规划：把 Agent 工具 UI 改成对话流时间线，修复 auto_apply_patch 参数，并跑测试';
        const finalAnswer = '我已完成复杂任务规划：先读取代码，再映射工具事件，最后跑类型检查和组件测试。';

        aiServiceMock.sidecarPlan.mockResolvedValueOnce({
            sessionId: 'sidecar-session-complex',
            events: [
                {
                    type: 'tool_start',
                    toolName: 'list_project_files',
                    input: { root: WORKSPACE_ROOT },
                },
                {
                    type: 'tool_result',
                    toolName: 'list_project_files',
                    output: {
                        files: [
                            'src/composables/useAiAssistant.ts',
                            'src/components/business/ai/AiMessageItem.vue',
                        ],
                    },
                },
                {
                    type: 'tool_start',
                    toolName: 'search_project_files',
                    input: { query: 'auto_apply_patch files schema' },
                },
                {
                    type: 'tool_result',
                    toolName: 'search_project_files',
                    output: {
                        path: 'src-tauri/src/ai_agent/tool_loop.rs',
                        summary: 'found tool schema validation path',
                    },
                },
                {
                    type: 'approval_required',
                    request: {
                        id: 'approval-write-file',
                        toolName: 'write_file',
                        question: '鏄惁鍏佽淇敼 Agent UI 鍜屽伐鍏峰弬鏁版槧灏勶紵',
                        summary: '需要写入前端组件、composable 和测试文件。',
                        riskLevel: 'medium',
                        reversible: true,
                        createdAt: '2026-04-29T00:00:00.000Z',
                    },
                },
                {
                    type: 'plan_ready',
                    plan: {
                        goal: userQuestion,
                        steps: [
                            {
                                id: 'complex-step-1',
                                title: '核对 Agent 对话流入口',
                                goal: '确认 chat、agent、plan 三种模式的触发路径',
                                status: 'pending',
                                tools: ['list_project_files', 'search_project_files'],
                                riskLevel: 'low',
                                requiresApproval: false,
                                expectedOutput: '得到真实调用链和受影响文件',
                            },
                            {
                                id: 'complex-step-2',
                                title: '淇宸ュ叿浜嬩欢涓?auto_apply_patch 鍙傛暟',
                                goal: '让工具调用按统一事件协议进入时间线',
                                status: 'pending',
                                tools: ['write_file'],
                                riskLevel: 'medium',
                                requiresApproval: true,
                                expectedOutput: '宸ュ叿浜嬩欢銆佸鎵广€乨iff 閮藉彲琚?UI 鍛堢幇',
                            },
                            {
                                id: 'complex-step-3',
                                title: '璺戝叏杩囩▼鍥炲綊娴嬭瘯',
                                goal: '验证用户问题、工具活动、审批和最终回答',
                                status: 'pending',
                                tools: ['run_shell_command'],
                                riskLevel: 'medium',
                                requiresApproval: true,
                                expectedOutput: '绫诲瀷妫€鏌ュ拰 Vitest 鍏ㄩ儴閫氳繃',
                            },
                        ],
                    },
                },
                {
                    type: 'done',
                    result: finalAnswer,
                },
            ],
            result: finalAnswer,
        });

        assistant.activeMode.value = 'plan';
        assistant.draft.value = userQuestion;

        await assistant.sendMessage();

        expect(assistant.messages.value).toHaveLength(2);
        expect(assistant.messages.value[0]).toMatchObject({
            role: 'user',
            content: userQuestion,
        });
        expect(assistant.messages.value[1]).toMatchObject({
            role: 'assistant',
            content: finalAnswer,
        });
        expect(assistant.messages.value[1]?.toolCalls).toEqual([
            expect.objectContaining({
                name: 'list_project_files',
                status: 'succeeded',
            }),
            expect.objectContaining({
                name: 'search_project_files',
                status: 'succeeded',
            }),
            expect.objectContaining({
                name: 'write_file',
                status: 'pending',
            }),
        ]);
        expect(aiServiceMock.classifyTask).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.sidecarPlan).toHaveBeenCalledWith(expect.objectContaining({
            goal: userQuestion,
            messages: [{ role: 'user', content: userQuestion }],
            workspaceRootPath: WORKSPACE_ROOT,
        }));
        expect(aiServiceMock.planTask).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(0);
        expect(assistant.agentSteps.value).toHaveLength(3);
        expect(assistant.agentPlan.store.steps).toHaveLength(3);
        expect(assistant.agentPlan.store.steps[1]?.requiresUserApproval).toBe(true);
    });

    it('鍙戦€佽鍒掕姹傚墠鎶婄己澶辩殑褰撳墠鏂囦欢璺緞褰掍竴涓?null锛岄伩鍏?IPC 鍏ュ弬鏍￠獙澶辫触', async () => {
        const { assistant, document } = createAssistantHarnessContext();

        Reflect.deleteProperty(document.value, 'path');
        assistant.activeMode.value = 'plan';
        assistant.draft.value = '@current-file 淇敼瀹屽杽杩欎釜鏂囦欢';

        await assistant.sendMessage();

        const planPayload = aiServiceMock.sidecarPlan.mock.calls[0]?.[0];

        expect(planPayload?.context[0]).toMatchObject({
            kind: 'current-file',
            path: null,
        });
        expect(planPayload?.context[0]?.path).toBeNull();
        expect(agentSidecarPlanRequestSchema.safeParse(planPayload).success).toBe(true);
    });

    it('璁″垝鐢熸垚澶辫触鏃舵竻鎺夋棫姝ラ鍜屾棫 run锛岄伩鍏嶅崱鍦ㄦ墽琛屼腑', async () => {
        const { assistant } = createAssistantHarnessContext();
        const staleSteps = [
            createPlanStep('plan-step-1', '鏃ц鍒掔涓€姝?, 'running'),
            createPlanStep('plan-step-2', '鏃ц鍒掔浜屾'),
        ];
        const planStore = assistant.agentPlan.store;
        const userQuestion = '@current-file 淇敼瀹屽杽杩欎釜鏂囦欢';

        planStore.setPlan('鏃ц鍒?, staleSteps);
        planStore.approvedAt = '2026-04-29T00:00:00.000Z';
        planStore.upsertRun(createAgentRun(staleSteps));
        assistant.agentSteps.value = staleSteps.map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
        }));
        aiServiceMock.classifyTask.mockResolvedValueOnce({
            classification: 'complex',
            shouldEnterPlanMode: true,
            reason: '当前请求需要多步计划。',
        });
        aiServiceMock.sidecarPlan.mockRejectedValueOnce(
            new Error('IPC 请求参数无效，已记录 traceId=b45c10a5-d0d1-487d-bd。'),
        );

        assistant.activeMode.value = 'plan';
        assistant.draft.value = userQuestion;

        await assistant.sendMessage();

        expect(planStore.steps).toHaveLength(0);
        expect(planStore.activeRunId).toBeNull();
        expect(planStore.approvedAt).toBeNull();
        expect(planStore.errorMessage).toContain('IPC 璇锋眰鍙傛暟鏃犳晥');
        expect(assistant.agentSteps.value).toHaveLength(0);
        expect(assistant.draft.value).toBe(userQuestion);
    });

    it('uses Strands sidecar execute directly in agent mode without generating a plan', async () => {
        const { assistant } = createAssistantHarnessContext();

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '瑙ｉ噴褰撳墠鑴氭湰';

        await assistant.sendMessage();

        expect(aiServiceMock.classifyTask).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.planTask).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.sidecarPlan).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.chatStream).toHaveBeenCalledTimes(0);
        expect(aiServiceMock.sidecarExecute).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.applyPatch).toHaveBeenCalledTimes(0);
        expect(assistant.messages.value[1]?.content).toContain('已通过 Strands Agent 处理：');
        expect(assistant.messages.value[1]?.toolCalls?.[0]).toMatchObject({
            name: 'read_project_file',
            status: 'succeeded',
            summary: expect.stringContaining('src/app.ts'),
        });
    });

    it('passes UI context to Strands sidecar agent mode as system context', async () => {
        const { assistant } = createAssistantHarnessContext();

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '@current-file 涓板瘜涓€涓嬬洰鍓嶇殑鑴氭湰鍐呭';

        await assistant.sendMessage();

        const request = aiServiceMock.sidecarExecute.mock.calls[0]?.[0];

        expect(request?.messages[0]).toMatchObject({
            role: 'system',
        });
        expect(request?.messages[0]?.content).toContain('当前 UI 已收集到这些上下文');
        expect(request?.messages[0]?.content).toContain('src/app.ts');
        expect(request?.messages.at(-1)).toMatchObject({
            role: 'user',
            content: '@current-file 涓板瘜涓€涓嬬洰鍓嶇殑鑴氭湰鍐呭',
        });
    });

    it('projects sidecar approval requests into the direct Agent confirmation UI', async () => {
        const { assistant } = createAssistantHarnessContext();
        const agentStore = useAiAgentStore();
        const timestamp = '2026-04-29T00:00:00.000Z';

        aiServiceMock.sidecarExecute.mockResolvedValueOnce({
            sessionId: 'sidecar-confirmation-session',
            events: [
                {
                    type: 'approval_required',
                    request: {
                        id: 'approval-run-command',
                        toolName: 'run_shell_command',
                        question: '鍏佽 Agent 鎵ц pnpm test 鍚楋紵',
                        summary: '运行最小验证命令。',
                        riskLevel: 'medium',
                        reversible: false,
                        createdAt: timestamp,
                    },
                },
                {
                    type: 'done',
                    result: 'Agent 姝ｅ湪绛夊緟纭锛氬厑璁?Agent 鎵ц pnpm test 鍚楋紵',
                },
            ],
            result: 'Agent 姝ｅ湪绛夊緟纭锛氬厑璁?Agent 鎵ц pnpm test 鍚楋紵',
        });

        assistant.activeMode.value = 'agent';
        assistant.draft.value = '运行一次最小验证';

        await assistant.sendMessage();

        expect(agentStore.pendingToolConfirmation).toMatchObject({
            id: 'approval-run-command',
            runId: 'sidecar:sidecar-confirmation-session',
            toolName: 'run_command',
            question: '鍏佽 Agent 鎵ц pnpm test 鍚楋紵',
        });
        expect(assistant.messages.value[1]?.content).toContain('绛夊緟纭');

        await assistant.resolveSidecarToolConfirmation('allow-once');

        expect(aiServiceMock.sidecarResolveApproval).toHaveBeenCalledWith({
            requestId: 'approval-run-command',
            decision: 'allow-once',
        });
        expect(agentStore.pendingToolConfirmation).toBeNull();
        expect(assistant.messages.value[1]?.content).toContain('瀹℃壒缁撴灉宸蹭氦缁?sidecar');
    });

    it('applies patch by normalizing the returned path and syncing the current document', async () => {
        const { assistant, document } = createAssistantHarnessContext();
        document.value.path = 'D:/test/xiaojianc.sh';
        document.value.name = 'xiaojianc.sh';
        document.value.content = 'echo old';
        document.value.savedContent = 'echo old';
        document.value.lineCount = 1;
        document.value.charCount = 8;

        assistant.proposedPatch.value = {
            summary: '淇鑴氭湰杈撳嚭',
            files: [
                {
                    path: 'D:/test/xiaojianc.sh',
                    originalHash: 'fnv64:test',
                    hunks: [
                        {
                            oldStart: 1,
                            oldLines: 1,
                            newStart: 1,
                            newLines: 1,
                            lines: ['-echo old', '+echo new'],
                        },
                    ],
                },
            ],
        };

        aiServiceMock.applyPatch.mockResolvedValueOnce({
            appliedFiles: [
                {
                    path: String.raw`\\?\D:\test\xiaojianc.sh`,
                    byteSize: 8,
                },
            ],
        });

        await assistant.applyProposedPatch();

        expect(document.value.path).toBe('D:/test/xiaojianc.sh');
        expect(document.value.content).toBe('echo new');
        expect(document.value.savedContent).toBe('echo new');
        expect(document.value.isDirty).toBe(false);
        expect(document.value.lineCount).toBe(1);
        expect(document.value.charCount).toBe(8);
        expect(assistant.messages.value.at(-1)?.content).toBe('Patch 宸插簲鐢細D:/test/xiaojianc.sh');
        expect(assistant.proposedPatch.value).toBeNull();
    });

    it('passes Agent run and step metadata when applying a proposed patch', async () => {
        const { assistant, document } = createAssistantHarnessContext();
        const agentStore = useAiAgentStore();

        document.value.path = 'D:/test/xiaojianc.sh';
        document.value.name = 'xiaojianc.sh';
        document.value.content = 'echo old';
        document.value.savedContent = 'echo old';

        agentStore.upsertRun({
            id: 'run-1',
            goal: '鏇存柊褰撳墠鑴氭湰',
            status: 'running-step',
            currentStepId: 'step-1',
            createdAt: '2026-04-29T10:00:00.000Z',
            updatedAt: '2026-04-29T10:00:00.000Z',
            startedAt: '2026-04-29T10:00:00.000Z',
            completedAt: null,
            errorMessage: null,
            steps: [
                {
                    id: 'step-1',
                    index: 0,
                    title: '搴旂敤 patch',
                    goal: '搴旂敤 patch',
                    kind: 'edit',
                    status: 'running',
                    expectedOutput: '当前文件已更新',
                    tools: ['propose_patch'],
                    requiresUserApproval: true,
                    riskLevel: 'medium',
                },
                {
                    id: 'step-2',
                    index: 1,
                    title: '楠岃瘉淇敼',
                    goal: '楠岃瘉淇敼',
                    kind: 'verify',
                    status: 'pending',
                    expectedOutput: '楠岃瘉缁撴灉',
                    tools: ['get_diagnostics'],
                    requiresUserApproval: false,
                    riskLevel: 'low',
                },
            ],
        });

        assistant.proposedPatch.value = {
            summary: '鏇存柊杈撳嚭',
            files: [
                {
                    path: 'D:/test/xiaojianc.sh',
                    originalHash: 'fnv64:test',
                    hunks: [
                        {
                            oldStart: 1,
                            oldLines: 1,
                            newStart: 1,
                            newLines: 1,
                            lines: ['-echo old', '+echo new'],
                        },
                    ],
                },
            ],
        };
        aiServiceMock.applyPatch.mockResolvedValueOnce({
            appliedFiles: [
                {
                    path: 'D:/test/xiaojianc.sh',
                    byteSize: 8,
                },
            ],
        });

        await assistant.applyProposedPatch();

        expect(aiServiceMock.applyPatch).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                agentRunId: 'run-1',
                agentStepId: 'step-1',
                confirmedByUser: true,
            }),
        }));
        expect(agentStore.getPatchSummaries('run-1')).toHaveLength(0);
    });
});
