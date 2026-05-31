<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useChainOfThought } from './context';

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
  }>(),
  {
    class: undefined,
  },
);

const { isOpen, setIsOpen } = useChainOfThought();
</script>

<template>
  <Collapsible :open="isOpen" @update:open="setIsOpen">
    <CollapsibleTrigger
:class="cn(
      'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
      props.class,
    )
      " v-bind="$attrs">
      <span class="icon-[lucide--brain] size-4" aria-hidden="true"  />
      <span class="flex-1 text-left">
        <slot>思考过程</slot>
      </span>
      <span
:class="cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')"
        aria-hidden="true" class="icon-[lucide--chevron-down]" />
    </CollapsibleTrigger>
  </Collapsible>
</template>
