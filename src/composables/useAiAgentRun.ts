import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import {
  mapSidecarToolNameToAiToolName,
  projectSidecarExecuteResponse,
} from '@/utils/agent-sidecar-events';
import { toErrorMessage } from '@/utils/error';

import type { IAgentSidecarMessage } from '@/types/agent-sidecar';
import type {
  IAiAgentRun,
  IAiAgentStepFinalAnswer,
  IAiAgentStepToolResultSummary,
  IAiContextReference,
  IAiTaskPlanStep,
  IAiToolCall,
  TAiToolConfirmationDecision,
} from '@/types/ai';

interface ISidecarStepLoopOptions {
  goal: string;
  context?: IAiContextReference[];
  workspaceRootPath?: string | null;
}

interface ISidecarStepLoopSession {
  runId: string;
  stepId: string;
  goal: string;
  messages: IAgentSidecarMessage[];
  context: IAiContextReference[];
  workspaceRootPath?: string | null;
  sessionId?: string;
  pendingRequestId?: string;
}

const SIDECAR_STEP_CONFIRMATION_PREFIX = 'sidecar-step-tool-confirmation:';

const findRunningStep = (run: IAiAgentRun | null): IAiTaskPlanStep | null =>
  run?.steps.find((step) => step.status === 'running') ?? null;

const buildStepSidecarMessages = (
  run: IAiAgentRun,
  step: IAiTaskPlanStep,
  goal: string,
): IAgentSidecarMessage[] => {
  const toolList = step.tools.length ? step.tools.join(', ') : '未限定，按任务需要选择可用工具';

  return [
    {
      role: 'system',
      content: [
        '你正在执行 IDE Agent Plan 的单个步骤。',
        '必须围绕当前步骤目标调用可用工具；不要执行与当前步骤无关的操作。',
        '如果需要高风险工具，请通过 sidecar approval 事件等待用户确认。',
        '写盘、删除、命令、安装依赖和 Git 操作都必须保留可回滚语义。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `任务目标：${goal || run.goal}`,
        `当前步骤：${step.title}`,
        `步骤目标：${step.goal}`,
        `预期产物：${step.expectedOutput}`,
        `建议工具：${toolList}`,
        '请执行这个步骤，并在完成后给出简短结论。',
      ].join('\n'),
    },
  ];
};

const createSidecarStepConfirmationId = (
  session: ISidecarStepLoopSession,
  requestId: string,
): string =>
  `${SIDECAR_STEP_CONFIRMATION_PREFIX}${session.runId}:${session.stepId}:${requestId}`;

const mapToolCallStatusToActivityState = (
  status: IAiToolCall['status'],
): 'running' | 'succeeded' | 'failed' | 'cancelled' => {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'denied':
      return 'cancelled';
    case 'pending':
    case 'running':
    default:
      return 'running';
  }
};

const toStepToolResultSummaries = (
  runId: string,
  stepId: string,
  toolCalls: readonly IAiToolCall[],
): IAiAgentStepToolResultSummary[] => {
  const endedAt = new Date().toISOString();

  return toolCalls
    .filter((toolCall) => toolCall.status === 'succeeded' || toolCall.status === 'failed')
    .map((toolCall) => ({
      id: toolCall.id,
      runId,
      stepId,
      toolName: mapSidecarToolNameToAiToolName(toolCall.name),
      status: toolCall.status === 'succeeded' ? 'succeeded' : 'failed',
      summary: toolCall.summary,
      startedAt: endedAt,
      endedAt,
    }));
};

const toStepFinalAnswer = (
  runId: string,
  stepId: string,
  content: string,
  createdAt: string,
  eventCount: number,
): IAiAgentStepFinalAnswer => ({
  id: `${runId}:${stepId}:final:${eventCount}:${createdAt}`,
  runId,
  stepId,
  content,
  createdAt,
});

export const useAiAgentRun = () => {
  const store = useAiAgentStore();
  const sidecarStepLoopSessions = new Map<string, ISidecarStepLoopSession>();

  const applyRunPayload = (run: IAiAgentRun): IAiAgentRun => {
    store.upsertRun(run);
    store.mode = 'agent';
    store.errorMessage = '';
    return run;
  };

  const appendSidecarToolState = (
    runId: string,
    stepId: string,
    toolCalls: readonly IAiToolCall[],
  ): void => {
    store.appendStepToolResults(
      runId,
      stepId,
      toStepToolResultSummaries(runId, stepId, toolCalls),
    );

    for (const toolCall of toolCalls) {
      store.appendToolActivity(runId, {
        id: `${toolCall.id}:activity`,
        stepId,
        toolName: mapSidecarToolNameToAiToolName(toolCall.name),
        state: mapToolCallStatusToActivityState(toolCall.status),
        label: toolCall.summary,
        targetPreview: toolCall.targetPreview,
        startedAt: new Date().toISOString(),
      });
    }
  };

  const runPlan = async (
    goal: string,
    steps: IAiTaskPlanStep[],
    context: IAiContextReference[] = [],
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.runPlan({ goal, steps, context });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '启动 Agent run 失败。');
      throw error;
    }
  };

  const runStep = async (
    runId: string,
    stepId?: string,
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.runStep({ runId, stepId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '执行 Agent step 失败。');
      throw error;
    }
  };

  const completeStepWithoutLegacyTools = async (
    runId: string,
    stepId: string,
  ): Promise<IAiAgentRun> => {
    const completedPayload = await aiService.runStep({
      runId,
      stepId,
      skipToolExecution: true,
    });

    return applyRunPayload(completedPayload.run);
  };

  const executeSidecarStepLoop = async (
    session: ISidecarStepLoopSession,
  ): Promise<IAiAgentRun> => {
    const payload = await aiService.sidecarExecute({
      ...(session.sessionId ? { sessionId: session.sessionId } : {}),
      goal: session.goal,
      messages: session.messages,
      context: session.context,
      workspaceRootPath: session.workspaceRootPath ?? null,
    });
    const projection = projectSidecarExecuteResponse(payload);

    appendSidecarToolState(session.runId, session.stepId, projection.toolCalls);

    if (projection.pendingConfirmation) {
      const confirmationId = createSidecarStepConfirmationId(
        session,
        projection.pendingConfirmation.id,
      );

      sidecarStepLoopSessions.set(confirmationId, {
        ...session,
        sessionId: payload.sessionId,
        pendingRequestId: projection.pendingConfirmation.id,
      });
      store.setPendingToolConfirmation({
        ...projection.pendingConfirmation,
        id: confirmationId,
        runId: session.runId,
        stepId: session.stepId,
      });

      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error('Sidecar step loop 已暂停，但当前 Agent run 不存在。');
      }
      return activeRun;
    }

    if (projection.errorMessage) {
      store.errorMessage = projection.errorMessage;
      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error(projection.errorMessage);
      }
      return activeRun;
    }

    const finalContent = projection.assistantContent.trim();
    if (finalContent) {
      const createdAt = new Date().toISOString();
      store.appendStepFinalAnswer(
        toStepFinalAnswer(
          session.runId,
          session.stepId,
          finalContent,
          createdAt,
          projection.toolCalls.length,
        ),
      );
    }

    return completeStepWithoutLegacyTools(session.runId, session.stepId);
  };

  const runStepWithSidecar = async (
    runId: string,
    options: ISidecarStepLoopOptions,
  ): Promise<IAiAgentRun> => {
    try {
      let run = store.activeRun?.id === runId ? store.activeRun : null;
      let step = findRunningStep(run);

      if (!step) {
        const startedPayload = await aiService.runStep({ runId });
        run = applyRunPayload(startedPayload.run);
        step = findRunningStep(run);
      }

      if (!run || !step) {
        throw new Error('当前没有可执行的 Agent step。');
      }

      const session: ISidecarStepLoopSession = {
        runId,
        stepId: step.id,
        goal: options.goal || run.goal,
        messages: buildStepSidecarMessages(run, step, options.goal),
        context: options.context ?? [],
        workspaceRootPath: options.workspaceRootPath ?? null,
      };

      return await executeSidecarStepLoop(session);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '执行 Agent step 失败。');
      throw error;
    }
  };

  const hasSidecarStepToolConfirmation = (confirmationId: string): boolean =>
    sidecarStepLoopSessions.has(confirmationId);

  const resolveSidecarStepToolConfirmation = async (
    confirmationId: string,
    decision: TAiToolConfirmationDecision,
  ): Promise<IAiAgentRun> => {
    const session = sidecarStepLoopSessions.get(confirmationId);

    if (!session) {
      throw new Error('当前没有可继续的 Sidecar step 工具确认。');
    }

    sidecarStepLoopSessions.delete(confirmationId);
    store.clearPendingToolConfirmation(confirmationId);

    if (decision === 'stop') {
      return cancelRun(session.runId);
    }

    const payload = await aiService.sidecarResolveApproval({
      requestId: session.pendingRequestId ?? confirmationId,
      decision,
    });
    const projection = projectSidecarExecuteResponse(payload);

    appendSidecarToolState(session.runId, session.stepId, projection.toolCalls);

    const finalContent = projection.assistantContent.trim();
    if (finalContent) {
      const createdAt = new Date().toISOString();
      store.appendStepFinalAnswer(
        toStepFinalAnswer(
          session.runId,
          session.stepId,
          finalContent,
          createdAt,
          projection.toolCalls.length,
        ),
      );
    }

    if (projection.pendingConfirmation) {
      const nextConfirmationId = createSidecarStepConfirmationId(
        session,
        projection.pendingConfirmation.id,
      );
      sidecarStepLoopSessions.set(nextConfirmationId, {
        ...session,
        sessionId: payload.sessionId,
        pendingRequestId: projection.pendingConfirmation.id,
      });
      store.setPendingToolConfirmation({
        ...projection.pendingConfirmation,
        id: nextConfirmationId,
        runId: session.runId,
        stepId: session.stepId,
      });
      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error('Sidecar step loop 已继续等待确认，但当前 Agent run 不存在。');
      }
      return activeRun;
    }

    if (projection.errorMessage) {
      store.errorMessage = projection.errorMessage;
      const activeRun = store.activeRun;
      if (!activeRun) {
        throw new Error(projection.errorMessage);
      }
      return activeRun;
    }

    return completeStepWithoutLegacyTools(session.runId, session.stepId);
  };

  const pauseRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.pauseRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '暂停 Agent run 失败。');
      throw error;
    }
  };

  const resumeRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.resumeRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '继续 Agent run 失败。');
      throw error;
    }
  };

  const cancelRun = async (runId: string): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.cancelRun({ runId });
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '取消 Agent run 失败。');
      throw error;
    }
  };

  const resolveToolConfirmation = async (
    runId: string,
    confirmationId: string,
    decision: TAiToolConfirmationDecision,
  ): Promise<IAiAgentRun> => {
    try {
      const payload = await aiService.resolveToolConfirmation({
        runId,
        confirmationId,
        decision,
      });
      store.clearPendingToolConfirmation(confirmationId);
      return applyRunPayload(payload.run);
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '处理工具确认失败。');
      throw error;
    }
  };

  const refreshRun = async (runId: string): Promise<IAiAgentRun> => {
    const payload = await aiService.getRun({ runId });
    return applyRunPayload(payload.run);
  };

  const loadRuns = async (): Promise<IAiAgentRun[]> => {
    const payload = await aiService.listRuns();
    store.setRuns(payload.runs);
    return payload.runs;
  };

  return {
    store,
    runPlan,
    runStep,
    runStepWithSidecar,
    pauseRun,
    resumeRun,
    cancelRun,
    resolveToolConfirmation,
    hasSidecarStepToolConfirmation,
    resolveSidecarStepToolConfirmation,
    refreshRun,
    loadRuns,
  };
};
