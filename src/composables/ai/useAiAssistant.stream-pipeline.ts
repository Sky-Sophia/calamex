import type { Ref } from 'vue';
import type { useAiStream } from '@/composables/ai/useAiStream';
import type { IAiChatMessage, IAiChatStreamEventPayload } from '@/types/ai';
import { hasStreamTokenSnapshot, mergeStreamTokenSnapshot } from './useAiAssistant.stream';

const MSG_STREAM_ERROR = 'AI 响应出错';

export interface IStreamPipeline {
  readonly handleEvent: (event: IAiChatStreamEventPayload) => void;
  readonly startAssistantStream: (streamId: string, assistantMessageId: string) => void;
  readonly flushBufferedText: () => void;
}

export interface IStreamPipelineDeps {
  aiStream: ReturnType<typeof useAiStream>;
  activeStreamId: Ref<string | null>;
  errorMessage: Ref<string>;
  syncActiveAssistantMessage: () => void;
  clearAttachedFiles: (options?: { revokePreviews?: boolean }) => void;
}

export const createStreamPipeline = (
  deps: IStreamPipelineDeps,
  assistantMessage: IAiChatMessage,
  settle: () => void,
): IStreamPipeline => {
  const { aiStream, activeStreamId, errorMessage, syncActiveAssistantMessage, clearAttachedFiles } =
    deps;
  let isStreamClosed = false;
  let hasStartedStream = false;

  const flushBufferedText = (): void => {
    aiStream.flushNow();
    syncActiveAssistantMessage();
  };

  const startAssistantStream = (streamId: string, assistantMessageId: string): void => {
    if (hasStartedStream) {
      return;
    }

    hasStartedStream = true;
    activeStreamId.value = streamId;
    assistantMessage.id = assistantMessageId;

    aiStream.start({ messageId: assistantMessageId });
    syncActiveAssistantMessage();
  };

  const applyStreamTokenSnapshot = (event: IAiChatStreamEventPayload): void => {
    if (!hasStreamTokenSnapshot(event)) {
      return;
    }

    assistantMessage.stream = mergeStreamTokenSnapshot(assistantMessage.stream, event);
    syncActiveAssistantMessage();
  };

  const handleEvent = (event: IAiChatStreamEventPayload): void => {
    if (!activeStreamId.value && event.kind === 'start') {
      startAssistantStream(event.streamId, event.assistantMessageId);
      applyStreamTokenSnapshot(event);
      return;
    }

    if (event.streamId !== activeStreamId.value) {
      return;
    }

    if (isStreamClosed) {
      return;
    }

    applyStreamTokenSnapshot(event);

    if (event.kind === 'delta') {
      if (event.delta) {
        aiStream.append(event.delta);
      }

      return;
    }

    isStreamClosed = true;

    if (event.kind === 'done') {
      aiStream.complete();
      syncActiveAssistantMessage();
      clearAttachedFiles({ revokePreviews: false });
      settle();
      return;
    }

    if (event.kind === 'cancelled') {
      aiStream.stop();
      syncActiveAssistantMessage();
      errorMessage.value = '';
      settle();
      return;
    }

    if (event.kind === 'error') {
      aiStream.stop();
      syncActiveAssistantMessage();
      errorMessage.value = event.message ?? MSG_STREAM_ERROR;
      settle();
    }
  };

  return {
    handleEvent,
    startAssistantStream,
    flushBufferedText,
  };
};
