<script setup lang="ts">
import { Select } from '@/components/ui/select';

defineOptions({
  inheritAttrs: false,
});
</script>

<template>
  <Select v-bind="$attrs">
    <slot />
  </Select>
</template>
