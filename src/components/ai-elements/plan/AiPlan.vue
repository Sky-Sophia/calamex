<script setup lang="ts">
import Check from '~icons/lucide/check';
import ChevronUp from '~icons/lucide/chevron-up';
import FileText from '~icons/lucide/file-text';
import RotateCw from '~icons/lucide/rotate-cw';
import Trash2 from '~icons/lucide/trash2';
import X from '~icons/lucide/x';
import { computed, ref } from 'vue';

import type { TAgentPlanStatus } from '@/types/agent-sidecar';
import type { IAiTaskPlanStep } from '@/types/ai';

const props = defineProps<{
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
  updateTitle: [stepId: string, title: string];
  removeStep: [stepId: string];
  regenerate: [];
  reject: [];
  approve: [];
}>();

const MIN_STEP_COUNT = 2;
const isCollapsed = ref(false);

const overviewText = computed(() =>
  props.summary?.trim() || props.goal.trim() || 'AI 已生成一份计划，请确认后开始执行。',
);

const approvalLabel = computed(() => {
  if (props.status === 'rejected') {
    return '已拒绝';
  }

  if (props.status === 'completed') {
    return '已完成';
  }

  if (props.status === 'failed') {
    return '失败';
  }

  if (props.approvedAt || props.status === 'approved' || props.status === 'executing') {
    return props.canApprove ? '启动运行' : '已批准';
  }

  return props.isApproving ? '批准中...' : '批准并启动';
});

const canReject = computed(() =>
  !props.approvedAt &&
  props.status !== 'approved' &&
  props.status !== 'rejected' &&
  props.status !== 'executing' &&
  props.status !== 'completed' &&
  props.status !== 'failed',
);

const getInputValue = (event: Event): string =>
  event.target instanceof HTMLInputElement ? event.target.value : '';

const submitTitle = (stepId: string, title: string): void => {
  const normalized = title.trim();
  if (!normalized) {
    return;
  }

  emit('updateTitle', stepId, normalized);
};

const handleTitleEnter = (stepId: string, event: Event): void => {
  submitTitle(stepId, getInputValue(event));
};

const handleTitleBlur = (step: IAiTaskPlanStep, event: Event): void => {
  const nextTitle = getInputValue(event).trim();

  if (nextTitle && nextTitle !== step.title) {
    emit('updateTitle', step.id, nextTitle);
  }
};

const toggleCollapsed = (): void => {
  isCollapsed.value = !isCollapsed.value;
};
</script>

<template>
  <section class="ai-element-plan" :class="{ 'is-collapsed': isCollapsed }" aria-label="已生成计划">
    <header class="ai-element-plan-header">
      <div class="ai-element-plan-title-group">
        <FileText class="ai-element-plan-title-icon" aria-hidden="true" />
        <h3 class="ai-element-plan-title">{{ goal || '确认计划' }}</h3>
      </div>
      <button
        type="button"
        class="ai-element-plan-collapse"
        :aria-expanded="!isCollapsed"
        :aria-label="isCollapsed ? '展开计划' : '收起计划'"
        @click="toggleCollapsed"
      >
        <ChevronUp class="ai-element-plan-collapse-icon" :class="{ 'is-collapsed': isCollapsed }" aria-hidden="true" />
      </button>
    </header>

    <Transition name="ai-element-plan-content">
      <div v-if="!isCollapsed" class="ai-element-plan-content">
        <section class="ai-element-plan-section" aria-label="计划概览">
          <h4>概览</h4>
          <p>{{ overviewText }}</p>
        </section>

        <section class="ai-element-plan-section" aria-label="关键步骤">
          <h4>关键步骤</h4>
          <ol class="ai-element-plan-steps">
            <li
              v-for="step in steps"
              :key="step.id"
              class="ai-element-plan-step"
              :class="[`is-${step.status}`, `risk-${step.riskLevel}`]"
            >
              <span class="ai-element-plan-step-bullet" aria-hidden="true"></span>
              <input
                v-if="canEdit"
                class="ai-element-plan-step-title"
                :value="step.title"
                aria-label="编辑计划步骤标题"
                :disabled="isPlanning"
                @keydown.enter.prevent="handleTitleEnter(step.id, $event)"
                @blur="handleTitleBlur(step, $event)"
              />
              <span v-else class="ai-element-plan-step-title is-readonly">{{ step.title }}</span>
              <button
                v-if="canEdit"
                type="button"
                class="ai-plan-step-remove"
                :disabled="steps.length <= MIN_STEP_COUNT || isPlanning"
                aria-label="删除计划步骤"
                title="删除计划步骤"
                @click="emit('removeStep', step.id)"
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          </ol>
        </section>

        <footer class="ai-element-plan-actions">
          <button
            type="button"
            class="ai-plan-button"
            :disabled="isPlanning || isApproving"
            @click="emit('regenerate')"
          >
            <RotateCw aria-hidden="true" />
            重生成
          </button>
          <button
            type="button"
            class="ai-plan-button"
            :disabled="isPlanning || isApproving || !canReject"
            @click="emit('reject')"
          >
            <X aria-hidden="true" />
            拒绝
          </button>
          <button
            type="button"
            class="ai-plan-button is-primary"
            :disabled="!canApprove || isPlanning || isApproving"
            @click="emit('approve')"
          >
            <Check aria-hidden="true" />
            {{ approvalLabel }}
          </button>
        </footer>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.ai-element-plan {
  --ai-plan-border-width: thin;
  --ai-plan-focus-ring-size: 0.08em;
  --ai-plan-gap-xs: calc(var(--app-density-scale) * 0.25rem);
  --ai-plan-gap-sm: calc(var(--app-density-scale) * 0.375rem);
  --ai-plan-gap-md: calc(var(--app-density-scale) * 0.5rem);
  --ai-plan-gap-lg: calc(var(--app-density-scale) * 0.875rem);
  --ai-plan-gap-xl: calc(var(--app-density-scale) * 1.25rem);
  --ai-plan-padding: calc(var(--app-density-scale) * 1.25rem);
  --ai-plan-bullet-size: calc(var(--app-density-scale) * 0.3125rem);
  --ai-plan-remove-size: calc(var(--app-density-scale) * 1.375rem);
  --ai-plan-action-height: calc(var(--app-density-scale) * 1.875rem);
  --ai-plan-action-padding-inline: calc(var(--app-density-scale) * 0.625rem);
  --ai-plan-font-sm: calc(var(--app-ui-font-size) * 0.92);
  --ai-plan-font-md: calc(var(--app-ui-font-size) * 1);
  --ai-plan-font-lg: calc(var(--app-ui-font-size) * 1.22);
  --ai-plan-icon-size: 1em;
  display: grid;
  width: min(100%, calc(var(--app-density-scale) * 45rem));
  gap: var(--ai-plan-gap-lg);
  border: var(--ai-plan-border-width) solid color-mix(in srgb, var(--shell-divider) 92%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--panel-bg) 96%, transparent);
  padding: var(--ai-plan-padding);
}

.ai-element-plan-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ai-plan-gap-md);
}

.ai-element-plan-title-group {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--ai-plan-gap-md);
}

.ai-element-plan-title-icon {
  width: calc(var(--app-density-scale) * 1.125rem);
  height: calc(var(--app-density-scale) * 1.125rem);
  flex: 0 0 auto;
  color: var(--text-primary);
  stroke-width: 2;
}

.ai-element-plan-title {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: var(--ai-plan-font-lg);
  font-weight: 650;
  line-height: 1.35;
}

.ai-element-plan-collapse {
  display: inline-grid;
  width: calc(var(--app-density-scale) * 1.625rem);
  height: calc(var(--app-density-scale) * 1.625rem);
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.ai-element-plan-collapse:hover {
  background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
  color: var(--text-primary);
}

.ai-element-plan-collapse:active {
  transform: scale(0.97);
}

.ai-element-plan-collapse-icon {
  width: calc(var(--app-density-scale) * 0.9375rem);
  height: calc(var(--app-density-scale) * 0.9375rem);
  transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.ai-element-plan-collapse-icon.is-collapsed {
  transform: rotate(180deg);
}

.ai-element-plan-content {
  display: grid;
  gap: var(--ai-plan-gap-xl);
  overflow: hidden;
}

.ai-element-plan-content-enter-active,
.ai-element-plan-content-leave-active {
  max-block-size: calc(var(--app-density-scale) * 38rem);
  overflow: hidden;
  transition:
    max-block-size var(--motion-duration-normal) var(--motion-easing-emphasized),
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.ai-element-plan-content-enter-from,
.ai-element-plan-content-leave-to {
  max-block-size: 0;
  opacity: 0;
  transform: translateY(calc(var(--app-density-scale) * -0.25rem));
}

.ai-element-plan-content-enter-to,
.ai-element-plan-content-leave-from {
  max-block-size: calc(var(--app-density-scale) * 38rem);
  opacity: 1;
  transform: translateY(0);
}

.ai-element-plan-summary {
  margin: 0;
  max-width: calc(var(--app-density-scale) * 42rem);
  color: var(--text-secondary);
  font-size: var(--ai-plan-font-md);
  line-height: 1.5;
}

.ai-element-plan-section {
  display: grid;
  gap: var(--ai-plan-gap-md);
}

.ai-element-plan-section h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--ai-plan-font-md);
  font-weight: 650;
  line-height: 1.4;
}

.ai-element-plan-section p {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--ai-plan-font-md);
  line-height: 1.55;
}

.ai-element-plan-steps {
  display: grid;
  gap: var(--ai-plan-gap-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-element-plan-step {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--ai-plan-gap-md);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
}

.ai-element-plan-step:hover {
  background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
}

.ai-element-plan-step-bullet {
  width: var(--ai-plan-bullet-size);
  height: var(--ai-plan-bullet-size);
  flex: 0 0 auto;
  border-radius: calc(var(--radius-xl) * 1000);
  background: currentColor;
}

.ai-element-plan-step-title {
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--ai-plan-font-md);
  font-weight: 400;
  line-height: 1.45;
  outline: none;
  padding: 0;
}

.ai-element-plan-step-title:focus {
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
  box-shadow: 0 0 0 var(--ai-plan-focus-ring-size) color-mix(in srgb, var(--accent-strong) 34%, transparent);
}

.ai-element-plan-step-title.is-readonly {
  overflow-wrap: anywhere;
}

.ai-plan-step-remove {
  display: inline-grid;
  width: var(--ai-plan-remove-size);
  height: var(--ai-plan-remove-size);
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-quaternary);
}

.ai-plan-step-remove:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.ai-plan-step-remove:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ai-plan-step-remove svg,
.ai-plan-button svg {
  width: var(--ai-plan-icon-size);
  height: var(--ai-plan-icon-size);
  stroke-width: 2;
}

.ai-element-plan-actions {
  display: flex;
  align-items: center;
  gap: var(--ai-plan-gap-md);
  justify-content: flex-end;
}

.ai-plan-button {
  display: inline-flex;
  height: var(--ai-plan-action-height);
  align-items: center;
  gap: var(--ai-plan-gap-sm);
  border: var(--ai-plan-border-width) solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--ai-plan-font-sm);
  padding: 0 var(--ai-plan-action-padding-inline);
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.ai-plan-button.is-primary {
  margin-left: auto;
  border-color: color-mix(in srgb, var(--accent-strong) 35%, var(--shell-divider));
  background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
  color: var(--text-primary);
}

.ai-plan-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
  color: var(--text-primary);
}

.ai-plan-button:active:not(:disabled) {
  transform: scale(0.97);
}

.ai-plan-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .ai-element-plan-collapse,
  .ai-element-plan-collapse-icon,
  .ai-element-plan-content-enter-active,
  .ai-element-plan-content-leave-active,
  .ai-plan-button {
    transition-duration: 1ms;
  }

  .ai-element-plan-content-enter-from,
  .ai-element-plan-content-leave-to {
    transform: none;
  }
}
</style>
