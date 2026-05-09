import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';
import type { IAiChatMessage } from '@/types/ai';
import type { LanguageModelUsage } from 'ai';
import { getContext } from 'tokenlens';
import type { ComputedRef } from 'vue';
import { computed } from 'vue';

export interface IAiTokenContextProps {
  usedTokens: number;
  maxTokens: number;
  modelId?: string;
  usage: LanguageModelUsage;
}

interface IUseAiTokenContextOptions {
  modelId: ComputedRef<string | null | undefined>;
  runtimeEvents: ComputedRef<readonly TAgentRuntimeEvent[]>;
  messages: ComputedRef<readonly IAiChatMessage[]>;
  draft: ComputedRef<string>;
}

const CJK_TOKEN_WEIGHT = 0.6;
const OTHER_TOKEN_WEIGHT = 0.3;
const MESSAGE_TOKEN_OVERHEAD = 4;
const REFERENCE_TOKEN_OVERHEAD = 8;
const DEEPSEEK_CONTEXT_LIMIT_TOKENS = 1_000_000;

const createUsage = (inputTokens: number): LanguageModelUsage => ({
  inputTokens,
  inputTokenDetails: {
    noCacheTokens: inputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 0,
  outputTokenDetails: {
    textTokens: 0,
    reasoningTokens: 0,
  },
  totalTokens: inputTokens,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});

const isPositiveFiniteNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isWhitespace = (value: string): boolean => value.trim().length === 0;

const isCombiningMarkCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f) ||
  (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
  (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
  (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
  (codePoint >= 0xfe20 && codePoint <= 0xfe2f);

const isCjkCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7af);

const estimateTextTokens = (value: string): number => {
  const normalized = value.normalize('NFC');
  if (!normalized.trim()) {
    return 0;
  }

  let cjkCharacterCount = 0;
  let otherCharacterCount = 0;

  Array.from(normalized).forEach((character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || isWhitespace(character) || isCombiningMarkCodePoint(codePoint)) {
      return;
    }

    if (isCjkCodePoint(codePoint)) {
      cjkCharacterCount += 1;
      return;
    }

    otherCharacterCount += 1;
  });

  return Math.ceil(cjkCharacterCount * CJK_TOKEN_WEIGHT + otherCharacterCount * OTHER_TOKEN_WEIGHT);
};

const estimateMessageTokens = (message: IAiChatMessage): number => {
  const contentTokens = estimateTextTokens(message.content);
  const referenceTokens = message.references.reduce((total, reference) => {
    const referenceContentTokens =
      estimateTextTokens(reference.label) +
      estimateTextTokens(reference.path ?? '') +
      estimateTextTokens(reference.contentPreview);

    return total + (referenceContentTokens > 0 ? referenceContentTokens + REFERENCE_TOKEN_OVERHEAD : 0);
  }, 0);

  if (contentTokens <= 0 && referenceTokens <= 0) {
    return 0;
  }

  return contentTokens + referenceTokens + MESSAGE_TOKEN_OVERHEAD;
};

const estimateInputTokens = (
  messages: readonly IAiChatMessage[],
  draft: string,
): number => {
  const messageTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  const draftTokens = estimateTextTokens(draft);

  return messageTokens + (draftTokens > 0 ? draftTokens + MESSAGE_TOKEN_OVERHEAD : 0);
};

const resolveMaxTokens = (modelId: string | undefined): number => {
  if (!modelId) {
    return 0;
  }

  const normalizedModelId = modelId.trim().toLowerCase();
  if (normalizedModelId.startsWith('deepseek/')) {
    return DEEPSEEK_CONTEXT_LIMIT_TOKENS;
  }

  const context = getContext({ modelId });
  const maxTokens = [
    context.maxTotal,
    context.totalMax,
    context.combinedMax,
    context.maxInput,
    context.inputMax,
  ].find(isPositiveFiniteNumber);

  return maxTokens ?? 0;
};

export const useAiTokenContext = (options: IUseAiTokenContextOptions) => {
  const normalizedModelId = computed(() => {
    const value = options.modelId.value?.trim();
    return value ? value : undefined;
  });

  const projectedInputTokens = computed(() => {
    const events = options.runtimeEvents.value;

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (
        (event?.type === 'acontext.token.checked' || event?.type === 'agent.model.started') &&
        event.projectedInputTokensAvailable &&
        isPositiveFiniteNumber(event.projectedInputTokens)
      ) {
        return event.projectedInputTokens;
      }
    }

    return estimateInputTokens(options.messages.value, options.draft.value);
  });

  const usage = computed(() => createUsage(projectedInputTokens.value));
  const maxTokens = computed(() => resolveMaxTokens(normalizedModelId.value));

  const contextProps = computed<IAiTokenContextProps>(() => ({
    usedTokens: usage.value.totalTokens ?? 0,
    maxTokens: maxTokens.value,
    ...(normalizedModelId.value ? { modelId: normalizedModelId.value } : {}),
    usage: usage.value,
  }));

  return {
    contextProps,
  };
};
