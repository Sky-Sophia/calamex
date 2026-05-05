<script setup lang="ts">
import { Loader } from '@/components/ai-elements/loader';
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageToolbar,
} from '@/components/ai-elements/message';
import AiAgentRuntimeTimeline from '@/components/business/ai/AiAgentRuntimeTimeline.vue';
import AiMarkdown from '@/components/business/ai/AiMarkdown.vue';
import AiToolActivityInline from '@/components/business/ai/AiToolActivityInline.vue';
import { useMessage } from '@/composables/useMessage';
import type { TAiServicePlatformId } from '@/constants/ai-providers';
import type { IAiChatMessage, IAiContextReference, TAiChatMessageActionId } from '@/types/ai';
import { materializeAgentActivities } from '@/utils/agent-activity';
import { tryWriteClipboardText } from '@/utils/clipboard';
import { Check, Copy, FileText, Image as ImageIcon } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  message: IAiChatMessage;
  platformId: TAiServicePlatformId;
  providerLabel: string;
}>();

const emit = defineEmits<{
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

const hasRenderableContent = computed(() => Boolean(props.message.content.trim()));

const hasToolCalls = computed(() => Boolean(props.message.toolCalls?.length));

const hasActivityTrail = computed(() => Boolean(props.message.stream?.activityTrail?.length));

const hasActivityNotes = computed(() => Boolean(props.message.stream?.activityNotes?.length));

const hasRuntimeTimeline = computed(() => Boolean(props.message.stream?.runtimeEvents?.length));

const streamActivities = computed(() => {
  const stream = props.message.stream;

  if (!stream) {
    return [];
  }

  if (stream.activities?.length) {
    return stream.activities;
  }

  if (stream.activityEvents?.length) {
    return materializeAgentActivities(stream.activityEvents);
  }

  return [];
});

const hasActivities = computed(() => Boolean(streamActivities.value.length));

const shouldShowRuntimeTimeline = computed(
  () => props.message.role === 'assistant' && hasRuntimeTimeline.value,
);

const shouldShowActivityTimeline = computed(
  () =>
    props.message.role === 'assistant' &&
    !shouldShowRuntimeTimeline.value &&
    (hasToolCalls.value || hasActivityTrail.value || hasActivityNotes.value || hasActivities.value),
);

const canShowRuntimeMessageBubble = computed(
  () =>
    !shouldShowRuntimeTimeline.value ||
    props.message.stream?.status !== 'streaming' ||
    props.message.stream?.finalAnswerStarted === true,
);

const hasMessageActions = computed(() => Boolean(props.message.actions?.length));

const normalizeMessageDisplayText = (value: string | undefined): string =>
  value?.normalize('NFC').replace(/\s+/gu, ' ').trim() ?? '';

const activityOnlyTexts = computed(() => {
  const stream = props.message.stream;
  const values: string[] = [];

  if (!stream) {
    return new Set<string>();
  }

  values.push(stream.activityText ?? '');
  values.push(...(stream.activityTrail ?? []));
  values.push(...(stream.activityNotes ?? []).map((note) => note.text));

  for (const activity of streamActivities.value) {
    if (activity.kind !== 'reasoning_summary' && activity.kind !== 'llm') {
      continue;
    }

    values.push(activity.title);
    values.push(activity.description ?? '');
  }

  return new Set(values.map(normalizeMessageDisplayText).filter((value) => value.length > 0));
});

const isToolProgressContent = computed(() => {
  if (props.message.role !== 'assistant' || !hasToolCalls.value) {
    return false;
  }

  const content = props.message.content.trim();

  return [
    'AI 正在自动分析并按需调用工具…',
    'AI 正在自动使用工具：',
    'AI 已自动完成工具调用：',
  ].some((prefix) => content.startsWith(prefix));
});

const isActivityOnlyContent = computed(
  () =>
    props.message.role === 'assistant' &&
    props.message.stream?.status === 'streaming' &&
    shouldShowActivityTimeline.value &&
    activityOnlyTexts.value.has(normalizeMessageDisplayText(props.message.content)),
);

const shouldShowMessageBubble = computed(
  () =>
    hasRenderableContent.value &&
    !isToolProgressContent.value &&
    !isActivityOnlyContent.value &&
    canShowRuntimeMessageBubble.value,
);

const copyableContent = computed(() => {
  if (isToolProgressContent.value || !shouldShowMessageBubble.value) {
    return '';
  }

  return props.message.content;
});

const canCopyContent = computed(() => copyableContent.value.trim().length > 0);

const inlineLoaderLabel = computed(
  () => props.message.stream?.activityText?.trim() || 'AI 正在生成回答',
);

const shouldShowInlineLoader = computed(
  () =>
    props.message.role === 'assistant' &&
    props.message.stream?.status === 'streaming' &&
    (!hasRenderableContent.value || isToolProgressContent.value) &&
    !hasToolCalls.value &&
    !shouldShowRuntimeTimeline.value &&
    !shouldShowActivityTimeline.value,
);

const shouldRenderMessage = computed(
  () =>
    props.message.role === 'user' ||
    shouldShowMessageBubble.value ||
    shouldShowRuntimeTimeline.value ||
    shouldShowActivityTimeline.value ||
    shouldShowInlineLoader.value ||
    hasMessageActions.value,
);

const userAttachmentReferences = computed(() => {
  if (props.message.role !== 'user') {
    return [];
  }

  return props.message.references.filter(isAttachmentReference);
});

function isAttachmentReference(reference: IAiContextReference): boolean {
  return reference.id.startsWith('attachment:');
}

function resolveAttachmentLabel(reference: IAiContextReference): string {
  const path = reference.path?.trim();

  if (path) {
    return path;
  }

  return reference.label
    .replace(/^图片附件\s*·\s*/u, '')
    .replace(/^附件\s*·\s*/u, '')
    .trim();
}

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
  <Message v-if="shouldRenderMessage" :from="message.role" class="ai-message"
    :class="[`is-${message.role}`, { 'is-inline-loading': shouldShowInlineLoader }]">
    <div class="ai-message-main">
      <div v-if="shouldShowInlineLoader" class="ai-message-status-line" role="status" aria-live="polite">
        <Loader class="ai-message-status-icon" :size="13" />
        <span>{{ inlineLoaderLabel }}</span>
      </div>
      <AiAgentRuntimeTimeline v-if="shouldShowRuntimeTimeline" :events="message.stream?.runtimeEvents ?? []"
        :is-streaming="message.stream?.status === 'streaming'" />
      <AiToolActivityInline v-if="shouldShowActivityTimeline" :tool-calls="message.toolCalls ?? []"
        :activity-text="message.stream?.activityText" :activity-trail="message.stream?.activityTrail"
        :activity-notes="message.stream?.activityNotes" :activities="message.stream?.activities"
        :activity-events="message.stream?.activityEvents" />
      <div v-if="userAttachmentReferences.length" class="ai-message-attachments" aria-label="已发送附件">
        <span v-for="reference in userAttachmentReferences" :key="reference.id" class="ai-message-attachment-chip">
          <ImageIcon v-if="reference.kind === 'image-attachment'" aria-hidden="true" />
          <FileText v-else aria-hidden="true" />
          <span>{{ resolveAttachmentLabel(reference) }}</span>
        </span>
      </div>
      <MessageContent v-if="shouldShowMessageBubble" class="ai-message-bubble"
        :class="{ 'is-assistant-flat': message.role !== 'user' }">
        <AiMarkdown :message-id="message.id" :content="message.content" :stream-status="message.stream?.status" />
      </MessageContent>
      <MessageActions v-if="hasMessageActions" class="ai-message-options" aria-label="AI 选项">
        <MessageAction v-for="action in message.actions" :key="`${message.id}:${action.id}`"
          class="ai-message-option-button" :disabled="action.disabled" :label="action.label" size="sm"
          :tooltip="action.label" variant="outline" @click.stop="emit('messageAction', message.id, action.id)">
          {{ action.label }}
        </MessageAction>
      </MessageActions>
      <MessageToolbar v-if="canCopyContent" class="ai-message-toolbar">
        <MessageActions class="ai-message-actions">
          <MessageAction class="ai-message-copy-button" :class="{ 'is-copied': isCopied }"
            :label="isCopied ? '已复制对话内容' : '复制对话内容'" :tooltip="isCopied ? '已复制' : '复制对话内容'"
            @click.stop="copyMessageContent">
            <Check v-if="isCopied" aria-hidden="true" />
            <Copy v-else aria-hidden="true" />
          </MessageAction>
        </MessageActions>
      </MessageToolbar>
    </div>
  </Message>
</template>

<style scoped>
.ai-message {
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.ai-message.is-assistant {
  width: 100%;
  max-width: 100%;
}

.ai-message.is-user {
  justify-content: flex-end;
  padding-inline: 12px;
}

.ai-message.is-inline-loading {
  align-items: center;
}

.ai-message-main {
  box-sizing: border-box;
  min-width: 0;
}

.ai-message.is-user .ai-message-main {
  max-width: calc(100% - 50px);
}

.ai-message.is-assistant .ai-message-main {
  width: 100%;
  max-width: none;
  overflow-x: hidden;
  padding-inline: 30px;
}

.ai-message-main>.ai-tool-activity-inline+.ai-message-bubble,
.ai-message-main>.ai-runtime-timeline+.ai-message-bubble,
.ai-message-main>.ai-message-status-line+.ai-message-bubble {
  margin-top: 6px;
}

.ai-message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 6px;
}

.ai-message.is-user .ai-message-attachments {
  justify-content: flex-end;
}

.ai-message-attachment-chip {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 82%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-soft) 74%, transparent);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 20px;
  padding: 0 8px;
}

.ai-message-attachment-chip svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ai-message-attachment-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-message-bubble {
  min-width: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.ai-message.is-assistant .ai-message-bubble {
  width: 100%;
  max-width: 100%;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.ai-message.is-assistant .ai-message-bubble.is-assistant-flat {
  color: var(--text-secondary);
}

.ai-message-status-line {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  gap: 6px;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 18px;
}

.ai-message-status-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  align-self: center;
  color: var(--text-tertiary);
}

.ai-message.is-user .ai-message-bubble {
  border-radius: 8px;
  border-top-right-radius: 4px;
  background: var(--accent-strong);
  color: var(--accent-foreground, white);
  padding: 9px 11px;
}

.ai-message.is-user .ai-message-attachment-chip {
  border-color: color-mix(in srgb, var(--accent-strong) 24%, transparent);
  background: color-mix(in srgb, var(--accent-strong) 10%, transparent);
  color: var(--text-primary);
}

.ai-message-toolbar {
  width: auto;
  margin-top: 0;
  gap: 0;
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
  transition:
    transform 160ms ease-out,
    border-color 160ms ease-out,
    background-color 160ms ease-out;
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
  background: transparent;
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
  background: transparent;
  color: var(--accent-strong);
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .ai-message-status-icon {
    animation: none;
  }
}
</style>
