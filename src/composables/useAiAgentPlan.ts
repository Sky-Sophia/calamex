import { ref } from 'vue';

import { aiService } from '@/services/modules/ai';
import { useAiAgentStore } from '@/store/aiAgent';
import { projectSidecarPlanResponse } from '@/utils/agent-sidecar-events';
import { toErrorMessage } from '@/utils/error';

import type {
  IAiContextReference,
  IAiTaskPlanStep,
  IAiToolCall,
} from '@/types/ai';

const MIN_PLAN_STEPS = 2;
const MAX_PLAN_STEPS = 6;

export interface IAiAgentPlanCreationResult {
  steps: IAiTaskPlanStep[];
  toolCalls: IAiToolCall[];
  assistantContent: string;
}

const cloneContext = (
  context: IAiContextReference[],
): IAiContextReference[] => context.map((item) => ({ ...item }));

const assertValidGoal = (goal: string, message: string): void => {
  if (!goal.trim()) {
    throw new Error(message);
  }
};

const assertValidPlanSteps = (steps: IAiTaskPlanStep[]): void => {
  if (steps.length < MIN_PLAN_STEPS || steps.length > MAX_PLAN_STEPS) {
    throw new Error(`计划步骤数必须在 ${MIN_PLAN_STEPS} 到 ${MAX_PLAN_STEPS} 之间。`);
  }
};

export const useAiAgentPlan = () => {
  const store = useAiAgentStore();

  const latestContext = ref<IAiContextReference[]>([]);
  const latestWorkspaceRootPath = ref<string | null>(null);

  const classifyTask = async (
    goal: string,
    context: IAiContextReference[],
  ): Promise<void> => {
    store.beginPlanning(goal);
    store.isClassifying = true;

    try {
      const contextSnapshot = cloneContext(context);

      const payload = await aiService.classifyTask({
        goal,
        context: contextSnapshot,
      });

      latestContext.value = contextSnapshot;
      store.setClassification(payload);
    } catch (error) {
      store.failPlanning(goal, toErrorMessage(error, '任务分类失败。'));
      throw error;
    } finally {
      store.isClassifying = false;
    }
  };

  const createPlan = async (
    goal: string,
    context: IAiContextReference[],
    workspaceRootPath: string | null = null,
  ): Promise<IAiAgentPlanCreationResult> => {
    store.beginPlanning(goal);
    store.isPlanning = true;

    try {
      assertValidGoal(goal, '任务目标不能为空。');

      const contextSnapshot = cloneContext(context);
      const payload = await aiService.sidecarPlan({
        goal,
        messages: [
          {
            role: 'user',
            content: goal,
          },
        ],
        workspaceRootPath,
        context: contextSnapshot,
      });
      const projection = projectSidecarPlanResponse(payload, goal);

      if (projection.errorMessage) {
        throw new Error(projection.errorMessage);
      }

      latestContext.value = contextSnapshot;
      latestWorkspaceRootPath.value = workspaceRootPath;
      store.mode = 'plan';
      store.setPlan(projection.goal, projection.steps);

      return {
        steps: projection.steps,
        toolCalls: projection.toolCalls,
        assistantContent: projection.assistantContent,
      };
    } catch (error) {
      store.failPlanning(goal, toErrorMessage(error, '生成计划失败。'));
      throw error;
    } finally {
      store.isPlanning = false;
    }
  };

  const regeneratePlan = async (): Promise<IAiTaskPlanStep[]> => {
    assertValidGoal(store.activeGoal, '当前没有可重新生成的计划目标。');

    return (await createPlan(
      store.activeGoal,
      latestContext.value,
      latestWorkspaceRootPath.value,
    )).steps;
  };

  const updateStep = (
    stepId: string,
    partial: Partial<IAiTaskPlanStep>,
  ): void => {
    const current = store.steps.find((step) => step.id === stepId);

    if (!current) {
      return;
    }

    store.replaceStep(stepId, {
      ...current,
      ...partial,
      id: current.id,
    });
  };

  const removeStep = (stepId: string): void => {
    if (store.steps.length <= MIN_PLAN_STEPS) {
      throw new Error(`计划至少保留 ${MIN_PLAN_STEPS} 步。`);
    }

    store.removeStep(stepId);
  };

  const approvePlan = async (): Promise<void> => {
    assertValidGoal(store.activeGoal, '任务目标不能为空。');
    assertValidPlanSteps(store.steps);

    store.isApproving = true;
    store.errorMessage = '';

    try {
      store.approvedAt = new Date().toISOString();
      store.mode = 'agent';
    } catch (error) {
      store.errorMessage = toErrorMessage(error, '批准计划失败。');
      throw error;
    } finally {
      store.isApproving = false;
    }
  };

  const resetPlan = (): void => {
    store.clearPlan();
    latestContext.value = [];
    latestWorkspaceRootPath.value = null;
  };

  return {
    store,
    classifyTask,
    createPlan,
    regeneratePlan,
    updateStep,
    removeStep,
    approvePlan,
    resetPlan,
  };
};
