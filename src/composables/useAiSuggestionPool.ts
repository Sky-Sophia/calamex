import {
  AI_ASSISTANT_FALLBACK_SUGGESTIONS,
  AI_SUGGESTION_BATCH_SIZE,
  AI_SUGGESTION_LOCALE,
  AI_SUGGESTION_POOL_SIZE,
  AI_SUGGESTION_REFRESH_INTERVAL_MS,
  AI_SUGGESTION_TOPICS,
} from '@/constants/ai-suggestions';
import { aiService } from '@/services/modules/ai';
import type { IAiSuggestionPoolPayload, IAiSuggestionPoolRequest } from '@/types/ai';
import { toErrorMessage } from '@/utils/error';
import {
  normalizeSuggestionPool,
  pickSuggestionBatch,
} from '@/utils/ai-suggestion-selection';
import {
  onScopeDispose,
  readonly,
  ref,
  watch,
  type Ref,
} from 'vue';

interface IAiSuggestionPoolService {
  getSuggestionPoolCache(): Promise<IAiSuggestionPoolPayload | null>;
  generateSuggestionPool(payload: IAiSuggestionPoolRequest): Promise<IAiSuggestionPoolPayload>;
}

interface IUseAiSuggestionPoolOptions {
  isRefreshEnabled?: Readonly<Ref<boolean>>;
  service?: IAiSuggestionPoolService;
  random?: () => number;
  now?: () => number;
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const SUGGESTION_REFRESH_WINDOW_MINUTES = AI_SUGGESTION_REFRESH_INTERVAL_MS / MS_PER_MINUTE;

const getUltimateFallbackPool = (): string[] =>
  normalizeSuggestionPool(AI_ASSISTANT_FALLBACK_SUGGESTIONS, AI_SUGGESTION_LOCALE)
    .slice(0, AI_SUGGESTION_POOL_SIZE);

const ULTIMATE_FALLBACK_POOL = getUltimateFallbackPool();

const createDefaultRandom = (): (() => number) => () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] ?? 0) / 0x100000000;
  }

  return Math.random();
};

const resolveRefreshWindowKey = (timestamp: number): string | null => {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  const windowMinute =
    Math.floor(date.getMinutes() / SUGGESTION_REFRESH_WINDOW_MINUTES) *
    SUGGESTION_REFRESH_WINDOW_MINUTES;

  return [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), windowMinute].join(
    ':',
  );
};

const resolveGeneratedAtWindowKey = (generatedAt: string): string | null =>
  resolveRefreshWindowKey(Date.parse(generatedAt));

const resolveNextRefreshDelayMs = (timestamp: number): number => {
  const date = new Date(timestamp);
  const remainingMinutes =
    SUGGESTION_REFRESH_WINDOW_MINUTES - (date.getMinutes() % SUGGESTION_REFRESH_WINDOW_MINUTES);
  const delay =
    remainingMinutes * MS_PER_MINUTE - date.getSeconds() * MS_PER_SECOND - date.getMilliseconds();

  return Math.max(0, delay);
};

export const useAiSuggestionPool = (options: IUseAiSuggestionPoolOptions = {}) => {
  const service = options.service ?? aiService;
  const random = options.random ?? createDefaultRandom();
  const now = options.now ?? Date.now;
  const isRefreshEnabled = options.isRefreshEnabled ?? ref(false);
  const suggestionPool = ref<string[]>(ULTIMATE_FALLBACK_POOL);
  const suggestions = ref<string[]>(pickSuggestionBatch(suggestionPool.value, ULTIMATE_FALLBACK_POOL, {
    batchSize: AI_SUGGESTION_BATCH_SIZE,
    locale: AI_SUGGESTION_LOCALE,
    random,
  }));
  const isRefreshing = ref(false);
  const refreshErrorMessage = ref('');
  let refreshTimer: ReturnType<typeof window.setTimeout> | null = null;
  let cachedPoolPromise: Promise<void> | null = null;
  let hasLoadedCachedPool = false;
  let activePoolGeneratedAt: string | null = null;

  const clearRefreshTimer = (): void => {
    if (refreshTimer === null || typeof window === 'undefined') {
      refreshTimer = null;
      return;
    }

    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const rotateBatch = (): void => {
    suggestions.value = pickSuggestionBatch(suggestionPool.value, ULTIMATE_FALLBACK_POOL, {
      batchSize: AI_SUGGESTION_BATCH_SIZE,
      locale: AI_SUGGESTION_LOCALE,
      random,
    });
  };

  const applyLocalPool = (pool: readonly string[]): boolean => {
    const normalizedPool = normalizeSuggestionPool(pool, AI_SUGGESTION_LOCALE)
      .slice(0, AI_SUGGESTION_POOL_SIZE);

    if (normalizedPool.length < AI_SUGGESTION_BATCH_SIZE) {
      return false;
    }

    suggestionPool.value = normalizedPool;
    rotateBatch();
    return true;
  };

  const applySuggestionPayload = (payload: IAiSuggestionPoolPayload): boolean => {
    const didApply = applyLocalPool(payload.suggestions);

    if (didApply) {
      activePoolGeneratedAt = payload.generatedAt;
    }

    return didApply;
  };

  const shouldRefreshCurrentWindow = (): boolean => {
    if (!activePoolGeneratedAt) {
      return true;
    }

    const activeWindowKey = resolveGeneratedAtWindowKey(activePoolGeneratedAt);
    const currentWindowKey = resolveRefreshWindowKey(now());

    return (
      activeWindowKey === null || currentWindowKey === null || activeWindowKey !== currentWindowKey
    );
  };

  const loadCachedPool = async (): Promise<void> => {
    if (hasLoadedCachedPool) {
      return;
    }

    if (cachedPoolPromise) {
      await cachedPoolPromise;
      return;
    }

    cachedPoolPromise = (async () => {
      try {
        const payload = await service.getSuggestionPoolCache();

        if (payload) {
          applySuggestionPayload(payload);
        }
      } catch (error) {
        console.warn(toErrorMessage(error, '读取提示词池缓存失败。'));
      } finally {
        hasLoadedCachedPool = true;
        cachedPoolPromise = null;
      }
    })();

    await cachedPoolPromise;
  };

  const refreshPool = async (): Promise<void> => {
    if (!isRefreshEnabled.value || isRefreshing.value) {
      return;
    }

    isRefreshing.value = true;

    try {
      const payload = await service.generateSuggestionPool({
        count: AI_SUGGESTION_POOL_SIZE,
        locale: AI_SUGGESTION_LOCALE,
        topics: [...AI_SUGGESTION_TOPICS],
      });
      const generatedPool = normalizeSuggestionPool(payload.suggestions, AI_SUGGESTION_LOCALE)
        .slice(0, AI_SUGGESTION_POOL_SIZE);

      if (generatedPool.length < AI_SUGGESTION_BATCH_SIZE) {
        throw new Error('小模型返回的提示词数量不足，已保留本地提示词池。');
      }

      applyLocalPool(generatedPool);
      activePoolGeneratedAt = payload.generatedAt;
      refreshErrorMessage.value = '';
    } catch (error) {
      refreshErrorMessage.value = toErrorMessage(error, '提示词池刷新失败。');
      console.warn(refreshErrorMessage.value);
    } finally {
      isRefreshing.value = false;
    }
  };

  const refreshCurrentWindowIfNeeded = async (): Promise<void> => {
    if (!isRefreshEnabled.value || !shouldRefreshCurrentWindow()) {
      return;
    }

    await refreshPool();
  };

  const scheduleNextRefresh = (): void => {
    clearRefreshTimer();

    if (!isRefreshEnabled.value || typeof window === 'undefined') {
      return;
    }

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refreshCurrentWindowIfNeeded().finally(() => {
        scheduleNextRefresh();
      });
    }, resolveNextRefreshDelayMs(now()));
  };

  const syncRefreshWindow = async (): Promise<void> => {
    await loadCachedPool();

    if (!isRefreshEnabled.value) {
      return;
    }

    await refreshCurrentWindowIfNeeded();
    scheduleNextRefresh();
  };

  const stopEnabledWatcher = watch(
    () => isRefreshEnabled.value,
    (enabled) => {
      if (!enabled) {
        clearRefreshTimer();
        void loadCachedPool();
        return;
      }

      void syncRefreshWindow();
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    clearRefreshTimer();
    stopEnabledWatcher();
  });

  return {
    suggestions: readonly(suggestions),
    isRefreshing: readonly(isRefreshing),
    refreshErrorMessage: readonly(refreshErrorMessage),
    rotateBatch,
    refreshPool,
  };
};
