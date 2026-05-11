<script setup lang="ts">
import { AiPlan } from '@/components/ai-elements/plan';
import { Message } from '@/components/ai-elements/message';
import type { TAgentPlanStatus } from '@/types/agent-sidecar';
import type { IAiTaskPlanStep } from '@/types/ai';

defineProps<{
  goal: string;
  summary: string | null;
  status: TAgentPlanStatus | null;
  steps: IAiTaskPlanStep[];
  isPlanning: boolean;
  isApproving: boolean;
  canEdit: boolean;
  canApprove: boolean;
  approvedAt: string | null;
}>();

const emit = defineEmits<{
  updateStepTitle: [stepId: string, title: string];
  removeStep: [stepId: string];
  regenerate: [];
  reject: [];
  approve: [];
}>();
</script>

<template>
  <Message from="assistant" class="ai-plan-confirmation-message">
    <AiPlan
      class="ai-plan-confirmation-message__plan"
      :goal="goal"
      :summary="summary"
      :status="status"
      :steps="steps"
      :is-planning="isPlanning"
      :is-approving="isApproving"
      :can-edit="canEdit"
      :can-approve="canApprove"
      :approved-at="approvedAt"
      @update-title="(stepId, title) => emit('updateStepTitle', stepId, title)"
      @remove-step="emit('removeStep', $event)"
      @regenerate="emit('regenerate')"
      @reject="emit('reject')"
      @approve="emit('approve')"
    />
  </Message>
</template>

<style scoped>
.ai-plan-confirmation-message {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding-left: calc(var(--app-density-scale) * 0.75rem);
  padding-right: calc(var(--app-density-scale) * 5.5rem);
}

.ai-plan-confirmation-message__plan {
  width: min(100%, calc(var(--app-density-scale) * 45rem));
}
</style>
