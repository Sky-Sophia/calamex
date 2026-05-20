import type { LanguageModelUsage } from 'ai';

const TOKENS_PER_MILLION = 1_000_000;

type TDeepSeekPricingTier = 'flash' | 'pro';

interface IDeepSeekPricingRates {
    inputCacheHitPerMillionCny: number;
    inputCacheMissPerMillionCny: number;
    outputPerMillionCny: number;
}

export interface IDeepSeekUsageBreakdown {
    inputTokens: number;
    outputTokens: number;
    cacheHitInputTokens: number;
    cacheMissInputTokens: number;
}

export interface IDeepSeekCostBreakdown {
    tier: TDeepSeekPricingTier;
    usage: IDeepSeekUsageBreakdown;
    cacheHitInputCostCny: number;
    cacheMissInputCostCny: number;
    inputCostCny: number;
    outputCostCny: number;
    totalCostCny: number;
}

const DEEPSEEK_PRICING: Record<TDeepSeekPricingTier, IDeepSeekPricingRates> = {
    flash: {
        inputCacheHitPerMillionCny: 0.02,
        inputCacheMissPerMillionCny: 1,
        outputPerMillionCny: 2,
    },
    pro: {
        inputCacheHitPerMillionCny: 0.1,
        inputCacheMissPerMillionCny: 12,
        outputPerMillionCny: 24,
    },
};

const cnyFormatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
});

const sanitizeTokenValue = (value: number | undefined): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value;
};

const resolveDeepSeekPricingTier = (modelId: string | undefined): TDeepSeekPricingTier | undefined => {
    if (!modelId) {
        return undefined;
    }

    const normalizedModelId = modelId.trim().toLowerCase();

    if (!normalizedModelId) {
        return undefined;
    }

    if (
        normalizedModelId.includes('deepseek-v4-flash') ||
        normalizedModelId.includes('deepseek-chat')
    ) {
        return 'flash';
    }

    if (
        normalizedModelId.includes('deepseek-v4-pro') ||
        normalizedModelId.includes('deepseek-reasoner')
    ) {
        return 'pro';
    }

    return undefined;
};

const getUsageBreakdown = (usage: LanguageModelUsage | undefined): IDeepSeekUsageBreakdown => {
    const inputTokens = sanitizeTokenValue(usage?.inputTokens);
    const outputTokens = sanitizeTokenValue(usage?.outputTokens);
    const cacheHitInputTokens = sanitizeTokenValue(
        usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens,
    );

    const noCacheInputTokens = sanitizeTokenValue(usage?.inputTokenDetails?.noCacheTokens);
    const cacheMissInputTokens = noCacheInputTokens > 0
        ? noCacheInputTokens
        : Math.max(0, inputTokens - cacheHitInputTokens);

    return {
        inputTokens,
        outputTokens,
        cacheHitInputTokens,
        cacheMissInputTokens,
    };
};

const getCostByTokens = (tokens: number, pricePerMillionCny: number): number =>
    (tokens / TOKENS_PER_MILLION) * pricePerMillionCny;

export const computeDeepSeekCostBreakdown = (
    modelId: string | undefined,
    usage: LanguageModelUsage | undefined,
): IDeepSeekCostBreakdown | undefined => {
    const tier = resolveDeepSeekPricingTier(modelId);

    if (!tier) {
        return undefined;
    }

    const rates = DEEPSEEK_PRICING[tier];
    const usageBreakdown = getUsageBreakdown(usage);
    const cacheHitInputCostCny =
        getCostByTokens(usageBreakdown.cacheHitInputTokens, rates.inputCacheHitPerMillionCny);
    const cacheMissInputCostCny =
        getCostByTokens(usageBreakdown.cacheMissInputTokens, rates.inputCacheMissPerMillionCny);
    const inputCostCny = cacheHitInputCostCny + cacheMissInputCostCny;
    const outputCostCny = getCostByTokens(usageBreakdown.outputTokens, rates.outputPerMillionCny);

    return {
        tier,
        usage: usageBreakdown,
        cacheHitInputCostCny,
        cacheMissInputCostCny,
        inputCostCny,
        outputCostCny,
        totalCostCny: inputCostCny + outputCostCny,
    };
};

export const formatCnyCost = (amountCny: number): string => `${cnyFormatter.format(amountCny)} 元`;
