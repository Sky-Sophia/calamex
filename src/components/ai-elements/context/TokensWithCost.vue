<script setup lang="ts">
import { computed } from 'vue';
import { formatTokensInK } from './token-format';

const props = defineProps<{
  tokens?: number;
  costText?: string;
}>();

const formattedTokens = computed(() => {
  if (props.tokens === undefined) {
    return '-';
  }

  return formatTokensInK(props.tokens);
});
</script>

<template>
  <span>
    <span class="text-[var(--text-secondary)]">{{ formattedTokens }}</span>
    <span v-if="costText" class="ml-2 text-[var(--text-secondary)]">
      · {{ costText }}
    </span>
  </span>
</template>
