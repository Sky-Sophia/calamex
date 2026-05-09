<script setup lang="ts">
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class'];
}>(), {
  class: undefined,
});
</script>

<template>
  <div :class="cn('checkpoint flex items-center text-muted-foreground overflow-hidden', props.class)" v-bind="$attrs">
    <Separator class="checkpoint__line checkpoint__line--left" />
    <slot />
    <Separator class="checkpoint__line checkpoint__line--right" />
  </div>
</template>

<style scoped>
.checkpoint {
  --line: #E5E7EB;
  gap: 8px;
  width: 100%;
}

.checkpoint__line {
  position: relative;
  flex: 1 1 auto;
  min-width: 18px;
  block-size: 1px !important;
  background: transparent !important;
  overflow: visible;
}

.checkpoint__line::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to right,
      #D1D5DB 0%,
      #D1D5DB 35%,
      #D1D5DB 65%,
      #D1D5DB 100%);
  transform-origin: center;
  transform: scaleY(0.78);
}

.checkpoint__line--left::before {
  clip-path: polygon(0 50%, 100% 0, 100% 100%);
}

.checkpoint__line--right::before {
  transform: scaleX(-1) scaleY(0.68);
  clip-path: polygon(0 50%, 100% 0, 100% 100%);
}
</style>
