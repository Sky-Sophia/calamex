<script setup lang="ts">
import { SelectItem } from '@/components/ui/select';

defineOptions({
  inheritAttrs: false,
});
</script>

<template>
  <SelectItem v-bind="$attrs">
    <slot />
  </SelectItem>
</template>
