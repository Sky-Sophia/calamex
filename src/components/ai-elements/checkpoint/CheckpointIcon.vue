<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
  }>(),
  {
    class: undefined,
  },
);
</script>

<template>
  <slot v-if="$slots.default" />
  <span v-else :class="cn('size-4 shrink-0', props.class)" v-bind="$attrs" class="icon-[lucide--bookmark]" />
</template>
