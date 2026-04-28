import { computed, ref, unref, type MaybeRef } from 'vue';

import { createStreamingFenceParser } from '@/composables/useStreamingFenceParser';
import type { TAiSupportedLang } from '@/types/ai-code';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IUseAiStreamOptions {
  messageId?: MaybeRef<string>;
  contextLang?: MaybeRef<TAiSupportedLang | undefined>;
}

export interface IAiStreamStartOptions {
  messageId?: string;
  contextLang?: TAiSupportedLang;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateDefaultMessageId = (): string =>
  `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Streaming buffer + fence-aware parser façade for AI assistant messages.
 *
 * Lifecycle:
 *   start() → append() (n times) → complete() | stop()
 *
 * `append()` is a no-op when not streaming, so late deltas arriving after
 * `complete()` / `stop()` are safely ignored.
 */
export const useAiStream = (options: IUseAiStreamOptions = {}) => {
  const content = ref('');
  const isStreaming = ref(false);

  const resolveMessageId = (override?: string): string =>
    override ?? unref(options.messageId) ?? generateDefaultMessageId();
  // (A) If you previously relied on a single composable-wide default id,
  //     replace the line above with:
  //
  //     const composableDefaultId = generateDefaultMessageId();
  //     const resolveMessageId = (override?: string): string =>
  //         override ?? unref(options.messageId) ?? composableDefaultId;

  const resolveContextLang = (override?: TAiSupportedLang): TAiSupportedLang | undefined =>
    override ?? unref(options.contextLang);

  let activeMessageId = resolveMessageId();
  let activeContextLang = resolveContextLang();

  let parser = createStreamingFenceParser(activeMessageId, activeContextLang);
  const fenceSnapshot = ref(parser.snapshot());

  const rebuildParser = (
    nextMessageId: string,
    nextContextLang: TAiSupportedLang | undefined,
  ): void => {
    activeMessageId = nextMessageId;
    activeContextLang = nextContextLang;
    parser = createStreamingFenceParser(activeMessageId, activeContextLang);
    fenceSnapshot.value = parser.snapshot();
  };

  /** Begin a fresh stream, discarding any previous buffer / parser state. */
  const start = (startOptions: Readonly<IAiStreamStartOptions> = {}): void => {
    content.value = '';
    isStreaming.value = true;
    rebuildParser(
      resolveMessageId(startOptions.messageId),
      resolveContextLang(startOptions.contextLang),
    );
  };

  /** Append a delta. No-op outside an active stream (drops late deltas). */
  const append = (chunk: string): void => {
    if (!isStreaming.value) return;
    content.value += chunk;
    fenceSnapshot.value = parser.append(chunk);
  };

  /** Mark the stream as completed; final snapshot status comes from the parser. */
  const complete = (): void => {
    fenceSnapshot.value = parser.complete();
    isStreaming.value = false;
  };

  /** Cancel the stream; final snapshot status comes from the parser. */
  const stop = (): void => {
    fenceSnapshot.value = parser.cancel();
    isStreaming.value = false;
  };

  return {
    content,
    isStreaming,
    fenceSnapshot,
    codeBlocks: computed(() => fenceSnapshot.value.blocks),
    openCodeBlock: computed(() => fenceSnapshot.value.openBlock),
    closedCodeBlockIds: computed(() => fenceSnapshot.value.closedBlockIds),
    stableContent: computed(() => fenceSnapshot.value.stableContent),
    status: computed(() => fenceSnapshot.value.status),
    start,
    append,
    complete,
    stop,
  };
};