<script setup lang="ts">
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Circle,
  Loader2,
} from 'lucide-vue-next'
import type { Component, HTMLAttributes } from 'vue'

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'error'

interface Props {
  title?: string
  status?: TaskStatus
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  status: 'pending',
  class: '',
})

const statusMap: Record<
  TaskStatus,
  { icon: Component; class: string }
> = {
  pending: { icon: Circle, class: 'text-muted-foreground' },
  in_progress: { icon: Loader2, class: 'text-blue-500 animate-spin' },
  completed: { icon: Check, class: 'text-emerald-500' },
  error: { icon: AlertCircle, class: 'text-red-500' },
}
</script>

<template>
  <CollapsibleTrigger as-child :class="cn('group w-full', props.class)">
    <slot :status="props.status" :title="props.title">
      <button type="button" class="flex w-full cursor-pointer items-center gap-2 text-sm
               text-muted-foreground transition-colors hover:text-foreground">
        <component :is="statusMap[props.status].icon" :class="['size-4 shrink-0', statusMap[props.status].class]" />
        <span class="truncate text-foreground">{{ props.title }}</span>
        <ChevronDown class="ml-auto size-4 shrink-0 transition-transform
                 group-data-[state=open]:rotate-180" />
      </button>
    </slot>
  </CollapsibleTrigger>
</template>
