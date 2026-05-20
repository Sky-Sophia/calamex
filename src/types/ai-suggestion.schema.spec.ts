import {
  aiSuggestionLayoutSchema,
  aiSuggestionPoolItemSchema,
  aiSuggestionPoolPayloadSchema,
  aiSuggestionPoolRequestSchema,
  aiSuggestionSelectionSchema,
} from '@/types/ai-suggestion.schema';
import { describe, expect, it } from 'vitest';

describe('AI suggestion schema', () => {
  it('校验建议词池请求和生成结果', () => {
    const request = aiSuggestionPoolRequestSchema.parse({
      count: 9,
      locale: 'zh-CN',
      topics: ['重构', '测试'],
    });

    const payload = aiSuggestionPoolPayloadSchema.parse({
      suggestions: Array.from({ length: request.count }, (_, index) => `建议 ${index + 1}`),
      model: 'deepseek-chat',
      generatedAt: '2026-05-20T10:00:00.000Z',
    });

    expect(payload.suggestions).toHaveLength(9);
  });

  it('校验建议项、选中记录和布局状态', () => {
    const item = aiSuggestionPoolItemSchema.parse({
      id: 'suggestion-1',
      text: '解释当前文件',
      source: 'generated',
    });
    const selection = aiSuggestionSelectionSchema.parse({
      selectedText: item.text,
      selectedAt: '2026-05-20T10:00:00.000Z',
    });
    const layout = aiSuggestionLayoutSchema.parse({
      visibleCount: 3,
      columnCount: 1,
    });

    expect(selection.selectedText).toBe('解释当前文件');
    expect(layout.visibleCount).toBe(3);
    expect(() => aiSuggestionPoolItemSchema.parse({ ...item, text: '' })).toThrow();
  });
});
