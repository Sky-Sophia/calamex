<script setup lang="ts">
import { ChevronDown, LoaderCircle } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import AiPlanApprovalBar from '@/components/business/ai/AiPlanApprovalBar.vue';
import AiPlanStepList from '@/components/business/ai/AiPlanStepList.vue';
import AiToolConfirmationCard from '@/components/business/ai/AiToolConfirmationCard.vue';
import AiWebSearchActivity from '@/components/business/ai/AiWebSearchActivity.vue';
import type {
    IAiAgentRun,
    IAiToolConfirmationRequest,
    IAiToolActivityInline,
    IAiTaskPlanStep,
    IAiWebActivity,
    TAiAgentRunStatus,
    TAiToolConfirmationDecision,
} from '@/types/ai';

const props = defineProps<{
    goal: string;
    steps: IAiTaskPlanStep[];
    classificationReason: string;
    errorMessage: string;
    isPlanning: boolean;
    isApproving: boolean;
    approvedAt: string | null;
    activeRun: IAiAgentRun | null;
    isRunActionPending: boolean;
    isClassifying?: boolean;
    webActivity?: IAiWebActivity | null;
    toolActivity?: IAiToolActivityInline | null;
    toolConfirmation?: IAiToolConfirmationRequest | null;
}>();

const isCollapsed = ref(false);
const planContentId = 'ai-plan-mode-panel-content';

const emit = defineEmits<{
    updateStepTitle: [stepId: string, title: string];
    removeStep: [stepId: string];
    regenerate: [];
    reset: [];
    approve: [];
    runStep: [];
    pauseRun: [];
    resumeRun: [];
    cancelRun: [];
    resolveToolConfirmation: [decision: TAiToolConfirmationDecision];
}>();

const canApprove = computed(() =>
    props.steps.length >= 2 && props.steps.length <= 6 && !props.activeRun,
);

const isTerminalRunStatus = (status: TAiAgentRunStatus): boolean =>
    status === 'completed' || status === 'failed' || status === 'cancelled';

const runStatusLabel = computed(() => {
    if (!props.activeRun) {
        return props.approvedAt ? '等待启动' : '';
    }

    switch (props.activeRun.status) {
        case 'waiting-for-plan-approval':
            return '等待批准';
        case 'running-plan':
            return '运行中';
        case 'running-step':
            return '执行步骤中';
        case 'waiting-for-tool-confirmation':
            return '等待工具确认';
        case 'paused':
            return '已暂停';
        case 'completed':
            return '已完成';
        case 'failed':
            return '失败';
        case 'cancelled':
            return '已取消';
        default:
            return '未知状态';
    }
});

const runStatusClass = computed(() =>
    props.activeRun ? `is-${props.activeRun.status}` : 'is-waiting',
);

const currentStepTitle = computed(() => {
    if (!props.activeRun?.currentStepId) {
        return '';
    }

    return props.activeRun.steps.find((step) => step.id === props.activeRun?.currentStepId)?.title ?? '';
});

const completedStepCount = computed(() =>
    props.steps.filter((step) => step.status === 'done').length,
);

const totalStepCount = computed(() =>
    props.steps.length,
);

const todoTitle = computed(() =>
    totalStepCount.value > 0
        ? `待办事项(${completedStepCount.value}/${totalStepCount.value})`
        : '待办事项',
);

const planStateLabel = computed(() => {
    if (props.isClassifying) {
        return '判断任务';
    }

    if (props.isPlanning) {
        return '生成计划';
    }

    if (props.activeRun) {
        return runStatusLabel.value;
    }

    if (props.approvedAt) {
        return '已批准';
    }

    if (props.steps.length) {
        return '待确认';
    }

    return '计划';
});

const loadingLabel = computed(() =>
    props.isClassifying ? '正在判断是否需要计划…' : '正在生成计划…',
);

const collapseLabel = computed(() =>
    isCollapsed.value ? '展开待办事项' : '收起待办事项',
);

const shouldShowContextLine = computed(() =>
    !props.steps.length && Boolean(props.goal || props.classificationReason),
);

const canRunStep = computed(() => {
    if (!props.activeRun || props.isRunActionPending || props.toolConfirmation) {
        return false;
    }

    return props.activeRun.status !== 'paused' &&
        props.activeRun.status !== 'waiting-for-tool-confirmation' &&
        !isTerminalRunStatus(props.activeRun.status);
});

const canPauseRun = computed(() => {
    if (!props.activeRun || props.isRunActionPending) {
        return false;
    }

    return props.activeRun.status === 'running-plan' || props.activeRun.status === 'running-step';
});

const canResumeRun = computed(() =>
    Boolean(props.activeRun && props.activeRun.status === 'paused' && !props.isRunActionPending),
);

const canCancelRun = computed(() => {
    if (!props.activeRun || props.isRunActionPending) {
        return false;
    }

    return !isTerminalRunStatus(props.activeRun.status);
});

const runStepLabel = computed(() =>
    props.activeRun?.status === 'running-step' ? '完成当前步骤' : '执行下一步',
);

const handleUpdateStepTitle = (stepId: string, title: string): void => {
    emit('updateStepTitle', stepId, title);
};

const handleRemoveStep = (stepId: string): void => {
    emit('removeStep', stepId);
};

const toggleCollapsed = (): void => {
    isCollapsed.value = !isCollapsed.value;
};
</script>

<template>
    <section class="ai-plan-mode-panel" aria-label="计划模式">
        <header class="ai-plan-header">
            <button
                type="button"
                class="ai-plan-title-button"
                :aria-expanded="!isCollapsed"
                :aria-controls="planContentId"
                :aria-label="collapseLabel"
                @click="toggleCollapsed"
            >
                <ChevronDown class="ai-plan-caret" :class="{ 'is-collapsed': isCollapsed }" aria-hidden="true" />
                <h3>{{ todoTitle }}</h3>
            </button>
            <span class="ai-plan-state-label">{{ planStateLabel }}</span>
        </header>

        <div v-if="!isCollapsed" :id="planContentId" class="ai-plan-body">
            <p v-if="shouldShowContextLine" class="ai-plan-reason">
                {{ goal || classificationReason }}
            </p>
            <p v-if="approvedAt && !activeRun" class="ai-plan-approved">计划已批准，正在等待启动 Agent run。</p>
            <p v-if="errorMessage" class="ai-plan-error">
                <strong>计划生成失败</strong>
                <span>{{ errorMessage }}</span>
            </p>

            <div v-if="isClassifying || isPlanning" class="ai-plan-loading">
                <LoaderCircle class="ai-plan-status-icon is-spinning" aria-hidden="true" />
                <span>{{ loadingLabel }}</span>
            </div>

            <AiPlanStepList
                v-if="steps.length"
                :steps="steps"
                @update-title="handleUpdateStepTitle"
                @remove-step="handleRemoveStep"
            />

            <AiWebSearchActivity :activity="webActivity ?? null" />

            <AiToolConfirmationCard
                v-if="toolConfirmation"
                :confirmation="toolConfirmation"
                :disabled="isRunActionPending"
                @resolve="emit('resolveToolConfirmation', $event)"
            />

            <div v-if="toolActivity" class="ai-plan-tool-activity" aria-live="polite">
                <LoaderCircle class="ai-plan-status-icon is-spinning" aria-hidden="true" />
                <span>{{ toolActivity.label }}</span>
            </div>

            <section v-if="activeRun" class="ai-plan-run-card" aria-label="Agent run 状态">
                <header class="ai-plan-run-header">
                    <span class="ai-plan-run-dot" :class="runStatusClass" aria-hidden="true"></span>
                    <strong>{{ runStatusLabel }}</strong>
                    <span>{{ completedStepCount }}/{{ activeRun.steps.length }} 步</span>
                </header>
                <p v-if="currentStepTitle" class="ai-plan-run-current">当前步骤：{{ currentStepTitle }}</p>
                <p v-if="activeRun.errorMessage" class="ai-plan-error">{{ activeRun.errorMessage }}</p>
                <footer class="ai-plan-run-actions">
                    <button
                        v-if="canResumeRun"
                        type="button"
                        class="ai-plan-button is-primary"
                        :disabled="isRunActionPending"
                        @click="emit('resumeRun')"
                    >
                        继续运行
                    </button>
                    <button
                        v-else
                        type="button"
                        class="ai-plan-button is-primary"
                        :disabled="!canRunStep"
                        @click="emit('runStep')"
                    >
                        {{ isRunActionPending ? '执行中...' : runStepLabel }}
                    </button>
                    <button
                        type="button"
                        class="ai-plan-button"
                        :disabled="!canPauseRun"
                        @click="emit('pauseRun')"
                    >
                        暂停
                    </button>
                    <button
                        type="button"
                        class="ai-plan-button"
                        :disabled="!canCancelRun"
                        @click="emit('cancelRun')"
                    >
                        取消
                    </button>
                </footer>
            </section>

            <AiPlanApprovalBar
                :is-planning="Boolean(isClassifying) || isPlanning"
                :is-approving="isApproving"
                :can-approve="canApprove"
                :approved-at="approvedAt"
                @regenerate="emit('regenerate')"
                @reset="emit('reset')"
                @approve="emit('approve')"
            />
        </div>
    </section>
</template>

<style scoped>
.ai-plan-mode-panel {
    display: grid;
    gap: 6px;
    border-top: 1px solid var(--shell-divider);
    background: color-mix(in srgb, var(--panel-bg) 86%, transparent);
    padding: 8px 12px;
}

.ai-plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.ai-plan-title-button {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    color: inherit;
    padding: 2px 4px 2px 0;
    transition:
        color 120ms cubic-bezier(0.23, 1, 0.32, 1),
        transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-plan-title-button:hover {
    color: var(--text-primary);
}

.ai-plan-title-button:active {
    transform: scale(0.99);
}

.ai-plan-caret {
    width: 13px;
    height: 13px;
    color: var(--text-quaternary);
    transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-plan-caret.is-collapsed {
    transform: rotate(-90deg);
}

.ai-plan-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
}

.ai-plan-state-label {
    color: var(--text-quaternary);
    font-size: 11px;
    white-space: nowrap;
}

.ai-plan-body {
    display: grid;
    gap: 6px;
}

.ai-plan-goal,
.ai-plan-reason,
.ai-plan-approved,
.ai-plan-error,
.ai-plan-loading {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
}

.ai-plan-goal {
    color: var(--text-secondary);
}

.ai-plan-reason {
    color: var(--text-tertiary);
}

.ai-plan-error {
    display: grid;
    gap: 2px;
    color: var(--danger);
}

.ai-plan-error strong {
    font-size: 12px;
    font-weight: 600;
}

.ai-plan-error span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ai-plan-approved {
    color: var(--text-tertiary);
}

.ai-plan-loading {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--text-quaternary);
}

.ai-plan-tool-activity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 7px;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 18px;
}

.ai-plan-tool-activity > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ai-plan-status-icon {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    color: var(--text-tertiary);
    stroke-width: 2;
}

.ai-plan-status-icon.is-spinning {
    animation: ai-plan-status-spin 900ms linear infinite;
}

.ai-plan-run-card {
    display: grid;
    gap: 8px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 85%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface-soft) 62%, transparent);
    padding: 9px;
}

.ai-plan-run-header {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: var(--text-quaternary);
    font-size: 11px;
}

.ai-plan-run-header strong {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
}

.ai-plan-run-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--text-quaternary);
}

.ai-plan-run-dot.is-running-plan,
.ai-plan-run-dot.is-running-step,
.ai-plan-run-dot.is-waiting-for-tool-confirmation {
    background: var(--accent-strong);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong) 12%, transparent);
}

.ai-plan-run-dot.is-completed {
    background: var(--success);
}

.ai-plan-run-dot.is-failed,
.ai-plan-run-dot.is-cancelled {
    background: var(--danger);
}

.ai-plan-run-current {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
}

.ai-plan-run-actions {
    display: flex;
    align-items: center;
    gap: 7px;
}

.ai-plan-button {
    height: 26px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    padding: 0 9px;
}

.ai-plan-button.is-primary {
    border-color: color-mix(in srgb, var(--accent-strong) 35%, var(--shell-divider));
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--text-primary);
}

.ai-plan-button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

@keyframes ai-plan-status-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .ai-plan-status-icon.is-spinning {
        animation: none;
    }
}
</style>
