import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAgentRun } from '@/composables/useAiAgentRun';
import { useAiAgentStore } from '@/store/aiAgent';
import type { IAiAgentRun, IAiTaskPlanStep } from '@/types/ai';

const aiServiceMock = vi.hoisted(() => {
    const sidecarExecute = vi.fn();
    const sidecarResolveApproval = vi.fn();
    const onSidecarStream = vi.fn(async () => vi.fn());

    return {
        sidecarExecute,
        sidecarResolveApproval,
        onSidecarStream,
        reset(): void {
            sidecarExecute.mockReset();
            sidecarResolveApproval.mockReset();
            onSidecarStream.mockReset();
            onSidecarStream.mockResolvedValue(vi.fn());
        },
    };
});

vi.mock('@/services/modules/ai', () => ({
    aiService: {
        sidecarExecute: aiServiceMock.sidecarExecute,
        sidecarResolveApproval: aiServiceMock.sidecarResolveApproval,
        onSidecarStream: aiServiceMock.onSidecarStream,
    },
}));

const createStep = (index: number, status: IAiTaskPlanStep['status'] = 'pending'): IAiTaskPlanStep => ({
    id: `plan-step-${index + 1}`,
    index,
    title: index === 0 ? '收集上下文' : '验证结果',
    goal: index === 0 ? '收集上下文' : '验证结果',
    kind: index === 0 ? 'inspect' : 'verify',
    status,
    expectedOutput: index === 0 ? '影响范围' : '验证结论',
    tools: index === 0 ? ['search_text'] : ['run_test'],
    requiresUserApproval: false,
    riskLevel: 'low',
});

const createRun = (
    overrides: Partial<IAiAgentRun> = {},
): IAiAgentRun => {
    const steps = [createStep(0), createStep(1)];

    return {
        id: 'agent-run-1',
        goal: '实现 Step Runtime',
        status: 'running-plan',
        steps,
        currentStepId: null,
        createdAt: '2026-04-29T10:00:00.000Z',
        updatedAt: '2026-04-29T10:00:00.000Z',
        startedAt: '2026-04-29T10:00:00.000Z',
        completedAt: null,
        errorMessage: null,
        ...overrides,
    };
};

describe('useAiAgentRun', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        aiServiceMock.reset();
    });

    it('启动 run 后写入 activeRun 与当前计划步骤', async () => {
        const run = createRun();
        const agentRun = useAiAgentRun();
        const store = useAiAgentStore();

        const createdRun = await agentRun.runPlan(run.goal, run.steps);

        expect(createdRun.goal).toBe(run.goal);
        expect(store.mode).toBe('agent');
        expect(store.activeRunId).toBe(createdRun.id);
        expect(store.activeRun?.id).toBe(createdRun.id);
        expect(store.steps).toEqual(createdRun.steps);
    });

    it('执行 step 时本地切到 running-step', async () => {
        const agentRun = useAiAgentRun();
        const store = useAiAgentStore();
        const run = await agentRun.runPlan('实现 Step Runtime', createRun().steps);

        await agentRun.runStep(run.id);

        expect(agentRun.store.activeRun?.status).toBe('running-step');
        expect(agentRun.store.activeRun?.currentStepId).toBe('plan-step-1');
        expect(store.steps[0]?.status).toBe('running');
    });

    it('通过 Strands sidecar 执行复杂任务 step 并完成步骤', async () => {
        aiServiceMock.sidecarExecute.mockResolvedValueOnce({
            sessionId: 'sidecar-step-session-1',
            events: [
                {
                    type: 'tool_start',
                    toolName: 'search_project_files',
                    input: { query: 'Step Runtime' },
                },
                {
                    type: 'tool_result',
                    toolName: 'search_project_files',
                    output: { summary: '已检索上下文。' },
                },
                {
                    type: 'done',
                    result: '步骤已完成。',
                },
            ],
            result: '步骤已完成。',
        });

        const agentRun = useAiAgentRun();
        const store = useAiAgentStore();
        const run = await agentRun.runPlan('实现 Step Runtime', createRun().steps);

        await agentRun.runStepWithSidecar(run.id, {
            goal: '实现 Step Runtime',
            context: [],
            workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
        });

        expect(aiServiceMock.sidecarExecute).toHaveBeenCalledTimes(1);
        expect(aiServiceMock.sidecarExecute.mock.calls[0]?.[0]).toMatchObject({
            goal: '实现 Step Runtime',
            workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
        });
        expect(store.activeRun?.steps[0]?.status).toBe('done');
        expect(store.activeRun?.status).toBe('running-plan');
        expect(store.getStepDetail(run.id, 'plan-step-1')?.toolResults[0]?.summary)
            .toBe('已检索上下文。');
        expect(store.getStepFinalAnswers(run.id)[0]?.content).toBe('步骤已完成。');
    });

    it('Sidecar step 工具确认后通过 sidecar approval 继续并完成步骤', async () => {
        aiServiceMock.sidecarExecute.mockResolvedValueOnce({
            sessionId: 'sidecar-step-session-confirm',
            events: [
                {
                    type: 'approval_required',
                    request: {
                        id: 'call-run-test',
                        toolName: 'run_shell_command',
                        question: '允许 Agent 使用 run_test 吗？',
                        summary: '步骤请求运行测试。',
                        riskLevel: 'medium',
                        reversible: true,
                        createdAt: '2026-04-29T10:00:00.000Z',
                    },
                },
                {
                    type: 'done',
                    result: '等待用户确认。',
                },
            ],
            result: '等待用户确认。',
        });
        aiServiceMock.sidecarResolveApproval.mockResolvedValueOnce({
            sessionId: 'sidecar-step-session-confirm-2',
            events: [
                {
                    type: 'done',
                    result: '验证完成。',
                },
            ],
            result: '验证完成。',
        });

        const agentRun = useAiAgentRun();
        const store = useAiAgentStore();
        const run = await agentRun.runPlan('实现 Step Runtime', createRun().steps);

        await agentRun.runStepWithSidecar(run.id, {
            goal: '实现 Step Runtime',
            context: [],
            workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
        });

        const confirmationId = store.pendingToolConfirmation?.id;
        expect(confirmationId).toContain('sidecar-step-tool-confirmation:');
        expect(store.activeRun?.status).toBe('waiting-for-tool-confirmation');

        await agentRun.resolveSidecarStepToolConfirmation(confirmationId ?? '', 'allow-once');

        expect(aiServiceMock.sidecarResolveApproval).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'sidecar-step-session-confirm',
            requestId: 'call-run-test',
            decision: 'allow-once',
        }));
        expect(store.pendingToolConfirmation).toBeNull();
        expect(store.activeRun?.steps[0]?.status).toBe('done');
        expect(store.getStepFinalAnswers(run.id)[0]?.content).toBe('验证完成。');
    });

    it('暂停、继续、取消 run 都在本地回写 store', async () => {
        const agentRun = useAiAgentRun();
        const run = await agentRun.runPlan('实现 Step Runtime', createRun().steps);

        await agentRun.pauseRun(run.id);
        expect(agentRun.store.activeRun?.status).toBe('paused');

        await agentRun.resumeRun(run.id);
        expect(agentRun.store.activeRun?.status).toBe('running-plan');

        await agentRun.cancelRun(run.id);
        expect(agentRun.store.activeRun?.status).toBe('cancelled');
    });

    it('legacy 工具确认链已移除，只接受 sidecar 审批链', async () => {
        const agentRun = useAiAgentRun();
        await agentRun.runPlan('实现 Step Runtime', createRun().steps);

        await expect(
            agentRun.resolveToolConfirmation('agent-run-1', 'confirmation-1', 'skip'),
        ).rejects.toThrow('Legacy Agent 工具确认链已移除');
    });
});
