<template>
  <header class="editor-tabbar flex h-10 items-center justify-between border-b border-(--shell-divider) px-1">
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden pr-2">
      <button v-for="item in documents" :key="item.id" type="button" class="editor-file-tab app-tooltip-target" :class="{
        'is-active': item.id === activeDocumentId,
        'is-dirty': item.isDirty,
      }" :data-tooltip="item.name" data-tooltip-placement="bottom" @click="$emit('select-tab', item.id)">
        <FileEntryIcon kind="file" :path="item.path ?? item.name" class="editor-file-tab-icon" />
        <span class="editor-file-tab-name truncate">{{ item.name }}</span>
        <span class="editor-file-tab-action" aria-hidden="true">
          <span class="editor-file-tab-indicator" />
          <span class="editor-file-tab-close" @click.stop="$emit('close-tab', item.id)">
            ×
          </span>
        </span>
      </button>
    </div>

    <div class="flex min-w-0 items-center gap-3 px-3 text-[11px] text-(--text-quaternary)">
      <span class="truncate">{{ breadcrumbText }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import FileEntryIcon from '@/components/common/FileEntryIcon.vue';
import type { IEditorDocument } from '@/types/editor';
import { computed } from 'vue';

const props = defineProps<{
  documents: IEditorDocument[];
  activeDocumentId: string;
  filePath: string | null;
}>();

defineEmits<{
  'select-tab': [documentId: string];
  'close-tab': [documentId: string];
}>();

const breadcrumbText = computed(() => {
  if (props.documents.length === 0) {
    return '未打开文件';
  }

  if (!props.filePath) {
    return '未保存到本地文件';
  }

  const normalizedPath = props.filePath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/');
  return segments.slice(Math.max(0, segments.length - 4)).join(' / ');
});
</script>
