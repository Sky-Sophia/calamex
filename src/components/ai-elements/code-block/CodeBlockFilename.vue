<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface IProps extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class'];
}

const props = defineProps<IProps>();
</script>

<template>
  <span :class="cn('font-mono', props.class)" v-bind="{ ...props, ...$attrs }">
    <slot />
  </span>
</template>
