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
    <th
:class="cn(
        'text-foreground h-10 px-3 text-left align-middle font-medium [&:has([role=checkbox])]:pr-0',
        props.class,
    )">
        <slot />
    </th>
</template>
