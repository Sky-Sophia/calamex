import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';
import type { IAiChatMessage } from '@/types/ai';
import type { IAiContextReference } from '@/types/ai-context';
import type { LanguageModelUsage } from 'ai';
import { getContext } from 'tokenlens';
import type { ComputedRef } from 'vue';
import { computed } from 'vue';

export interface IAiTokenContextProps {
  usedTokens: number;
  maxTokens: number;
  modelId?: string;
  usage: LanguageModelUsage;
  usageSource: TAiTokenUsageSource;
}

export type TAiTokenContextMode = 'chat' | 'agent' | 'plan';
export type TAiTokenUsageSource = 'official' | 'estimated';

interface IUseAiTokenContextOptions {
  mode: ComputedRef<TAiTokenContextMode>;
  modelId: ComputedRef<string | null | undefined>;
  runtimeEvents: ComputedRef<readonly TAgentRuntimeEvent[]>;
  messages: ComputedRef<readonly IAiChatMessage[]>;
  estimationMessages?: ComputedRef<readonly IAiChatMessage[]>;
  contextReferences: ComputedRef<readonly IAiContextReference[]>;
  hasPendingRequest: ComputedRef<boolean>;
  draft: ComputedRef<string>;
  officialUsage?: ComputedRef<LanguageModelUsage | null | undefined>;
}

const CJK_TOKEN_WEIGHT = 0.6;
const OTHER_TOKEN_WEIGHT = 0.3;
const MESSAGE_TOKEN_OVERHEAD = 4;
const REFERENCE_TOKEN_OVERHEAD = 8;
const DEEPSEEK_CONTEXT_LIMIT_TOKENS = 1_000_000;

const isPositiveFiniteNumber = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const toNonNegativeFiniteNumber = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

const isWhitespace = (value: string): boolean => value.trim().length === 0;

const resolveUsageInputTokens = (usage: LanguageModelUsage | undefined): number | undefined => {
  const inputTokens = toNonNegativeFiniteNumber(usage?.inputTokens);
  if (inputTokens !== undefined) {
    return inputTokens;
  }

  const totalTokens = toNonNegativeFiniteNumber(usage?.totalTokens);
  const outputTokens = toNonNegativeFiniteNumber(usage?.outputTokens);
  if (totalTokens !== undefined && outputTokens !== undefined) {
    return Math.max(0, totalTokens - outputTokens);
  }

  return undefined;
};

const hasUsableUsage = (usage: LanguageModelUsage | null | undefined): usage is LanguageModelUsage =>
  resolveUsageInputTokens(usage ?? undefined) !== undefined ||
  toNonNegativeFiniteNumber(usage?.outputTokens) !== undefined ||
  toNonNegativeFiniteNumber(usage?.totalTokens) !== undefined ||
  toNonNegativeFiniteNumber(usage?.reasoningTokens) !== undefined ||
  toNonNegativeFiniteNumber(usage?.cachedInputTokens) !== undefined ||
  toNonNegativeFiniteNumber(usage?.inputTokenDetails?.cacheReadTokens) !== undefined ||
  toNonNegativeFiniteNumber(usage?.outputTokenDetails?.reasoningTokens) !== undefined;

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

const estimateReferenceTokens = (references: readonly IAiContextReference[]): number =>
  references.reduce((total, reference) => {
    const referenceContentTokens =
      estimateTextTokens(reference.label) +
      estimateTextTokens(reference.path ?? '') +
      estimateTextTokens(reference.contentPreview);

    return total + (referenceContentTokens > 0 ? referenceContentTokens + REFERENCE_TOKEN_OVERHEAD : 0);
  }, 0);

const estimateMessageTokens = (message: IAiChatMessage): number => {
  const contentTokens = estimateTextTokens(message.content);
  const referenceTokens = estimateReferenceTokens(message.references);

  if (contentTokens <= 0 && referenceTokens <= 0) {
    return 0;
  }

  return contentTokens + referenceTokens + MESSAGE_TOKEN_OVERHEAD;
};

const estimatePendingInputTokens = (
  draft: string,
  pendingReferences: readonly IAiContextReference[],
): number => {
  const draftTokens = estimateTextTokens(draft);
  const referenceTokens = estimateReferenceTokens(pendingReferences);

  if (draftTokens <= 0 && referenceTokens <= 0) {
    return 0;
  }

  return draftTokens + referenceTokens + MESSAGE_TOKEN_OVERHEAD;
};

const estimateInputTokens = (
  messages: readonly IAiChatMessage[],
  draft: string,
  pendingReferences: readonly IAiContextReference[],
): number => {
  const messageTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );

  return messageTokens + estimatePendingInputTokens(draft, pendingReferences);
};

const createUsage = (
  inputTokens: number,
  options?: {
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  },
): LanguageModelUsage => {
  const outputTokens = toNonNegativeFiniteNumber(options?.outputTokens) ?? 0;
  const reasoningTokens = toNonNegativeFiniteNumber(options?.reasoningTokens) ?? 0;
  const totalTokens = toNonNegativeFiniteNumber(options?.totalTokens) ?? (inputTokens + outputTokens);

  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: Math.max(0, outputTokens - reasoningTokens),
      reasoningTokens,
    },
    totalTokens,
    cachedInputTokens: 0,
    reasoningTokens,
  };
};

interface IResolvedTokenUsage {
  source: TAiTokenUsageSource;
  usage: LanguageModelUsage;
}

const sumTokenCounts = (
  left: number | undefined,
  right: number | undefined,
): number | undefined => {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  return (left ?? 0) + (right ?? 0);
};

const sumRequiredTokenCounts = (
  left: number | undefined,
  right: number | undefined,
): number => (left ?? 0) + (right ?? 0);

const resolveAggregationInputTokenDetails = (
  usage: LanguageModelUsage,
): NonNullable<LanguageModelUsage['inputTokenDetails']> => {
  const inputTokens = resolveUsageInputTokens(usage) ?? 0;
  const cacheReadTokens =
    toNonNegativeFiniteNumber(usage.inputTokenDetails?.cacheReadTokens) ??
    toNonNegativeFiniteNumber(usage.cachedInputTokens) ??
    0;

  return {
    noCacheTokens:
      toNonNegativeFiniteNumber(usage.inputTokenDetails?.noCacheTokens) ??
      Math.max(0, inputTokens - cacheReadTokens),
    cacheReadTokens,
    cacheWriteTokens: toNonNegativeFiniteNumber(usage.inputTokenDetails?.cacheWriteTokens) ?? 0,
  };
};

const resolveAggregationOutputTokenDetails = (
  usage: LanguageModelUsage,
): NonNullable<LanguageModelUsage['outputTokenDetails']> => {
  const outputTokens = toNonNegativeFiniteNumber(usage.outputTokens) ?? 0;
  const reasoningTokens =
    toNonNegativeFiniteNumber(usage.outputTokenDetails?.reasoningTokens) ??
    toNonNegativeFiniteNumber(usage.reasoningTokens) ??
    0;

  return {
    textTokens:
      toNonNegativeFiniteNumber(usage.outputTokenDetails?.textTokens) ??
      Math.max(0, outputTokens - reasoningTokens),
    reasoningTokens,
  };
};

const aggregateUsage = (
  current: LanguageModelUsage | undefined,
  next: LanguageModelUsage,
): LanguageModelUsage => {
  const currentInputDetails = current ? resolveAggregationInputTokenDetails(current) : undefined;
  const nextInputDetails = resolveAggregationInputTokenDetails(next);
  const currentOutputDetails = current ? resolveAggregationOutputTokenDetails(current) : undefined;
  const nextOutputDetails = resolveAggregationOutputTokenDetails(next);
  const cachedInputTokens = sumTokenCounts(
    current?.cachedInputTokens ?? currentInputDetails?.cacheReadTokens,
    next.cachedInputTokens ?? nextInputDetails.cacheReadTokens,
  );
  const reasoningTokens = sumTokenCounts(
    current?.reasoningTokens ?? currentOutputDetails?.reasoningTokens,
    next.reasoningTokens ?? nextOutputDetails.reasoningTokens,
  );

  return {
    inputTokens: sumRequiredTokenCounts(current?.inputTokens, next.inputTokens),
    inputTokenDetails: {
      noCacheTokens: sumRequiredTokenCounts(
        currentInputDetails?.noCacheTokens,
        nextInputDetails.noCacheTokens,
      ),
      cacheReadTokens: sumRequiredTokenCounts(
        currentInputDetails?.cacheReadTokens,
        nextInputDetails.cacheReadTokens,
      ),
      cacheWriteTokens: sumRequiredTokenCounts(
        currentInputDetails?.cacheWriteTokens,
        nextInputDetails.cacheWriteTokens,
      ),
    },
    outputTokens: sumRequiredTokenCounts(current?.outputTokens, next.outputTokens),
    outputTokenDetails: {
      textTokens: sumRequiredTokenCounts(
        currentOutputDetails?.textTokens,
        nextOutputDetails.textTokens,
      ),
      reasoningTokens: sumRequiredTokenCounts(
        currentOutputDetails?.reasoningTokens,
        nextOutputDetails.reasoningTokens,
      ),
    },
    totalTokens: sumRequiredTokenCounts(current?.totalTokens, next.totalTokens),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
};

const resolveStreamOfficialUsage = (
  stream: IAiChatMessage['stream'] | undefined,
): LanguageModelUsage | undefined => {
  if (!stream) {
    return undefined;
  }

  if (hasUsableUsage(stream.usage)) {
    return stream.usage;
  }

  if (stream.status !== 'completed') {
    return undefined;
  }

  const promptTokens = toNonNegativeFiniteNumber(stream.promptTokens);
  const completionTokens = toNonNegativeFiniteNumber(stream.completionTokens);
  const totalTokens = toNonNegativeFiniteNumber(stream.totalTokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return createUsage(promptTokens ?? 0, {
    outputTokens: completionTokens,
    totalTokens,
  });
};

const resolveAccumulatedStreamUsage = (
  messages: readonly IAiChatMessage[],
): IResolvedTokenUsage | undefined => {
  const usage = messages.reduce<LanguageModelUsage | undefined>((current, message) => {
    const streamUsage = resolveStreamOfficialUsage(message.stream);

    if (!streamUsage) {
      return current;
    }

    return aggregateUsage(current, streamUsage);
  }, undefined);

  return usage ? { source: 'official', usage } : undefined;
};

const resolveLatestAssistantOutputTokens = (
  messages: readonly IAiChatMessage[],
): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== 'assistant') {
      continue;
    }

    const outputTokens = estimateTextTokens(message.content);

    if (outputTokens > 0) {
      return outputTokens;
    }
  }

  return 0;
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

  const estimationMessages = computed(() => options.estimationMessages?.value ?? options.messages.value);

  const accumulatedStreamUsage = computed(() => resolveAccumulatedStreamUsage(options.messages.value));
  const latestOfficialUsage = computed<IResolvedTokenUsage | undefined>(() => {
    const usage = options.officialUsage?.value;

    if (!hasUsableUsage(usage)) {
      return undefined;
    }

    return {
      source: 'official',
      usage,
    };
  });
  const latestCompletedUsage = computed(() => latestOfficialUsage.value ?? accumulatedStreamUsage.value);
  const latestAssistantOutputTokens = computed(() => resolveLatestAssistantOutputTokens(options.messages.value));

  const estimateCurrentInputTokens = (): number => estimateInputTokens(
    estimationMessages.value,
    options.draft.value,
    options.contextReferences.value,
  );

  const projectedInputTokens = computed(() => {
    if (options.hasPendingRequest.value) {
      return estimateCurrentInputTokens();
    }

    const completedInputTokens = resolveUsageInputTokens(latestCompletedUsage.value?.usage);

    if (completedInputTokens !== undefined) {
      return completedInputTokens;
    }

    const events = options.runtimeEvents.value;

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (
        (
          event?.type === 'acontext.provider_payload.checked' ||
          event?.type === 'acontext.token.checked' ||
          event?.type === 'agent.model.started'
        ) &&
        event.projectedInputTokensAvailable &&
        isPositiveFiniteNumber(event.projectedInputTokens)
      ) {
        return event.projectedInputTokens;
      }
    }

    if (
      options.mode.value === 'chat' ||
      estimationMessages.value.length > 0 ||
      options.contextReferences.value.length > 0
    ) {
      return estimateCurrentInputTokens();
    }

    return 0;
  });

  const usage = computed(() => {
    if (!options.hasPendingRequest.value && latestCompletedUsage.value) {
      return latestCompletedUsage.value.usage;
    }

    return createUsage(projectedInputTokens.value, {
      outputTokens: options.hasPendingRequest.value ? 0 : latestAssistantOutputTokens.value,
    });
  });
  const usageSource = computed<TAiTokenUsageSource>(() => {
    if (!options.hasPendingRequest.value && latestCompletedUsage.value) {
      return latestCompletedUsage.value.source;
    }

    return 'estimated';
  });
  const maxTokens = computed(() => resolveMaxTokens(normalizedModelId.value));

  const contextProps = computed<IAiTokenContextProps>(() => ({
    usedTokens: projectedInputTokens.value,
    maxTokens: maxTokens.value,
    ...(normalizedModelId.value ? { modelId: normalizedModelId.value } : {}),
    usage: usage.value,
    usageSource: usageSource.value,
  }));

  return {
    contextProps,
  };
};
