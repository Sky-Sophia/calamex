<script setup lang="ts">
import { SelectTrigger } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

interface IProps {
  class?: HTMLAttributes['class'];
}

const props = defineProps<IProps>();
</script>

<template>
  <SelectTrigger
    :class="cn(
      'h-7 border-none bg-transparent px-2 text-xs shadow-none',
      props.class,
    )"
    size="sm"
    v-bind="$attrs"
  >
    <slot />
  </SelectTrigger>
</template>
