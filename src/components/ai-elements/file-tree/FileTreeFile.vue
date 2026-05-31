<script setup lang="ts">
import type { HTMLAttributes, VNode } from 'vue';
import { computed, provide } from 'vue';
import { cn } from '@/lib/utils';
import { FileTreeFileKey, useFileTreeContext } from './context';
import FileTreeIcon from './FileTreeIcon.vue';
import FileTreeName from './FileTreeName.vue';

interface Props extends /* @vue-ignore */ HTMLAttributes {
  path: string;
  name: string;
  icon?: VNode;
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();

const { selectedPath, onSelect } = useFileTreeContext();

const isSelected = computed(() => selectedPath.value === props.path);

provide(FileTreeFileKey, {
  path: props.path,
  name: props.name,
});
</script>

<template>
    <div
:class="cn(
        'flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50',
        isSelected && 'bg-muted',
        props.class,
    )" data-slot="file-tree-file" role="treeitem" tabindex="0" v-bind="$attrs" @click="() => onSelect(props.path)"
        @keydown.enter="() => onSelect(props.path)" @keydown.space="() => onSelect(props.path)">
        <slot :is-selected="isSelected" :name="props.name" :path="props.path">
            <span class="size-4" />
            <FileTreeIcon>
                <component :is="props.icon" v-if="props.icon" />
                <span v-else class="icon-[lucide--file] size-4 text-muted-foreground"  />
            </FileTreeIcon>
            <FileTreeName>{{ props.name }}</FileTreeName>
        </slot>
    </div>
</template>