<script setup lang="ts">
import { AiImageAttachmentPreviewGrid } from '@/components/ai-elements/image';
import type { IAiAttachedFile } from '@/types/ai';
import { FileText, X } from 'lucide-vue-next';
import { computed } from 'vue';

const props = defineProps<{
  attachments: readonly IAiAttachedFile[];
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

const imageAttachments = computed(() =>
  props.attachments.filter(
    (attachment): attachment is IAiAttachedFile & { preview: NonNullable<IAiAttachedFile['preview']> } =>
      attachment.kind === 'image' && Boolean(attachment.preview?.src),
  ),
);

const fileAttachments = computed(() =>
  props.attachments.filter(
    (attachment) => attachment.kind !== 'image' || !attachment.preview?.src,
  ),
);

const handleRemove = (id: string): void => {
  emit('remove', id);
};
</script>

<template>
  <div class="prompt-input-attachments-display" aria-label="已添加附件">
    <AiImageAttachmentPreviewGrid
      v-if="imageAttachments.length"
      :items="imageAttachments"
      aria-label="已添加图片附件"
      removable
      variant="composer"
      @remove="handleRemove"
    />

    <div v-if="fileAttachments.length" class="prompt-input-attachment-chip-row">
      <span v-for="attachment in fileAttachments" :key="attachment.id" class="prompt-input-attachment-chip">
        <FileText aria-hidden="true" />
        <span class="prompt-input-attachment-name">{{ attachment.name }}</span>
        <span v-if="attachment.detailLabel" class="prompt-input-attachment-detail">
          {{ attachment.detailLabel }}
        </span>
        <button type="button" aria-label="移除附件" @click="handleRemove(attachment.id)">
          <X aria-hidden="true" />
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.prompt-input-attachments-display {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.prompt-input-attachment-chip-row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
}

.prompt-input-attachment-chip {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 82%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-soft) 74%, var(--panel-bg));
  padding: 5px 8px 5px 10px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
}

.prompt-input-attachment-chip > svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--text-tertiary);
}

.prompt-input-attachment-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-input-attachment-detail {
  color: var(--text-tertiary);
}

.prompt-input-attachment-chip button {
  display: inline-flex;
  height: 18px;
  width: 18px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  transition:
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard);
}

.prompt-input-attachment-chip button:hover {
  background: color-mix(in srgb, var(--surface-soft) 88%, transparent);
  color: var(--text-primary);
}

.prompt-input-attachment-chip button svg {
  width: 12px;
  height: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .prompt-input-attachment-chip button {
    transition: none;
  }
}
</style>
