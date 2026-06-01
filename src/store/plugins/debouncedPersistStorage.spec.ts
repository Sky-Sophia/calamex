import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 防抖窗口上限 + 一点余量，确保定时器已触发。
const SAVE_WAIT_MS = 350;
// hydrate 超时窗口(300ms) + 余量。
const HYDRATE_TIMEOUT_WAIT_MS = 350;

const { idbMock } = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    idbMock: {
      map,
      createStore: vi.fn(() => ({})),
      get: vi.fn(async (key: string) => map.get(key)),
      set: vi.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      del: vi.fn(async (key: string) => {
        map.delete(key);
      }),
    },
  };
});

vi.mock('idb-keyval', () => ({
  createStore: idbMock.createStore,
  get: idbMock.get,
  set: idbMock.set,
  del: idbMock.del,
}));

const KEY = 'shell-ide.ai-conversation';

const loadModule = async () => {
  vi.resetModules();
  return import('./debouncedPersistStorage');
};

beforeEach(() => {
  idbMock.map.clear();
  idbMock.createStore.mockClear();
  idbMock.get.mockClear();
  idbMock.set.mockClear();
  idbMock.del.mockClear();
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ai-conversation idb 持久化 storage', () => {
  it('hydrate 前 getItem 返回 null', async () => {
    const mod = await loadModule();
    expect(mod.getAiConversationPersistStorage().getItem(KEY)).toBeNull();
  });

  it('hydrate 命中 idb 已有值后 getItem 返回该值', async () => {
    idbMock.map.set(KEY, '{"threads":[]}');
    const mod = await loadModule();
    const status = await mod.hydrateAiConversationStorage();
    expect(status).toBe('loaded');
    expect(mod.getAiConversationPersistStorage().getItem(KEY)).toBe('{"threads":[]}');
  });

  it('idb 为空时从 localStorage 迁移并清除旧 key', async () => {
    localStorage.setItem(KEY, '{"legacy":true}');
    const mod = await loadModule();
    const status = await mod.hydrateAiConversationStorage();
    expect(status).toBe('loaded');
    expect(idbMock.set).toHaveBeenCalledWith(KEY, '{"legacy":true}', expect.anything());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(mod.getAiConversationPersistStorage().getItem(KEY)).toBe('{"legacy":true}');
  });

  it('idb 与 localStorage 均为空时以空态启动', async () => {
    const mod = await loadModule();
    const status = await mod.hydrateAiConversationStorage();
    expect(status).toBe('empty');
    expect(mod.getAiConversationPersistStorage().getItem(KEY)).toBeNull();
  });

  it('setItem 更新 cache 并防抖落盘到 idb', async () => {
    const mod = await loadModule();
    await mod.hydrateAiConversationStorage();
    const storage = mod.getAiConversationPersistStorage();

    storage.setItem(KEY, '{"v":1}');
    expect(storage.getItem(KEY)).toBe('{"v":1}'); // cache 立即可见
    expect(idbMock.set).not.toHaveBeenCalled(); // 尚未落盘

    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(idbMock.set).toHaveBeenCalledWith(KEY, '{"v":1}', expect.anything());
  });

  it('setItem 与 cache 相同时不重复落盘', async () => {
    idbMock.map.set(KEY, '{"v":1}');
    const mod = await loadModule();
    await mod.hydrateAiConversationStorage();
    idbMock.set.mockClear();
    const storage = mod.getAiConversationPersistStorage();

    storage.setItem(KEY, '{"v":1}'); // 与 cache 相同
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(idbMock.set).not.toHaveBeenCalled();
  });

  it('removeItem 清空 cache 并删除 idb 记录', async () => {
    idbMock.map.set(KEY, '{"v":1}');
    const mod = await loadModule();
    await mod.hydrateAiConversationStorage();
    const storage = mod.getAiConversationPersistStorage();

    storage.removeItem(KEY);
    expect(storage.getItem(KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(idbMock.del).toHaveBeenCalledWith(KEY, expect.anything());
  });

  it('hydrate 超时占位期的 setItem 不落盘,settle 后以用户新值落盘', async () => {
    let resolveGet: (value: string | undefined) => void = () => {};
    idbMock.get.mockImplementationOnce(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const mod = await loadModule();
    const storage = mod.getAiConversationPersistStorage();

    const hydratePromise = mod.hydrateAiConversationStorage();
    await vi.advanceTimersByTimeAsync(HYDRATE_TIMEOUT_WAIT_MS);
    expect(await hydratePromise).toBe('timeout');

    // 占位期写入:仅进 cache,不落盘
    storage.setItem(KEY, '{"fresh":true}');
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(idbMock.set).not.toHaveBeenCalled();

    // 磁盘历史此刻才返回 → 对账:用户新值权威,落盘
    resolveGet('{"history":true}');
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(idbMock.set).toHaveBeenCalledWith(KEY, '{"fresh":true}', expect.anything());
  });

  it('hydrate 超时且占位期无写入时,settle 后恢复磁盘历史且不落盘', async () => {
    let resolveGet: (value: string | undefined) => void = () => {};
    idbMock.get.mockImplementationOnce(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const mod = await loadModule();
    const storage = mod.getAiConversationPersistStorage();

    const hydratePromise = mod.hydrateAiConversationStorage();
    await vi.advanceTimersByTimeAsync(HYDRATE_TIMEOUT_WAIT_MS);
    expect(await hydratePromise).toBe('timeout');
    expect(storage.getItem(KEY)).toBeNull();

    resolveGet('{"history":true}');
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS);
    expect(storage.getItem(KEY)).toBe('{"history":true}');
    expect(idbMock.set).not.toHaveBeenCalled();
  });

  it('连续高频 setItem 不会被防抖无限推迟(maxWait 上限内必落盘一次)', async () => {
    const mod = await loadModule();
    await mod.hydrateAiConversationStorage();
    const storage = mod.getAiConversationPersistStorage();

    for (let i = 0; i < 10; i += 1) {
      storage.setItem(KEY, `{"v":${i}}`);
      await vi.advanceTimersByTimeAsync(200);
    }

    expect(idbMock.set).toHaveBeenCalled();
  });
});
