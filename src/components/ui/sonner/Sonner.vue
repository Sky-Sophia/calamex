<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner';
import { Toaster as Sonner } from 'vue-sonner';
import { cn } from '@/lib/utils';

const props = defineProps<ToasterProps>();
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
    }"
    v-bind="props"
  >
    <template #success-icon>
      <span class="icon-[lucide--circle-check] size-4"  />
    </template>
    <template #info-icon>
      <span class="icon-[lucide--info] size-4"  />
    </template>
    <template #warning-icon>
      <span class="icon-[lucide--triangle-alert] size-4"  />
    </template>
    <template #error-icon>
      <span class="icon-[lucide--octagon-x] size-4"  />
    </template>
    <template #loading-icon>
      <div>
        <span class="icon-[lucide--loader2] size-4 animate-spin"  />
      </div>
    </template>
    <template #close-icon>
      <span class="icon-[lucide--x] size-4"  />
    </template>
  </Sonner>
</template>
