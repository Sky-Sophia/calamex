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
    <div class="relative inline-block max-w-full overflow-x-auto align-top">
        <table :class="cn('w-fit caption-bottom text-sm', props.class)">
            <slot />
        </table>
    </div>
</template>
