<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core';
import type { SelectScrollDownButtonProps } from 'reka-ui';
import { SelectScrollDownButton, useForwardProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '@/lib/utils';

const props = defineProps<SelectScrollDownButtonProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = reactiveOmit(props, 'class');

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollDownButton
    data-slot="select-scroll-down-button"
    v-bind="forwardedProps"
    :class="cn('flex cursor-default items-center justify-center py-1', props.class)"
  >
    <slot>
      <span class="icon-[lucide--chevron-down] size-4"  />
    </slot>
  </SelectScrollDownButton>
</template>
