<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core';
import type { SelectScrollUpButtonProps } from 'reka-ui';
import { SelectScrollUpButton, useForwardProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<SelectScrollUpButtonProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollUpButton
    data-slot="select-scroll-up-button"
    v-bind="forwardedProps"
    :class="cn('flex cursor-default items-center justify-center py-1', props.class)"
  >
    <slot>
      <span class="icon-[lucide--chevron-up] size-4"  />
    </slot>
  </SelectScrollUpButton>
</template>
