<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface IProps extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class'];
}

const props = defineProps<IProps>();
</script>

<template>
  <div
    :class="cn(
      'flex items-center justify-between bg-muted/80 px-3 py-2 text-muted-foreground text-xs',
      props.class,
    )"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>
