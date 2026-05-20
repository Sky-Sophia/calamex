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

        expect(pricing?.usage).toMatchObject({
            inputTokens: 30,
            cacheHitInputTokens: 7,
            cacheMissInputTokens: 23,
            outputTokens: 12,
        });
        expect(pricing?.cacheHitInputCostCny).toBeCloseTo(0.0000007);
        expect(pricing?.cacheMissInputCostCny).toBeCloseTo(0.000276);
        expect(pricing?.inputCostCny).toBeCloseTo(0.0002767);
        expect(pricing?.outputCostCny).toBeCloseTo(0.000288);
        expect(pricing?.totalCostCny).toBeCloseTo(0.0005647);
    });

    it('keeps tiny cache hit costs visible instead of rounding them to zero', () => {
        expect(formatCnyCost(0.00001024)).toBe('0.00001 元');
    });
});
