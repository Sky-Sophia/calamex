<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface IProps extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class'];
}

const props = defineProps<IProps>();
</script>

<template>
  <div :class="cn('flex items-center gap-2', props.class)" v-bind="{ ...props, ...$attrs }">
    <slot />
  </div>
</template>
