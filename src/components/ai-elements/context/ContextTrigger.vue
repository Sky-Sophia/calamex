<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { HoverCardTrigger } from '@/components/ui/hover-card';
import ContextIcon from './ContextIcon.vue';
</script>

<template>
  <HoverCardTrigger as-child>
    <slot v-if="$slots.default" />

    <Button v-else type="button" variant="ghost" v-bind="$attrs">
      <ContextIcon />
    </Button>
  </HoverCardTrigger>
</template>
