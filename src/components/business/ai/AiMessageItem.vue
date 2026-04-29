<script setup lang="ts">
import AiMarkdown from '@/components/business/ai/AiMarkdown.vue';
import { useMessage } from '@/composables/useMessage';
import type { IAiChatMessage, TAiChatMessageActionId } from '@/types/ai';
import type { IAiCodeBlock, IAiCodePathTarget } from '@/types/ai-code';
import { tryWriteClipboardText } from '@/utils/clipboard';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  message: IAiChatMessage;
  avatarUrl: string | null;
  avatarAlt: string;
}>();

const emit = defineEmits<{
  applyCode: [block: IAiCodeBlock];
  openCodePath: [target: IAiCodePathTarget];
  messageAction: [messageId: string, actionId: TAiChatMessageActionId];
}>();

const notifier = useMessage();
const isCopied = ref(false);
let copiedResetTimerId: number | null = null;

const clearCopiedResetTimer = (): void => {
  if (copiedResetTimerId === null) {
    return;
  }

  window.clearTimeout(copiedResetTimerId);
  copiedResetTimerId = null;
};

const markCopied = (): void => {
  isCopied.value = true;
  clearCopiedResetTimer();
  copiedResetTimerId = window.setTimeout(() => {
    isCopied.value = false;
    copiedResetTimerId = null;
  }, 1600);
};

const formatOpenCodeBlockForCopy = (block: IAiCodeBlock): string => {
  const language = block.fence.lang.trim();
  return `\`\`\`${language}\n${block.content}\n\`\`\``;
};

const hasRenderableContent = computed(() =>
  Boolean(
    props.message.content.trim()
    || props.message.stream?.stableContent.trim()
    || props.message.stream?.openBlock,
  ),
);

const copyableContent = computed(() => {
  const parts: string[] = [];
  const markdownContent = props.message.stream?.stableContent ?? props.message.content;

  if (markdownContent.trim().length > 0) {
    parts.push(markdownContent);
  }

  if (props.message.stream?.openBlock) {
    parts.push(formatOpenCodeBlockForCopy(props.message.stream.openBlock));
  }

  return parts.join('\n\n');
});

const canCopyContent = computed(() => copyableContent.value.trim().length > 0);

const shouldShowInlineLoader = computed(
  () => props.message.role === 'assistant'
    && props.message.stream?.status === 'streaming'
    && !hasRenderableContent.value,
);

const copyMessageContent = async (): Promise<void> => {
  if (!canCopyContent.value) {
    notifier.warning('暂无可复制内容');
    return;
  }

  const copied = await tryWriteClipboardText(copyableContent.value);
  if (copied) {
    markCopied();
    notifier.success('已复制对话内容');
    return;
  }

  notifier.error('当前环境不支持剪贴板写入');
};

onBeforeUnmount(() => {
  clearCopiedResetTimer();
});
</script>

<template>
  <article class="ai-message" :class="`is-${message.role}`">
    <svg v-if="message.role !== 'user' && !avatarUrl" class="ai-logo" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" aria-hidden="true">
      <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" />
      <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
    </svg>
    <img v-else-if="message.role !== 'user'" class="ai-logo" :src="avatarUrl" :alt="avatarAlt" loading="lazy"
      referrerpolicy="no-referrer" />
    <div class="ai-message-main">
      <div class="ai-message-bubble" :class="{ 'is-loading': shouldShowInlineLoader }">
        <div v-if="shouldShowInlineLoader" class="ai-inline-loader" aria-label="AI 正在思考">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <AiMarkdown v-else :message-id="message.id" :content="message.content"
          :stable-content="message.stream?.stableContent" :open-block="message.stream?.openBlock"
          :can-apply-code="message.role === 'assistant'" @apply-code="emit('applyCode', $event)"
          @open-code-path="emit('openCodePath', $event)" />
      </div>
      <div v-if="message.actions?.length" class="ai-message-options" aria-label="AI 选项">
        <button v-for="action in message.actions" :key="`${message.id}:${action.id}`" type="button"
          class="ai-message-option-button" :disabled="action.disabled"
          @click.stop="emit('messageAction', message.id, action.id)">
          {{ action.label }}
        </button>
      </div>
      <div v-if="canCopyContent" class="ai-message-actions">
        <button type="button" class="ai-message-copy-button" :class="{ 'is-copied': isCopied }"
          :aria-label="isCopied ? '已复制对话内容' : '复制对话内容'" :title="isCopied ? '已复制' : '复制对话内容'"
          @click.stop="copyMessageContent">
          <svg v-if="isCopied" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="9" y="9" width="10" height="10" rx="2" />
            <path d="M5 15V7a2 2 0 0 1 2-2h8" />
          </svg>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.ai-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.ai-message.is-user {
  justify-content: flex-end;
}

.ai-logo {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  margin-top: 1px;
  border-radius: 5px;
  color: var(--accent-strong);
  object-fit: contain;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ai-message-main {
  min-width: 0;
  max-width: 310px;
}

.ai-message-bubble {
  border-radius: 8px;
  padding: 9px 11px;
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.ai-message:not(.is-user) .ai-message-bubble {
  border-top-left-radius: 4px;
}

.ai-message-bubble.is-loading {
  min-width: 42px;
}

.ai-inline-loader {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-quaternary);
}

.ai-inline-loader span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  animation: ai-inline-loader-blink 1.2s infinite ease-in-out;
  background: currentColor;
}

.ai-inline-loader span:nth-child(2) {
  animation-delay: 140ms;
}

.ai-inline-loader span:nth-child(3) {
  animation-delay: 280ms;
}

.ai-message.is-user .ai-message-bubble {
  border-top-right-radius: 4px;
  background: var(--accent-strong);
  color: var(--accent-foreground, white);
}

.ai-message-actions {
  display: flex;
  min-height: 18px;
  justify-content: flex-start;
  padding-top: 3px;
}

.ai-message-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
}

.ai-message-option-button {
  border: 1px solid color-mix(in srgb, var(--accent-strong) 24%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-strong) 10%, transparent);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 8px 12px;
  transition: transform 160ms ease-out, border-color 160ms ease-out, background-color 160ms ease-out;
}

.ai-message-option-button:active {
  transform: scale(0.97);
}

.ai-message-option-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
  transform: none;
}

.ai-message.is-user .ai-message-actions {
  justify-content: flex-end;
}

.ai-message-copy-button {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--text-quaternary);
  opacity: 0;
  padding: 0;
  pointer-events: none;
  transform: translateY(-1px);
  transition:
    opacity 120ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 120ms cubic-bezier(0.23, 1, 0.32, 1),
    color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-message-main:hover .ai-message-copy-button,
.ai-message-main:focus-within .ai-message-copy-button {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.ai-message-copy-button:hover {
  color: var(--text-primary);
}

.ai-message-copy-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 60%, transparent);
  outline-offset: 2px;
}

.ai-message-copy-button svg {
  width: 15px;
  height: 15px;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.ai-message.is-user .ai-message-copy-button {
  color: color-mix(in srgb, var(--accent-foreground, white) 82%, transparent);
}

.ai-message.is-user .ai-message-copy-button:hover {
  color: var(--accent-foreground, white);
}

.ai-message-copy-button.is-copied {
  color: var(--accent-strong);
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

@keyframes ai-inline-loader-blink {

  0%,
  80%,
  100% {
    opacity: 0.28;
  }

  40% {
    opacity: 1;
  }
}
</style>
