import { computeDeepSeekCostBreakdown, formatCnyCost } from './deepseek-pricing';
import { describe, expect, it } from 'vitest';

describe('deepseek-pricing', () => {
    it('separates DeepSeek cache hit and cache miss input costs', () => {
        const pricing = computeDeepSeekCostBreakdown('deepseek/deepseek-v4-pro', {
            inputTokens: 30,
            inputTokenDetails: {
                noCacheTokens: 23,
                cacheReadTokens: 7,
                cacheWriteTokens: 0,
            },
            outputTokens: 12,
            totalTokens: 42,
            cachedInputTokens: 7,
        });

        expect(pricing).toMatchObject({
            usage: {
                inputTokens: 30,
                cacheHitInputTokens: 7,
                cacheMissInputTokens: 23,
                outputTokens: 12,
            },
            cacheHitInputCostCny: 0.0000007,
            cacheMissInputCostCny: 0.000276,
            inputCostCny: 0.0002767,
            outputCostCny: 0.000288,
            totalCostCny: 0.0005647,
        });
    });

    it('keeps tiny cache hit costs visible instead of rounding them to zero', () => {
        expect(formatCnyCost(0.00001024)).toBe('0.00001 元');
    });
});
