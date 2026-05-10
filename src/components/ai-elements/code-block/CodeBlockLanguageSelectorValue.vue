<script setup lang="ts">
import { SelectValue } from '@/components/ui/select';

defineOptions({
  inheritAttrs: false,
});
</script>

<template>
  <SelectValue v-bind="$attrs">
    <slot />
  </SelectValue>
</template>
