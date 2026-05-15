<script setup lang="ts">
import type { DropdownMenuItemProps } from 'reka-ui';
import DropdownMenuItem from '@/components/ui/dropdown-menu/DropdownMenuItem.vue';
import ImageIcon from '~icons/lucide/image';
import { usePromptInput } from './context';

interface Props extends DropdownMenuItemProps {
  label?: string;
}

const props = defineProps<Props>();

const { openFileDialog } = usePromptInput();
</script>

<template>
  <DropdownMenuItem @select.prevent="openFileDialog">
    <ImageIcon class="mr-2 size-4" />
    {{ props.label || 'Add photos or files' }}
  </DropdownMenuItem>
</template>
