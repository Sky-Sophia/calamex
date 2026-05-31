<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { computed, provide } from 'vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { FileTreeFolderKey, useFileTreeContext } from './context';
import FileTreeIcon from './FileTreeIcon.vue';
import FileTreeName from './FileTreeName.vue';

interface Props extends /* @vue-ignore */ HTMLAttributes {
  path: string;
  name: string;
  class?: HTMLAttributes['class'];
}

const props = defineProps<Props>();

const { expandedPaths, togglePath, selectedPath, onSelect } = useFileTreeContext();

const isExpanded = computed(() => expandedPaths.value.has(props.path));
const isSelected = computed(() => selectedPath.value === props.path);

provide(FileTreeFolderKey, {
  path: props.path,
  name: props.name,
  isExpanded: isExpanded.value,
});
</script>

<template>
    <Collapsible :open="isExpanded" @update:open="() => togglePath(props.path)">
        <div :class="cn('', props.class)" data-slot="file-tree-folder" role="treeitem" tabindex="0" v-bind="$attrs">
            <CollapsibleTrigger as-child>
                <button
:class="cn(
                    'flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50',
                    isSelected && 'bg-muted',
                )" data-slot="file-tree-folder-trigger" type="button" @click="() => onSelect(props.path)">
                    <slot
name="content" :is-expanded="isExpanded" :is-selected="isSelected" :folder-name="props.name"
                        :path="props.path">
                        <span
:class="cn(
                            'size-4 shrink-0 text-muted-foreground transition-transform',
                            isExpanded && 'rotate-90',
                        )" class="icon-[lucide--chevron-right]" />
                        <FileTreeIcon>
                            <span v-if="isExpanded" class="icon-[lucide--folder-open] size-4 text-blue-500"  />
                            <span v-else class="icon-[lucide--folder] size-4 text-blue-500"  />
                        </FileTreeIcon>
                        <FileTreeName>{{ props.name }}</FileTreeName>
                    </slot>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent data-slot="file-tree-folder-content">
                <div class="ml-4 border-l pl-2" data-slot="file-tree-folder-children">
                    <slot />
                </div>
            </CollapsibleContent>
        </div>
    </Collapsible>
</template>