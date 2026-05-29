import type { Suggestion } from '@copilotkit/core';
import { useConfigureSuggestions, useSuggestions } from '@copilotkit/vue';
import { computed, onMounted, type Ref, ref } from 'vue';
import { aiService } from '@/services/ipc/ai.service';
import { logger } from '@/utils/logger';

/** 兜底静态建议：免费小模型不可用时展示。 */
const STATIC: Suggestion[] = [
  { title: '解释代码', message: '请解释当前文件的代码逻辑', isLoading: false },
  { title: '优化代码', message: '请分析当前代码并给出优化建议', isLoading: false },
  { title: '写注释', message: '请为当前代码添加详细的中文注释', isLoading: false },
  { title: '找 Bug', message: '请检查当前代码是否存在潜在问题', isLoading: false },
  { title: '写单测', message: '请为当前代码编写单元测试', isLoading: false },
  { title: '重构建议', message: '请给出当前代码的重构建议', isLoading: false },
];

/** 免费小模型(narrator endpoint)建议词池请求参数。 */
const POOL_LOCALE = 'zh-CN';
const POOL_COUNT = 12;
const POOL_TOPICS = ['代码解释', '代码优化', '调试排错', '单元测试', '重构', 'Shell 脚本'] as const;
/** 空态一行展示的建议数量。 */
const DISPLAY_COUNT = 6;
/** 建议标题最大展示长度，超出截断加省略号。 */
const TITLE_MAX_LENGTH = 12;

const toSuggestion = (message: string): Suggestion => {
  const title =
    message.length > TITLE_MAX_LENGTH ? `${message.slice(0, TITLE_MAX_LENGTH)}…` : message;
  return { title, message, isLoading: false };
};

/** 从词池里去重并随机挑选 DISPLAY_COUNT 条，避免每次都一样。 */
const pickFromPool = (pool: readonly string[]): Suggestion[] => {
  const unique = Array.from(new Set(pool.map((item) => item.trim()).filter(Boolean)));
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, DISPLAY_COUNT).map(toSuggestion);
};

export interface IUseCopilotSuggestionsResult {
  suggestions: Ref<readonly Suggestion[]>;
  suggestionTexts: Ref<readonly string[]>;
}

export const useCopilotSuggestions = (): IUseCopilotSuggestionsResult => {
  let raw: Ref<Suggestion[]> = ref(STATIC) as unknown as Ref<Suggestion[]>;

  try {
    useConfigureSuggestions({ suggestions: STATIC, available: 'before-first-message' });
    ({ suggestions: raw } = useSuggestions({ agentId: 'default' }));
  } catch {
    // Provider absent — fall back to static suggestions.
  }

  // 走免费小模型(narrator endpoint, 例如 zhipuai/glm-4.7-flash)生成的建议词池。
  const poolSuggestions = ref<Suggestion[]>([]);

  const loadPool = async (): Promise<void> => {
    try {
      const cached = await aiService.getSuggestionPoolCache();
      if (cached?.suggestions?.length) {
        poolSuggestions.value = pickFromPool(cached.suggestions);
        return;
      }

      const generated = await aiService.generateSuggestionPool({
        count: POOL_COUNT,
        locale: POOL_LOCALE,
        topics: [...POOL_TOPICS],
      });
      if (generated?.suggestions?.length) {
        poolSuggestions.value = pickFromPool(generated.suggestions);
      }
    } catch (err) {
      logger.warn({ event: 'copilotkit.suggestion_pool_load_failed', err });
    }
  };

  onMounted(() => {
    void loadPool();
  });

  const suggestions = computed<readonly Suggestion[]>(() => {
    const base = poolSuggestions.value.length > 0 ? poolSuggestions.value : raw.value;
    return base.filter((s: Suggestion) => s.message.trim().length > 0);
  });

  const suggestionTexts = computed<readonly string[]>(() =>
    suggestions.value.map((s: Suggestion) => s.message),
  );

  return { suggestions, suggestionTexts };
};
