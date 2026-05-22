import { splitTextGraphemes } from '@/utils/text-preview';
import { computed, getCurrentScope, onScopeDispose, ref } from 'vue';

type TAiStreamStatus = 'idle' | 'streaming' | 'completed' | 'cancelled';

type TFrameHandle =
  | { kind: 'raf'; id: number }
  | { kind: 'timeout'; id: ReturnType<typeof setTimeout> };

export interface IUseAiStreamOptions {
  messageId?: string;
}

export interface IAiStreamStartOptions {
  messageId?: string;
}

const DEFAULT_FRAME_MS = 16.7;
const MAX_FRAME_DELTA_MS = 50;
const BASE_GRAPHEMES_PER_SECOND = 42;
const MAX_GRAPHEMES_PER_SECOND = 180;
const BACKLOG_ACCELERATION_PER_GRAPHEME = 2.5;
const BACKLOG_ACCELERATION_START = 12;

export const useAiStream = (options: IUseAiStreamOptions = {}) => {
  void options;

  const content = ref('');
  const status = ref<TAiStreamStatus>('idle');
  const bufferedGraphemeCount = ref(0);
  const maxBufferedGraphemeCount = ref(0);

  let pendingText = '';
  let frameHandle: TFrameHandle | null = null;
  let isFrameScheduled = false;
  let lastFrameTimestamp: number | null = null;
  let pacingBudgetRemainder = 0;

  const countBufferedText = (text: string): number => splitTextGraphemes(text).length;

  const updateBufferMetrics = (): void => {
    bufferedGraphemeCount.value = countBufferedText(pendingText);
    maxBufferedGraphemeCount.value = Math.max(
      maxBufferedGraphemeCount.value,
      bufferedGraphemeCount.value,
    );
  };

  const cancelFrame = (): void => {
    if (frameHandle?.kind === 'raf') {
      globalThis.cancelAnimationFrame?.(frameHandle.id);
    }

    if (frameHandle?.kind === 'timeout') {
      clearTimeout(frameHandle.id);
    }

    frameHandle = null;
    isFrameScheduled = false;
  };

  const flushPendingText = (): void => {
    if (!pendingText) {
      return;
    }

    content.value += pendingText;
    pendingText = '';
    pacingBudgetRemainder = 0;
    updateBufferMetrics();
  };

  const getFrameElapsedMs = (timestamp: number): number => {
    const elapsed = lastFrameTimestamp === null
      ? DEFAULT_FRAME_MS
      : timestamp - lastFrameTimestamp;
    lastFrameTimestamp = timestamp;

    if (!Number.isFinite(elapsed) || elapsed <= 0) {
      return DEFAULT_FRAME_MS;
    }

    return Math.min(elapsed, MAX_FRAME_DELTA_MS);
  };

  const getPacingRate = (bufferedCount: number): number => {
    const backlog = Math.max(0, bufferedCount - BACKLOG_ACCELERATION_START);
    return Math.min(
      MAX_GRAPHEMES_PER_SECOND,
      BASE_GRAPHEMES_PER_SECOND + backlog * BACKLOG_ACCELERATION_PER_GRAPHEME,
    );
  };

  const drainPendingTextByFrame = (timestamp: number): void => {
    if (!pendingText) {
      pacingBudgetRemainder = 0;
      return;
    }

    const graphemes = splitTextGraphemes(pendingText);
    if (graphemes.length === 0) {
      pendingText = '';
      updateBufferMetrics();
      return;
    }

    const elapsedMs = getFrameElapsedMs(timestamp);
    const nextBudget =
      pacingBudgetRemainder + getPacingRate(graphemes.length) * (elapsedMs / 1_000);
    const drainCount = Math.min(
      graphemes.length,
      Math.max(1, Math.floor(nextBudget)),
    );
    pacingBudgetRemainder = Math.max(0, nextBudget - drainCount);
    content.value += graphemes.slice(0, drainCount).join('');
    pendingText = graphemes.slice(drainCount).join('');
    updateBufferMetrics();
  };

  const resetPacingState = (): void => {
    cancelFrame();
    pendingText = '';
    lastFrameTimestamp = null;
    pacingBudgetRemainder = 0;
    bufferedGraphemeCount.value = 0;
  };

  const releaseFrame = (timestamp: number): void => {
    frameHandle = null;
    isFrameScheduled = false;

    if (status.value !== 'streaming') {
      return;
    }

    drainPendingTextByFrame(timestamp);

    if (pendingText) {
      scheduleFrame();
    } else {
      lastFrameTimestamp = null;
      pacingBudgetRemainder = 0;
    }
  };

  function scheduleFrame(): void {
    if (isFrameScheduled) {
      return;
    }

    isFrameScheduled = true;
    let didRunSynchronously = false;

    if (typeof globalThis.requestAnimationFrame === 'function') {
      const frameId = globalThis.requestAnimationFrame((timestamp) => {
        didRunSynchronously = true;
        releaseFrame(timestamp);
      });

      if (!didRunSynchronously) {
        frameHandle = {
          kind: 'raf',
          id: frameId,
        };
      }

      return;
    }

    frameHandle = {
      kind: 'timeout',
      id: setTimeout(() => {
        releaseFrame(Date.now());
      }, DEFAULT_FRAME_MS),
    };
  }

  const start = (startOptions: Readonly<IAiStreamStartOptions> = {}): void => {
    void startOptions;
    resetPacingState();
    content.value = '';
    maxBufferedGraphemeCount.value = 0;
    status.value = 'streaming';
  };

  const append = (chunk: string): void => {
    if (status.value !== 'streaming' || !chunk) {
      return;
    }

    pendingText += chunk;
    updateBufferMetrics();
    scheduleFrame();
  };

  const flushNow = (): void => {
    cancelFrame();
    flushPendingText();
  };

  const complete = (): void => {
    if (status.value !== 'streaming') {
      return;
    }

    flushNow();
    status.value = 'completed';
  };

  const stop = (): void => {
    flushNow();
    status.value = 'cancelled';
  };

  if (getCurrentScope()) {
    onScopeDispose(() => {
      resetPacingState();
    });
  }

  return {
    content,
    bufferedGraphemeCount: computed(() => bufferedGraphemeCount.value),
    isStreaming: computed(() => status.value === 'streaming'),
    maxBufferedGraphemeCount: computed(() => maxBufferedGraphemeCount.value),
    status: computed(() => status.value),
    start,
    append,
    flushNow,
    complete,
    stop,
  };
};
