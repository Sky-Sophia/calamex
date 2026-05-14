<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';
import { computed } from 'vue';
import { useContextValue } from './context';
import { computeDeepSeekCostBreakdown, formatCnyCost } from './deepseek-pricing';
import TokensWithCost from './TokensWithCost.vue';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();

const { usage, usageSource, modelId } = useContextValue();

const pricing = computed(() => computeDeepSeekCostBreakdown(modelId.value, usage.value));
const inputTokens = computed(() => pricing.value?.usage.inputTokens ?? usage.value?.inputTokens ?? 0);
const inputLabel = computed(() => (usageSource.value === 'official' ? '输入' : '估算输入'));
const cacheHitInputTokens = computed(() => pricing.value?.usage.cacheHitInputTokens ?? 0);
const cacheMissInputTokens = computed(() => pricing.value?.usage.cacheMissInputTokens ?? 0);
const shouldSplitOfficialDeepSeekInput = computed(() =>
  usageSource.value === 'official' &&
  Boolean(pricing.value) &&
  (cacheHitInputTokens.value > 0 || cacheMissInputTokens.value > 0),
);

const inputCostText = computed(() => {
  if (!pricing.value) {
    return undefined;
  }

  return formatCnyCost(pricing.value.inputCostCny);
});
const cacheHitInputCostText = computed(() => {
  if (!pricing.value || cacheHitInputTokens.value <= 0) {
    return undefined;
  }

  return formatCnyCost(pricing.value.cacheHitInputCostCny);
});
const cacheMissInputCostText = computed(() => {
  if (!pricing.value || cacheMissInputTokens.value <= 0) {
    return undefined;
  }

  return formatCnyCost(pricing.value.cacheMissInputCostCny);
});
</script>

<template>
  <slot v-if="$slots.default" />

  <div v-else-if="shouldSplitOfficialDeepSeekInput" :class="cn('space-y-1 text-xs', props.class)" v-bind="$attrs">
    <div v-if="cacheHitInputTokens > 0" class="flex items-center justify-between">
      <span class="text-[var(--text-secondary)]">输入（命中缓存）</span>
      <TokensWithCost :cost-text="cacheHitInputCostText" :tokens="cacheHitInputTokens" />
    </div>
    <div v-if="cacheMissInputTokens > 0" class="flex items-center justify-between">
      <span class="text-[var(--text-secondary)]">输入（未命中缓存）</span>
      <TokensWithCost :cost-text="cacheMissInputCostText" :tokens="cacheMissInputTokens" />
    </div>
  </div>

  <div v-else :class="cn('flex items-center justify-between text-xs', props.class)" v-bind="$attrs">
    <span class="text-[var(--text-secondary)]">{{ inputLabel }}</span>
    <TokensWithCost :cost-text="inputCostText" :tokens="inputTokens" />
  </div>
</template>
