<script setup lang="ts">
import { HoverCard } from '@/components/ui/hover-card';

const props = withDefaults(defineProps<{
  openDelay?: number;
  closeDelay?: number;
}>(), {
  openDelay: 0,
  closeDelay: 0,
});
</script>

<template>
  <HoverCard :open-delay="props.openDelay" :close-delay="props.closeDelay">
    <slot />
  </HoverCard>
</template>
