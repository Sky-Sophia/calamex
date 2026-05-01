<script setup lang="ts">
import type { IAiChatMessage, TAiChatMessageActionId } from '@/types/ai';
import { LoaderCircle } from 'lucide-vue-next';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import AiMessageItem from './AiMessageItem.vue';

const props = defineProps<{
  messages: IAiChatMessage[];
  isTyping: boolean;
  avatarUrl: string | null;
  avatarAlt: string;
}>();

const listRef = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  messageAction: [messageId: string, actionId: TAiChatMessageActionId];
}>();

const TOOL_PROGRESS_PREFIXES = [
  'AI 正在自动分析并按需调用工具…',
  'AI 正在自动使用工具：',
  'Agent 正在调用工具…',
  'Agent 正在根据你的确认继续执行…',
] as const;

const hasInlineProgressMessage = computed(() => {
  const lastMessage = props.messages.at(-1);
  if (lastMessage?.role !== 'assistant') {
    return false;
  }

  return lastMessage.stream?.status === 'streaming'
    || Boolean(lastMessage.toolCalls?.length)
    || TOOL_PROGRESS_PREFIXES.some((prefix) => lastMessage.content.trim().startsWith(prefix));
});

const shouldRenderStandaloneTyping = computed(
  () => props.isTyping && !hasInlineProgressMessage.value,
);

const handleMessageAction = (
  messageId: string,
  actionId: TAiChatMessageActionId,
): void => {
  emit('messageAction', messageId, actionId);
};

const scrollToBottom = async (): Promise<void> => {
  await nextTick();
  const list = listRef.value;
  if (!list) return;
  list.scrollTop = list.scrollHeight;
};

watch(
  () => [props.messages.length, props.isTyping],
  () => {
    void scrollToBottom();
  },
);

onMounted(() => {
  void scrollToBottom();
});
</script>

<template>
  <div ref="listRef" class="ai-chat-list" aria-label="AI 对话记录">
    <AiMessageItem
      v-for="message in messages"
      :key="message.id"
      :message="message"
      :avatar-url="avatarUrl"
      :avatar-alt="avatarAlt"
      @message-action="handleMessageAction"
    />
    <slot name="after-messages"></slot>
    <article v-if="shouldRenderStandaloneTyping" class="ai-message-typing" aria-label="AI 正在准备回复">
      <svg v-if="!avatarUrl" class="ai-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8L12 3z" />
        <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
      </svg>
      <img v-else class="ai-logo" :src="avatarUrl" :alt="avatarAlt" loading="lazy" referrerpolicy="no-referrer" />
      <div class="typing-status" role="status" aria-live="polite">
        <LoaderCircle class="typing-status-icon" aria-hidden="true" />
        <span>AI 正在准备回复</span>
      </div>
    </article>
  </div>
</template>

<style scoped>
.ai-chat-list {
  display: flex;
  min-height: 0;
  flex: 1 1 0;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 14px 12px;
  scrollbar-color: color-mix(in srgb, var(--text-primary) 10%, transparent) transparent;
  scrollbar-width: thin;
}

.ai-chat-list::-webkit-scrollbar {
  width: 8px;
}

.ai-chat-list::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  background-clip: content-box;
}

.ai-message-typing {
  display: flex;
  align-items: flex-start;
  gap: 8px;
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

.typing-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 18px;
  min-height: 22px;
}

.typing-status-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  animation: ai-typing-status-spin 900ms linear infinite;
  color: var(--text-tertiary);
  stroke-width: 2;
}

@keyframes ai-typing-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .typing-status-icon {
    animation: none;
  }
}
</style>
