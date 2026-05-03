<script setup lang="ts">
import { computed } from 'vue';

import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';

const props = defineProps<{
  events: TAgentRuntimeEvent[];
}>();

const timelineEvents = computed(() =>
  props.events,
);

const stringifyRuntimeEvent = (event: TAgentRuntimeEvent): string => {
  try {
    return JSON.stringify(event, null, 2);
  } catch {
    return String(event.type);
  }
};
</script>

<template>
  <section v-if="timelineEvents.length > 0" class="ai-runtime-timeline" aria-label="Agent 运行事件">
    <ol class="ai-runtime-timeline__list">
      <li v-for="event in timelineEvents" :key="event.id" class="ai-runtime-timeline__item"
        :class="`is-${event.level ?? 'info'}`">
        <span class="ai-runtime-timeline__dot" aria-hidden="true"></span>
        <div class="ai-runtime-timeline__copy">
          <span class="ai-runtime-timeline__event-type">{{ event.type }}</span>
          <pre class="ai-runtime-timeline__event-payload">{{ stringifyRuntimeEvent(event) }}</pre>
        </div>
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

.ai-runtime-timeline__list {
  display: grid;
  gap: 10px;
  margin: 0 0 0 18px;
  border-left: 1px solid color-mix(in srgb, var(--shell-divider) 78%, transparent);
  padding: 0 0 0 14px;
}

.ai-runtime-timeline__item {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 4px;
}

.ai-runtime-timeline__dot {
  position: absolute;
  top: 8px;
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
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ai-runtime-timeline__event-type {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-secondary);
}

.ai-runtime-timeline__event-payload {
  margin: 0;
  padding: 8px 10px;
  min-width: 0;
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-base) 16%, var(--surface-panel));
  color: var(--text-quaternary);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
  word-break: break-word;
  unicode-bidi: plaintext;
}
</style>
