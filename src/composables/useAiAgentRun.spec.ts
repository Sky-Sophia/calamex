import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAgentRun } from '@/composables/useAiAgentRun';
import { useAiAgentStore } from '@/store/aiAgent';
import type { IAiAgentRun, IAiTaskPlanStep } from '@/types/ai';

const aiServiceMock = vi.hoisted(() => {
  const runPlan = vi.fn();
  const runStep = vi.fn();
  const pauseRun = vi.fn();
  const resumeRun = vi.fn();
  const cancelRun = vi.fn();
  const resolveToolConfirmation = vi.fn();
  const sidecarExecute = vi.fn();
  const sidecarResolveApproval = vi.fn();
  const getRun = vi.fn();
  const listRuns = vi.fn();

  return {
    runPlan,
    runStep,
    pauseRun,
    resumeRun,
    cancelRun,
    resolveToolConfirmation,
    sidecarExecute,
    sidecarResolveApproval,
    getRun,
    listRuns,
    reset(): void {
      runPlan.mockReset();
      runStep.mockReset();
      pauseRun.mockReset();
      resumeRun.mockReset();
      cancelRun.mockReset();
      resolveToolConfirmation.mockReset();
      sidecarExecute.mockReset();
      sidecarResolveApproval.mockReset();
      getRun.mockReset();
      listRuns.mockReset();
    },
  };
});

vi.mock('@/services/modules/ai', () => ({
  aiService: {
    runPlan: aiServiceMock.runPlan,
    runStep: aiServiceMock.runStep,
    pauseRun: aiServiceMock.pauseRun,
    resumeRun: aiServiceMock.resumeRun,
    cancelRun: aiServiceMock.cancelRun,
    resolveToolConfirmation: aiServiceMock.resolveToolConfirmation,
    sidecarExecute: aiServiceMock.sidecarExecute,
    sidecarResolveApproval: aiServiceMock.sidecarResolveApproval,
    getRun: aiServiceMock.getRun,
    listRuns: aiServiceMock.listRuns,
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
    aiServiceMock.runPlan.mockResolvedValueOnce({ run });

    const agentRun = useAiAgentRun();
    const store = useAiAgentStore();

    await agentRun.runPlan(run.goal, run.steps);

    expect(aiServiceMock.runPlan).toHaveBeenCalledWith({
      goal: run.goal,
      steps: run.steps,
      context: [],
    });
    expect(store.mode).toBe('agent');
    expect(store.activeRunId).toBe(run.id);
    expect(store.activeRun?.id).toBe(run.id);
    expect(store.steps).toEqual(run.steps);
  });

  it('执行 step 后同步运行态与 step 状态', async () => {
    const runningRun = createRun({
      status: 'running-step',
      currentStepId: 'plan-step-1',
      steps: [createStep(0, 'running'), createStep(1)],
    });
    aiServiceMock.runStep.mockResolvedValueOnce({ run: runningRun });

    const agentRun = useAiAgentRun();

    await agentRun.runStep('agent-run-1');

    expect(aiServiceMock.runStep).toHaveBeenCalledWith({ runId: 'agent-run-1', stepId: undefined });
    expect(agentRun.store.activeRun?.status).toBe('running-step');
    expect(agentRun.store.steps[0]?.status).toBe('running');
  });

  it('通过 Strands sidecar 执行复杂任务 step，并跳过旧 step 工具执行完成步骤', async () => {
    const runningRun = createRun({
      status: 'running-step',
      currentStepId: 'plan-step-1',
      steps: [createStep(0, 'running'), createStep(1)],
    });
    const completedRun = createRun({
      status: 'running-plan',
      steps: [createStep(0, 'done'), createStep(1)],
    });
    aiServiceMock.runStep
      .mockResolvedValueOnce({ run: runningRun })
      .mockResolvedValueOnce({ run: completedRun });
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
    store.upsertRun(createRun());

    await agentRun.runStepWithSidecar('agent-run-1', {
      goal: '实现 Step Runtime',
      context: [],
      workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
    });

    expect(aiServiceMock.sidecarExecute).toHaveBeenCalledTimes(1);
    expect(aiServiceMock.sidecarExecute.mock.calls[0]?.[0]).toMatchObject({
      goal: '实现 Step Runtime',
      workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
    });
    expect(aiServiceMock.runStep).toHaveBeenLastCalledWith({
      runId: 'agent-run-1',
      stepId: 'plan-step-1',
      skipToolExecution: true,
    });
    expect(store.activeRun?.steps[0]?.status).toBe('done');
    expect(store.getStepDetail('agent-run-1', 'plan-step-1')?.toolResults[0]?.summary)
      .toBe('已检索上下文。');
    expect(store.getStepFinalAnswers('agent-run-1')[0]?.content).toBe('步骤已完成。');
  });

  it('Sidecar step 工具确认后通过 sidecar approval 继续并完成步骤', async () => {
    const runningRun = createRun({
      status: 'running-step',
      currentStepId: 'plan-step-1',
      steps: [createStep(0, 'running'), createStep(1)],
    });
    const completedRun = createRun({
      status: 'running-plan',
      steps: [createStep(0, 'done'), createStep(1)],
    });
    aiServiceMock.runStep
      .mockResolvedValueOnce({ run: runningRun })
      .mockResolvedValueOnce({ run: completedRun });
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
    store.upsertRun(createRun());

    await agentRun.runStepWithSidecar('agent-run-1', {
      goal: '实现 Step Runtime',
      context: [],
      workspaceRootPath: 'd:/com.xiaojianc/my_desktop_app',
    });

    const confirmationId = store.pendingToolConfirmation?.id;
    expect(confirmationId).toContain('sidecar-step-tool-confirmation:');

    await agentRun.resolveSidecarStepToolConfirmation(confirmationId ?? '', 'allow-once');

    expect(aiServiceMock.sidecarResolveApproval).toHaveBeenCalledWith({
      requestId: 'call-run-test',
      decision: 'allow-once',
    });
    expect(store.pendingToolConfirmation).toBeNull();
    expect(store.activeRun?.steps[0]?.status).toBe('done');
    expect(store.getStepFinalAnswers('agent-run-1')[0]?.content).toBe('验证完成。');
  });

  it('暂停、继续、取消 run 都通过 service 并回写 store', async () => {
    aiServiceMock.pauseRun.mockResolvedValueOnce({ run: createRun({ status: 'paused' }) });
    aiServiceMock.resumeRun.mockResolvedValueOnce({ run: createRun({ status: 'running-plan' }) });
    aiServiceMock.cancelRun.mockResolvedValueOnce({ run: createRun({ status: 'cancelled' }) });

    const agentRun = useAiAgentRun();

    await agentRun.pauseRun('agent-run-1');
    expect(agentRun.store.activeRun?.status).toBe('paused');

    await agentRun.resumeRun('agent-run-1');
    expect(agentRun.store.activeRun?.status).toBe('running-plan');

    await agentRun.cancelRun('agent-run-1');
    expect(agentRun.store.activeRun?.status).toBe('cancelled');
  });

  it('处理内联工具确认后清理待确认状态并回写 run', async () => {
    const run = createRun({ status: 'running-step' });
    aiServiceMock.resolveToolConfirmation.mockResolvedValueOnce({ run });

    const agentRun = useAiAgentRun();
    const store = useAiAgentStore();
    store.setPendingToolConfirmation({
      id: 'confirmation-1',
      runId: 'agent-run-1',
      stepId: 'plan-step-1',
      toolName: 'run_test',
      question: '允许 Agent 使用 run_test 吗？',
      summary: '步骤请求运行测试。',
      riskLevel: 'medium',
      reversible: true,
      createdAt: '2026-04-29T10:00:00.000Z',
      options: [],
    });

    await agentRun.resolveToolConfirmation('agent-run-1', 'confirmation-1', 'skip');

    expect(aiServiceMock.resolveToolConfirmation).toHaveBeenCalledWith({
      runId: 'agent-run-1',
      confirmationId: 'confirmation-1',
      decision: 'skip',
    });
    expect(store.pendingToolConfirmation).toBeNull();
    expect(store.activeRun?.id).toBe('agent-run-1');
  });
});
