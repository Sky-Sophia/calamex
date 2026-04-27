<template>
  <div
    v-if="shouldRender"
    ref="panelRef"
    class="motion-dropdown"
    :data-motion-state="motionState"
    :style="{ transformOrigin }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useDropdownMotion } from '@/composables/useDropdownMotion';
import type { TDropdownMotionOrigin } from '@/types/motion';
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    origin?: TDropdownMotionOrigin;
  }>(),
  {
    origin: 'top left',
  },
);

const panelRef = ref<HTMLElement | null>(null);
const open = computed(() => props.open);
const origin = computed(() => props.origin);
const { shouldRender, motionState, transformOrigin } = useDropdownMotion({
  open,
  panelRef,
  origin,
});
</script>
