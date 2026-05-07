<script setup lang="ts">
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'vue';

const props = withDefaults(
    defineProps<{
        class?: HTMLAttributes['class'];
    }>(),
    {
        class: undefined,
    },
);
</script>

<template>
    <tr :class="cn(
        'border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted/50',
        props.class,
    )">
        <slot />
    </tr>
</template>
