<script setup lang="ts">
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'vue'

interface Props {
  defaultOpen?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: true,
  class: '',
})
</script>

<template>
  <Collapsible :default-open="props.defaultOpen" :class="cn('w-full', props.class)" as-child>
    <div>
      <slot />
    </div>
  </Collapsible>
</template>
