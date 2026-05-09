import {
  mmr,
  pickSuggestionBatch,
  resolveSuggestionHead,
  resolveSuggestionShape,
  type IAiSuggestionSelectionItem,
} from '@/utils/ai-suggestion-selection';
import { describe, expect, it } from 'vitest';

const createItems = (heads: string[]): IAiSuggestionSelectionItem[] =>
  heads.map((head, index) => ({
    id: `item-${index + 1}`,
    text: `提示词${index + 1}`,
    head,
    score: 1,
  }));

describe('ai-suggestion-selection', () => {
  it('区分疑问 祈使和陈述句形态，并把形态并入 head', () => {
    expect(resolveSuggestionShape('运动鞋该看哪些指标')).toBe('question');
    expect(resolveSuggestionShape('分享冬日手工创意')).toBe('imperative');
    expect(resolveSuggestionShape('冬天手作也能很治愈')).toBe('statement');

    expect(resolveSuggestionHead('运动鞋该看哪些指标')).toMatch(/^question:/u);
    expect(resolveSuggestionHead('分享冬日手工创意')).toMatch(/^imperative:/u);
    expect(resolveSuggestionHead('冬天手作也能很治愈')).toMatch(/^statement:/u);
  });

  it('MMR 会压低同一 head 的扎堆选择', () => {
    const picked = mmr(
      createItems([
        'question:如何',
        'question:如何',
        'question:什么',
        'imperative:分享',
        'statement:冬天',
      ]),
      4,
      0.6,
    );

    expect(picked.map((item) => item.head)).toEqual([
      'question:如何',
      'question:什么',
      'imperative:分享',
      'statement:冬天',
    ]);
  });

  it('主候选全是同款句式时，会自动混入兜底池保持分布', () => {
    const mainPool = Array.from(
      { length: 18 },
      (_value, index) => `如何选择合适的运动方案${index + 1}`,
    );
    const fallbackPool = [
      '生成一篇走心的生日祝福',
      '分享冬日手工创意',
      '冬夜热红酒也有仪式感',
      '推荐一份周末轻食菜单',
      '解释为什么落叶会变色',
      '列一个雨天宅家清单',
      '帮我安排一次短途散步',
      '写一段温柔的晚安话',
      '介绍一个冷门建筑流派',
    ];

    const picked = pickSuggestionBatch(mainPool, fallbackPool, {
      batchSize: 9,
      lambda: 0.6,
      random: () => 0.42,
    });

    const repeatedMainCount = picked.filter((item) =>
      item.startsWith('如何选择合适的'),
    ).length;
    const shapeSet = new Set(picked.map((item) => resolveSuggestionShape(item)));

    expect(picked).toHaveLength(9);
    expect(repeatedMainCount).toBeLessThan(9);
    expect(shapeSet.has('question')).toBe(true);
    expect(shapeSet.has('imperative')).toBe(true);
    expect(shapeSet.has('statement')).toBe(true);
  });
});
