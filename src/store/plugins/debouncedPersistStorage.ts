/**
 * pinia-plugin-persistedstate 的 storage 适配器：把高频 setItem 合并防抖，
 * 显著降低 AI 会话场景下(滚动状态更新、流式消息边界写入)持续触发的
 * 全量 JSON 序列化 + 同步 localStorage 写入开销。
 *
 * 安全性：
 * - getItem 优先返回挂起(未落盘)的最新值，保证 hydrate 读到最新快照;
 * - flush() 可在 pagehide / beforeunload / 页面隐藏时强制写入，避免关闭丢数据;
 * - 仅适用于可容忍极短(防抖窗口)写入延迟的非关键 store(此处为 ai-conversation)。
 */

export interface IPersistStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface IDebouncedPersistStorage {
  /** 传给 pinia persist 的 storage。 */
  storage: IPersistStorageLike;
  /** 立即落盘所有挂起写入。 */
  flush: () => void;
  /** 丢弃挂起的定时器(不落盘)，用于清理。 */
  cancel: () => void;
}

export const createDebouncedPersistStorage = (
  base: IPersistStorageLike,
  delayMs: number,
): IDebouncedPersistStorage => {
  const normalizedDelay = Math.max(0, delayMs);
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = (): void => {
    clearTimer();
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    for (const [key, value] of entries) {
      base.setItem(key, value);
    }
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, normalizedDelay);
  };

  const storage: IPersistStorageLike = {
    getItem(key) {
      const buffered = pending.get(key);
      return buffered === undefined ? base.getItem(key) : buffered;
    },
    setItem(key, value) {
      pending.set(key, value);
      schedule();
    },
    removeItem(key) {
      pending.delete(key);
      base.removeItem?.(key);
    },
  };

  return {
    storage,
    flush,
    cancel: clearTimer,
  };
};

const AI_CONVERSATION_PERSIST_DEBOUNCE_MS = 300;

const NOOP_STORAGE: IPersistStorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

let sharedAiConversationStorage: IDebouncedPersistStorage | null = null;

/**
 * ai-conversation store 专用的防抖持久化 storage(单例)。
 * 非浏览器环境(无 window/localStorage)退回 no-op，由调用方/插件自行降级。
 */
export const getAiConversationPersistStorage = (): IPersistStorageLike => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return NOOP_STORAGE;
  }
  if (!sharedAiConversationStorage) {
    sharedAiConversationStorage = createDebouncedPersistStorage(
      window.localStorage,
      AI_CONVERSATION_PERSIST_DEBOUNCE_MS,
    );
    const flush = (): void => {
      sharedAiConversationStorage?.flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flush();
        }
      });
    }
  }
  return sharedAiConversationStorage.storage;
};
