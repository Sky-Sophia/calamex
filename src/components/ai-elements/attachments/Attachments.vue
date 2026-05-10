<script setup lang="ts">
import { cn } from '@/lib/utils';
import { computed, provide, type HTMLAttributes } from 'vue';
import { AttachmentsKey } from './context';
import type { TAttachmentVariant } from './types';

interface IProps {
  variant?: TAttachmentVariant;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<IProps>(), {
  variant: 'grid',
  class: undefined,
});

const variant = computed(() => props.variant);

provide(AttachmentsKey, { variant });
</script>

<template>
  <div
    :class="cn(
      'flex items-start',
      variant === 'list' ? 'flex-col gap-2' : 'flex-wrap gap-2',
      variant === 'grid' && 'ml-auto w-fit',
      props.class,
    )"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>
