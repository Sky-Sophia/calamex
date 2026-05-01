<script setup lang="ts">
import type { IAiChatStreamRenderState } from '@/types/ai';
import MarkdownRender from 'markstream-vue';
import { computed } from 'vue';

const props = defineProps<{
  messageId: string;
  content: string;
  streamStatus?: IAiChatStreamRenderState['status'];
}>();

const isFinal = computed(() => props.streamStatus !== 'streaming');
const rendererId = computed(() => `ai-message-${props.messageId}`);
</script>

<template>
  <div class="ai-markdown">
    <MarkdownRender
      :content="content"
      :custom-id="rendererId"
      :final="isFinal"
      :max-live-nodes="0"
      :render-batch-size="16"
      :render-batch-delay="8"
      :render-code-blocks-as-pre="true"
      :show-tooltips="false"
      :typewriter="false"
    />
  </div>
</template>

<style scoped>
.ai-markdown {
  min-width: 0;
}

.ai-markdown :deep(.markstream-vue) {
  --ms-font-sans: var(--font-sans);
  --ms-font-mono: var(--font-mono);
  --ms-radius: var(--radius-sm);
  --link-color: var(--accent-strong);
  --inline-code-bg: color-mix(in srgb, var(--panel-bg) 72%, transparent);
  --inline-code-fg: var(--text-primary);
  --code-bg: color-mix(in srgb, var(--editor-bg) 92%, transparent);
  --code-border: color-mix(in srgb, var(--shell-divider) 90%, transparent);
  --code-fg: var(--text-secondary);
  --code-action-fg: var(--text-tertiary);
  --code-action-hover-bg: var(--surface-soft);
  --code-action-hover-fg: var(--text-primary);
  --code-line-number: var(--text-quaternary);
  --table-border: var(--shell-divider);
  --table-header-bg: var(--surface-soft);
  --blockquote-border: color-mix(in srgb, var(--accent-strong) 46%, transparent);
  --blockquote-fg: var(--text-tertiary);
  --hr-border: var(--shell-divider);
  --focus-ring: color-mix(in srgb, var(--accent-strong) 60%, transparent);
  --markstream-code-font-family: var(--font-mono);
  --vscode-editor-font-size: 0.923em;
  --vscode-editor-line-height: 1.55;
  color: inherit;
  font-family: var(--font-sans);
  font-size: inherit;
  line-height: inherit;
}

.ai-markdown :deep(.markdown-renderer) {
  min-width: 0;
}

.ai-markdown :deep(.paragraph-node:first-child),
.ai-markdown :deep(.heading-node:first-child),
.ai-markdown :deep(.list-node:first-child),
.ai-markdown :deep(.blockquote:first-child),
.ai-markdown :deep(.code-block-container:first-child) {
  margin-top: 0;
}

.ai-markdown :deep(.paragraph-node:last-child),
.ai-markdown :deep(.heading-node:last-child),
.ai-markdown :deep(.list-node:last-child),
.ai-markdown :deep(.blockquote:last-child),
.ai-markdown :deep(.code-block-container:last-child) {
  margin-bottom: 0;
}

.ai-markdown :deep(.paragraph-node) {
  color: inherit;
}

.ai-markdown :deep(.heading-node) {
  color: var(--text-primary);
  letter-spacing: 0;
}

.ai-markdown :deep(.inline-code) {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 80%, transparent);
  font-size: 0.92em;
}

.ai-markdown :deep(.link-node) {
  text-decoration: none;
}

.ai-markdown :deep(.link-node:hover) {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ai-markdown :deep(.blockquote) {
  color: var(--blockquote-fg);
}

.ai-markdown :deep(.code-block-container) {
  overflow: hidden;
  border: 1px solid var(--code-border);
  border-radius: var(--ms-radius);
  box-shadow: none;
}

.ai-markdown :deep(pre.code-pre-fallback),
.ai-markdown :deep(pre[class^='language-']),
.ai-markdown :deep(pre[class*=' language-']) {
  max-width: 100%;
  overflow: auto;
  background: transparent;
  color: var(--code-fg);
  font-family: var(--font-mono);
  font-size: var(--vscode-editor-font-size);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-markdown :deep(.table-node-wrapper) {
  border-radius: var(--ms-radius);
}

.ai-markdown :deep(.table-node) {
  border-color: var(--shell-divider);
  box-shadow: none;
}

.ai-markdown :deep(.table-node th),
.ai-markdown :deep(.table-node td) {
  border-color: var(--shell-divider);
}

@media (prefers-reduced-motion: reduce) {
  .ai-markdown :deep(.markstream-vue *) {
    animation: none;
    transition-duration: 0ms;
  }
}
</style>
