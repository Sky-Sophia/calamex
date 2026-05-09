import { afterEach, describe, expect, it, vi } from 'vitest';

const aiServiceMock = vi.hoisted(() => ({
  getSuggestionPoolCache: vi.fn(),
  generateSuggestionPool: vi.fn(),
}));

vi.mock('@/services/modules/ai', () => ({
  aiService: aiServiceMock,
}));

import {
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_POOL_SIZE,
} from '@/constants/ai-suggestions';
import { useAiSuggestionPool } from '@/composables/useAiSuggestionPool';
import type { IAiSuggestionPoolPayload, IAiSuggestionPoolRequest } from '@/types/ai';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref, type Ref } from 'vue';

const createGeneratedPayload = (): IAiSuggestionPoolPayload => ({
  suggestions: Array.from(
    { length: AI_SUGGESTION_POOL_SIZE },
    (_value, index) => `模型提示词${index + 1}测试`,
  ),
  model: 'zhipu/glm-4-flash',
  generatedAt: '2026-05-06T00:00:00.000Z',
});

const createTemplatePayload = (): IAiSuggestionPoolPayload => ({
  suggestions: Array.from(
    { length: AI_SUGGESTION_POOL_SIZE },
    (_value, index) => `如何选择合适的运动方案${index + 1}`,
  ),
  model: 'zhipu/glm-4-flash',
  generatedAt: '2026-05-06T00:00:00.000Z',
});

const createCachedPayload = (): IAiSuggestionPoolPayload => ({
  suggestions: Array.from(
    { length: AI_SUGGESTION_POOL_SIZE },
    (_value, index) => `缓存提示词${index + 1}测试`,
  ),
  model: 'zhipu/glm-4-flash',
  generatedAt: '2026-05-06T00:10:00.000Z',
});

const createCachedPayloadAt = (generatedAt: string): IAiSuggestionPoolPayload => ({
  ...createCachedPayload(),
  generatedAt,
});

const mountSuggestionPool = (params: {
  isRefreshEnabled: Ref<boolean>;
  getSuggestionPoolCache?: () => Promise<IAiSuggestionPoolPayload | null>;
  generateSuggestionPool: (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>;
}) => mount(defineComponent({
  setup() {
    const pool = useAiSuggestionPool({
      isRefreshEnabled: params.isRefreshEnabled,
      service: {
        getSuggestionPoolCache: params.getSuggestionPoolCache ?? (async () => null),
        generateSuggestionPool: params.generateSuggestionPool,
      },
      random: () => 0.42,
    });

    return {
      suggestions: pool.suggestions,
      refreshPool: pool.refreshPool,
    };
  },
  template: '<div>{{ suggestions.length }}</div>',
}));

describe('useAiSuggestionPool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认从 90 条终极兜底池里取 9 条展示', async () => {
    const getSuggestionPoolCache = vi.fn(async () => null);
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(false),
      getSuggestionPoolCache,
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(getSuggestionPoolCache).toHaveBeenCalledTimes(1);
    expect(generateSuggestionPool).not.toHaveBeenCalled();
  });

  it('启动时优先使用上次小模型留下的提示词池缓存', async () => {
    const getSuggestionPoolCache = vi.fn(async () => createCachedPayload());
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(false),
      getSuggestionPoolCache,
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(vm.suggestions.some((suggestion) => suggestion.startsWith('缓存提示词'))).toBe(true);
    expect(generateSuggestionPool).not.toHaveBeenCalled();
  });

  it('小模型启用后刷新提示词池并保持每批 9 条', async () => {
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(true),
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };

    expect(generateSuggestionPool).toHaveBeenCalledWith(expect.objectContaining({
      count: AI_SUGGESTION_POOL_SIZE,
      locale: 'zh-CN',
    }));
    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(vm.suggestions.some((suggestion) => suggestion.startsWith('模型提示词'))).toBe(true);
  });

  it('小模型返回同款句式时展示批次会混入兜底提示词', async () => {
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createTemplatePayload());
    const wrapper = mountSuggestionPool({
      isRefreshEnabled: ref(true),
      generateSuggestionPool,
    });

    await flushPromises();

    const vm = wrapper.vm as unknown as { suggestions: string[] };
    const templateCount = vm.suggestions.filter((suggestion) =>
      suggestion.startsWith('如何选择合适的'),
    ).length;

    expect(vm.suggestions).toHaveLength(AI_SUGGESTION_BATCH_SIZE);
    expect(templateCount).toBeLessThanOrEqual(2);
    expect(vm.suggestions.some((suggestion) => !suggestion.startsWith('如何选择合适的'))).toBe(true);
  });

  it('小模型启用后按现实时间下一个 10 分钟边界刷新', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T00:07:00.000Z'));

    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    mountSuggestionPool({
      isRefreshEnabled: ref(true),
      generateSuggestionPool,
    });

    await flushPromises();
    expect(generateSuggestionPool).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 - 1);
    await flushPromises();

    expect(generateSuggestionPool).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(generateSuggestionPool).toHaveBeenCalledTimes(2);
  });

  it('当前现实 10 分钟窗口已有缓存时不立即刷新', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T00:07:00.000Z'));

    const getSuggestionPoolCache = vi.fn(async () =>
      createCachedPayloadAt('2026-05-06T00:04:00.000Z'),
    );
    const generateSuggestionPool = vi.fn<
      (payload: IAiSuggestionPoolRequest) => Promise<IAiSuggestionPoolPayload>
    >(async () => createGeneratedPayload());
    mountSuggestionPool({
      isRefreshEnabled: ref(true),
      getSuggestionPoolCache,
      generateSuggestionPool,
    });

    await flushPromises();

    expect(getSuggestionPoolCache).toHaveBeenCalledTimes(1);
    expect(generateSuggestionPool).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    await flushPromises();

    expect(generateSuggestionPool).toHaveBeenCalledTimes(1);
  });
});
