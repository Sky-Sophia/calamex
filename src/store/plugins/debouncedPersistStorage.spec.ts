import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDebouncedPersistStorage, type IPersistStorageLike } from './debouncedPersistStorage';

const createMemoryStorage = () => {
  const map = new Map<string, string>();
  const base: IPersistStorageLike = {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
  };
  return { base, map };
};

describe('createDebouncedPersistStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('在防抖窗口内合并多次写入，仅落盘最后一次', () => {
    const { base, map } = createMemoryStorage();
    const debounced = createDebouncedPersistStorage(base, 300);

    debounced.storage.setItem('k', 'v1');
    debounced.storage.setItem('k', 'v2');
    debounced.storage.setItem('k', 'v3');

    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenLastCalledWith('k', 'v3');
    expect(map.get('k')).toBe('v3');
  });

  it('getItem 优先返回尚未落盘的最新值', () => {
    const { base } = createMemoryStorage();
    const debounced = createDebouncedPersistStorage(base, 300);

    debounced.storage.setItem('k', 'pending');

    expect(debounced.storage.getItem('k')).toBe('pending');
    expect(base.getItem).not.toHaveBeenCalled();
  });

  it('getItem 在无挂起写入时回退到底层 storage', () => {
    const { base, map } = createMemoryStorage();
    map.set('k', 'persisted');
    const debounced = createDebouncedPersistStorage(base, 300);

    expect(debounced.storage.getItem('k')).toBe('persisted');
    expect(base.getItem).toHaveBeenCalledWith('k');
  });

  it('flush 立即落盘全部挂起写入并清空定时器', () => {
    const { base, map } = createMemoryStorage();
    const debounced = createDebouncedPersistStorage(base, 300);

    debounced.storage.setItem('a', '1');
    debounced.storage.setItem('b', '2');
    debounced.flush();

    expect(map.get('a')).toBe('1');
    expect(map.get('b')).toBe('2');
    expect(base.setItem).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(2);
  });

  it('removeItem 同时清除挂起写入与底层值', () => {
    const { base, map } = createMemoryStorage();
    map.set('k', 'persisted');
    const debounced = createDebouncedPersistStorage(base, 300);

    debounced.storage.setItem('k', 'pending');
    debounced.storage.removeItem?.('k');
    vi.advanceTimersByTime(300);

    expect(base.removeItem).toHaveBeenCalledWith('k');
    expect(map.has('k')).toBe(false);
    expect(base.setItem).not.toHaveBeenCalled();
  });

  it('cancel 丢弃挂起定时器且不落盘', () => {
    const { base } = createMemoryStorage();
    const debounced = createDebouncedPersistStorage(base, 300);

    debounced.storage.setItem('k', 'v');
    debounced.cancel();
    vi.advanceTimersByTime(300);

    expect(base.setItem).not.toHaveBeenCalled();
  });
});
