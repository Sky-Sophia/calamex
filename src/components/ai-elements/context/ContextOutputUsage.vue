<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';
import { computed } from 'vue';
import { useContextValue } from './context';
import TokensWithCost from './TokensWithCost.vue';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();

const { usage, usageSource, cost } = useContextValue();

const outputTokens = computed(() => usage.value?.outputTokens ?? 0);
const outputLabel = computed(() => (usageSource.value === 'official' ? '输出' : '估算输出'));

const outputCostText = computed(() => cost.value?.outputCostText);
</script>

<template>
  <slot v-if="$slots.default" />

  <div :class="cn('flex items-center justify-between text-xs', props.class)" v-bind="$attrs">
    <span class="text-[var(--text-secondary)]">{{ outputLabel }}</span>
    <TokensWithCost :cost-text="outputCostText" :tokens="outputTokens" />
  </div>
</template>
