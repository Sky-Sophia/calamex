<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <span :class="cn(
    'inline-flex items-center gap-1 rounded-md border bg-secondary',
    'px-1.5 py-0.5 text-xs text-foreground align-middle',
    props.class,
  )">
    <slot />
  </span>
</template>
