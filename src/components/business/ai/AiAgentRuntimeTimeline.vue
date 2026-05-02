<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next';
import { computed, ref } from 'vue';

import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';

const MAX_VISIBLE_EVENTS = 6;

const props = defineProps<{
  events: TAgentRuntimeEvent[];
}>();

const isExpanded = ref(true);

const timelineEvents = computed(() =>
  props.events
    .filter((event) => event.visibility === 'user')
    .slice(-MAX_VISIBLE_EVENTS),
);

const completedStepCount = computed(() =>
  props.events.filter((event) =>
    event.type === 'agent.tool.completed' ||
    event.type === 'rollback.checkpoint.created' ||
    event.type === 'rollback.restore.completed'
  ).length,
);

const isRunFinished = computed(() =>
  [...props.events].reverse().some((event) =>
    event.type === 'agent.run.completed' ||
    event.type === 'agent.run.error'
  ),
);

const summaryLabel = computed(() => {
  const count = completedStepCount.value;

  if (isRunFinished.value) {
    return count > 0 ? `${count} 个步骤已完成` : '执行已完成';
  }

  return count > 0 ? `${count} 个步骤进行中` : '正在准备执行';
});

const getEventLabel = (event: TAgentRuntimeEvent): string => {
  switch (event.type) {
    case 'agent.run.started':
      return '开始执行';
    case 'agent.tool.started':
      return `调用工具 ${event.toolName}`;
    case 'agent.tool.completed':
      return event.ok ? `工具完成 ${event.toolName}` : `工具失败 ${event.toolName}`;
    case 'rollback.checkpoint.created':
      return '已创建回滚点';
    case 'rollback.restore.completed':
      return '已恢复回滚点';
    case 'side_effect.warning':
      return '外部副作用提醒';
    case 'agent.run.error':
      return '执行失败';
    case 'agent.run.completed':
      return '执行完成';
    default:
      return event.type;
  }
};

const getEventDetail = (event: TAgentRuntimeEvent): string | null => {
  switch (event.type) {
    case 'agent.run.started':
      return event.inputPreview ?? null;
    case 'agent.tool.started':
      return event.inputPreview ?? null;
    case 'agent.tool.completed':
      return event.errorMessage ?? event.resultPreview ?? null;
    case 'rollback.checkpoint.created':
      return event.snapshotId ?? event.reason ?? null;
    case 'rollback.restore.completed':
      return event.message ?? null;
    case 'side_effect.warning':
      return event.message;
    case 'agent.run.error':
      return event.errorMessage;
    case 'agent.run.completed':
      return event.outputPreview ?? null;
    default:
      return null;
  }
};
</script>

<template>
  <section v-if="timelineEvents.length > 0" class="ai-runtime-timeline" aria-label="Agent 运行事件">
    <button
      type="button"
      class="ai-runtime-timeline__summary"
      :aria-expanded="isExpanded"
      @click="isExpanded = !isExpanded"
    >
      <span class="ai-runtime-timeline__line" aria-hidden="true"></span>
      <span class="ai-runtime-timeline__label">
        {{ summaryLabel }}
      </span>
      <ChevronDown
        class="ai-runtime-timeline__chevron"
        :class="{ 'is-open': isExpanded }"
        aria-hidden="true"
      />
      <span class="ai-runtime-timeline__line" aria-hidden="true"></span>
    </button>

    <ol v-if="isExpanded" class="ai-runtime-timeline__list">
      <li
        v-for="event in timelineEvents"
        :key="event.id"
        class="ai-runtime-timeline__item"
        :class="`is-${event.level ?? 'info'}`"
      >
        <span class="ai-runtime-timeline__dot" aria-hidden="true"></span>
        <span class="ai-runtime-timeline__copy">
          <span class="ai-runtime-timeline__event-label">{{ getEventLabel(event) }}</span>
          <span v-if="getEventDetail(event)" class="ai-runtime-timeline__event-detail">
            {{ getEventDetail(event) }}
          </span>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ai-runtime-timeline {
  flex: 0 0 auto;
  padding: 8px 12px 0;
  color: var(--text-tertiary);
  font-size: 12px;
}

.ai-runtime-timeline__summary {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
}

.ai-runtime-timeline__summary:hover {
  color: var(--text-primary);
}

.ai-runtime-timeline__line {
  height: 1px;
  min-width: 18px;
  flex: 1 1 auto;
  background: color-mix(in srgb, var(--shell-divider) 86%, transparent);
}

.ai-runtime-timeline__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-runtime-timeline__chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--text-quaternary);
  transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-runtime-timeline__chevron.is-open {
  transform: rotate(180deg);
}

.ai-runtime-timeline__list {
  display: grid;
  gap: 7px;
  margin: 8px 0 0 18px;
  border-left: 1px solid color-mix(in srgb, var(--shell-divider) 78%, transparent);
  padding: 0 0 0 14px;
}

.ai-runtime-timeline__item {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
  line-height: 18px;
}

.ai-runtime-timeline__dot {
  position: absolute;
  top: 7px;
  left: -18px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--text-quaternary);
}

.ai-runtime-timeline__item.is-error .ai-runtime-timeline__dot,
.ai-runtime-timeline__item.is-warn .ai-runtime-timeline__dot {
  background: var(--warning);
}

.ai-runtime-timeline__copy {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}

.ai-runtime-timeline__event-label {
  flex: 0 0 auto;
  color: var(--text-secondary);
}

.ai-runtime-timeline__event-detail {
  min-width: 0;
  overflow: hidden;
  color: var(--text-quaternary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
