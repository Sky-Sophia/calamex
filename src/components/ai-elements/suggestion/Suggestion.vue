<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<{
  suggestion: string;
  class?: HTMLAttributes['class'];
  disabled?: boolean;
}>(), {
  class: undefined,
  disabled: false,
});

const emit = defineEmits<{
  click: [suggestion: string];
}>();

const handleClick = (): void => {
  if (props.disabled) {
    return;
  }

  emit('click', props.suggestion);
};
</script>

<template>
  <button
    type="button"
    :class="cn('ai-suggestion-chip', props.class)"
    :disabled="props.disabled"
    v-bind="$attrs"
    @click="handleClick"
  >
    <span class="ai-suggestion-chip__text">{{ props.suggestion }}</span>
  </button>
</template>

<style scoped>
.ai-suggestion-chip {
  display: inline-flex;
  min-width: 0;
  max-width: min(100%, 360px);
  min-height: 34px;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  background-color: color-mix(in srgb, var(--surface-soft) 62%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  padding: 7px 17px;
  text-align: center;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-emphasized),
    color var(--motion-duration-fast) var(--motion-easing-emphasized),
    transform var(--motion-duration-fast) var(--motion-easing-emphasized);
}

.ai-suggestion-chip:hover {
  background-color: color-mix(in srgb, var(--surface-soft) 100%, transparent);
  color: var(--text-primary);
}

.ai-suggestion-chip:active {
  transform: scale(0.985);
}

.ai-suggestion-chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 44%, transparent);
  outline-offset: 3px;
}

.ai-suggestion-chip:disabled {
  cursor: default;
  opacity: 0.58;
}

.ai-suggestion-chip:disabled:active {
  transform: none;
}

.ai-suggestion-chip__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
