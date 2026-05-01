<script setup lang="ts">
import type { CodeBlockNodeProps } from 'markstream-vue';
import { VmdRender } from 'vue-markdown-design';
import { computed, onBeforeUnmount, ref } from 'vue';

const COPY_RESET_DELAY_MS = 1600;
const BACKTICK_RUN_PATTERN = /`+/g;

const props = defineProps<Pick<CodeBlockNodeProps, 'isDark' | 'loading' | 'node'>>();

const isCopied = ref(false);

let copyResetTimer: number | undefined;

const normalizedLanguage = computed(() => normalizeLanguageTag(props.node.language));
const codeLanguageLabel = computed(() => normalizedLanguage.value || 'text');
const codeMarkdown = computed(() => buildCodeFence(normalizedLanguage.value, props.node.code));
const canCopy = computed(
  () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function',
);

function normalizeLanguageTag(language: string): string {
  return String(language ?? '')
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function buildCodeFence(language: string, code: string): string {
  const longestFenceRun = Array.from(code.matchAll(BACKTICK_RUN_PATTERN), ([match]) => match.length).reduce(
    (currentLongest, matchLength) => Math.max(currentLongest, matchLength),
    3,
  );
  const fence = '`'.repeat(longestFenceRun + 1);
  const languageSuffix = language ? language : '';

  return `${fence}${languageSuffix}\n${code}\n${fence}`;
}

function clearCopyResetTimer(): void {
  if (copyResetTimer === undefined) {
    return;
  }

  window.clearTimeout(copyResetTimer);
  copyResetTimer = undefined;
}

function scheduleCopyReset(): void {
  clearCopyResetTimer();
  copyResetTimer = window.setTimeout(() => {
    isCopied.value = false;
    copyResetTimer = undefined;
  }, COPY_RESET_DELAY_MS);
}

async function handleCopy(): Promise<void> {
  if (!canCopy.value) {
    return;
  }

  await navigator.clipboard.writeText(props.node.code);
  isCopied.value = true;
  scheduleCopyReset();
}

onBeforeUnmount(() => {
  clearCopyResetTimer();
});
</script>

<template>
  <div
    class="code-block-container ai-code-block"
    :class="{ 'is-loading': loading, 'is-light-surface': !isDark }"
  >
    <div class="code-block-header ai-code-block__header">
      <div class="code-header-main">
        <div class="code-header-copy">
          <span class="code-header-title">{{ codeLanguageLabel }}</span>
        </div>
      </div>

      <div class="code-header-actions">
        <button
          type="button"
          class="code-action-btn ai-code-block__copy"
          aria-label="复制"
          :disabled="!canCopy"
          @click="handleCopy"
        >
          {{ isCopied ? '已复制' : '复制' }}
        </button>
      </div>
    </div>

    <div class="ai-code-block__body">
      <VmdRender
        :src="codeMarkdown"
        :anchor="false"
        :emoji="false"
        :highlight="true"
        :markdown-class="'ai-markdown-design-body'"
        :permalink="false"
      />
    </div>
  </div>
</template>

<style scoped>
.ai-code-block {
  inline-size: 100%;
  min-inline-size: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 12px;
  background: #040506;
  color: #e7edf4;
  box-shadow: 0 24px 48px -36px rgb(0 0 0 / 0.85);
}

.ai-code-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  background: linear-gradient(180deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0));
}

.ai-code-block__copy {
  border: 1px solid rgb(255 255 255 / 0.12);
  background: rgb(255 255 255 / 0.06);
  color: #f4f7fb;
}

.ai-code-block__copy:hover:enabled,
.ai-code-block__copy:focus-visible {
  background: rgb(255 255 255 / 0.12);
  color: #ffffff;
}

.ai-code-block__copy:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.ai-code-block__body {
  min-inline-size: 0;
}

.ai-code-block :deep(.ai-markdown-design-body) {
  margin: 0;
  background: transparent;
  color: #e7edf4;
}

.ai-code-block :deep(.ai-markdown-design-body pre) {
  margin: 0;
  padding: 14px 16px 16px;
  overflow: auto;
  background: #040506;
  border: 0;
  border-radius: 0 0 12px 12px;
}

.ai-code-block :deep(.ai-markdown-design-body code),
.ai-code-block :deep(.ai-markdown-design-body .hljs) {
  display: block;
  padding: 0;
  background: transparent;
  color: #e7edf4;
  font-family: var(--font-mono);
  font-size: 0.92em;
  line-height: 1.65;
}

.ai-code-block :deep(.ai-markdown-design-body pre code.hljs) {
  overflow-wrap: normal;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-comment),
.ai-code-block :deep(.ai-markdown-design-body .hljs-quote) {
  color: #7c8797;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-keyword),
.ai-code-block :deep(.ai-markdown-design-body .hljs-selector-tag),
.ai-code-block :deep(.ai-markdown-design-body .hljs-literal),
.ai-code-block :deep(.ai-markdown-design-body .hljs-section),
.ai-code-block :deep(.ai-markdown-design-body .hljs-link) {
  color: #ff7ab2;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-number),
.ai-code-block :deep(.ai-markdown-design-body .hljs-symbol),
.ai-code-block :deep(.ai-markdown-design-body .hljs-bullet),
.ai-code-block :deep(.ai-markdown-design-body .hljs-variable),
.ai-code-block :deep(.ai-markdown-design-body .hljs-template-variable) {
  color: #ffb86c;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-string),
.ai-code-block :deep(.ai-markdown-design-body .hljs-doctag),
.ai-code-block :deep(.ai-markdown-design-body .hljs-regexp) {
  color: #9ed072;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-title),
.ai-code-block :deep(.ai-markdown-design-body .hljs-title.function_),
.ai-code-block :deep(.ai-markdown-design-body .hljs-function .hljs-title),
.ai-code-block :deep(.ai-markdown-design-body .hljs-section) {
  color: #82aaff;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-type),
.ai-code-block :deep(.ai-markdown-design-body .hljs-class .hljs-title),
.ai-code-block :deep(.ai-markdown-design-body .hljs-built_in) {
  color: #7dd3fc;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-attr),
.ai-code-block :deep(.ai-markdown-design-body .hljs-attribute),
.ai-code-block :deep(.ai-markdown-design-body .hljs-name),
.ai-code-block :deep(.ai-markdown-design-body .hljs-tag) {
  color: #f8c555;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-meta) {
  color: #c792ea;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-operator),
.ai-code-block :deep(.ai-markdown-design-body .hljs-punctuation) {
  color: #c6d0dd;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-addition) {
  color: #9ed072;
}

.ai-code-block :deep(.ai-markdown-design-body .hljs-deletion) {
  color: #ff8f8f;
}

@media (prefers-reduced-motion: reduce) {
  .ai-code-block,
  .ai-code-block * {
    transition-duration: 0ms;
  }
}
</style>