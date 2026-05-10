<script setup lang="ts">
import { SelectContent } from '@/components/ui/select';

const props = withDefaults(defineProps<{
  align?: 'start' | 'center' | 'end';
}>(), {
  align: 'end',
});
</script>

<template>
  <SelectContent :align="props.align" v-bind="$attrs">
    <slot />
  </SelectContent>
</template>
