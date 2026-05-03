<script setup lang="ts">
import { computed } from 'vue';

import AiDiffHunkViewer from '@/components/business/ai/AiDiffHunkViewer.vue';
import type { IAiPatchSet } from '@/types/ai';
import type { IGitDiffPreviewPayload } from '@/types/git';
import { buildAiPatchPreviewFiles, type IAiPatchPreviewFile } from '@/utils/ai-patch-preview';

const props = defineProps<{
  patch: IAiPatchSet | null;
  isApplying?: boolean;
  workspaceRootPath?: string | null;
}>();

const emit = defineEmits<{
  apply: [];
  close: [];
  'open-diff': [payload: IGitDiffPreviewPayload];
}>();

const previewFiles = computed<IAiPatchPreviewFile[]>(() =>
  props.patch ? buildAiPatchPreviewFiles(props.patch, props.workspaceRootPath) : [],
);
</script>

<template>
  <section v-if="patch" class="ai-patch-preview" aria-label="AI Patch 预览">
    <div class="ai-patch-head">
      <div>
        <div class="ai-patch-title">Patch Preview</div>
        <p>{{ patch.summary }}</p>
      </div>
      <button
        type="button"
        class="ai-patch-close"
        aria-label="关闭 Patch 预览"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
    <div v-for="file in previewFiles" :key="file.path" class="ai-patch-file">
      <div class="ai-patch-file-meta">
        <span :title="file.displayPath">{{ file.displayPath }}</span>
        <div class="ai-patch-file-actions">
          <em>{{ file.hunks.length }} hunks</em>
          <button
            type="button"
            class="ai-patch-file-diff-button"
            :title="`在独立 Diff 面板打开 ${file.displayPath}`"
            @click="emit('open-diff', file.gitDiffPreview)"
          >
            打开 Diff 面板
          </button>
        </div>
      </div>
      <AiDiffHunkViewer v-for="hunk in file.hunks" :key="hunk.id" :hunk="hunk" />
    </div>
    <div class="ai-patch-actions">
      <button type="button" class="ai-button is-ghost" @click="emit('close')">暂不应用</button>
      <button
        type="button"
        class="ai-button is-primary"
        :disabled="isApplying"
        @click="emit('apply')"
      >
        {{ isApplying ? '应用中…' : '确认应用' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.ai-patch-preview {
  display: grid;
  gap: 8px;
  margin: 8px 12px;
  border: 1px solid var(--shell-divider);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 70%, transparent);
  padding: 10px;
}

.ai-patch-head,
.ai-patch-file-meta,
.ai-patch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-patch-title {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.ai-patch-preview p,
.ai-patch-file,
.ai-patch-file-meta em {
  color: var(--text-tertiary);
  font-size: 12px;
}

.ai-patch-preview p {
  margin: 2px 0 0;
}

.ai-patch-close {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--text-quaternary);
}

.ai-patch-close:hover {
  background: var(--surface-soft);
  color: var(--text-primary);
}

.ai-patch-file {
  display: grid;
  gap: 6px;
}

.ai-patch-file-meta span {
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-patch-file-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.ai-patch-file-diff-button {
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 86%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel-bg) 76%, transparent);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 1;
  padding: 0 8px;
}

.ai-patch-file-diff-button:hover,
.ai-patch-file-diff-button:focus-visible {
  border-color: color-mix(in srgb, var(--accent-strong) 42%, var(--shell-divider));
  color: var(--text-primary);
}

.ai-button {
  height: 28px;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
}

.ai-button.is-ghost {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  background: transparent;
  color: var(--text-tertiary);
}

.ai-button.is-primary {
  border: 0;
  background: var(--accent-strong);
  color: #fff;
}

.ai-button:disabled {
  opacity: 0.55;
}
</style>
