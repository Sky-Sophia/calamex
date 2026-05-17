import type { StorageLike } from 'pinia-plugin-persistedstate';
import { z } from 'zod';

import { clearSession, loadSession, saveSession } from '@/services/sessionStore';
import { SessionSnapshotSchema, type TSessionSnapshot } from '@/types/session';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const EDITOR_SESSION_KEY = 'shell-ide:editor';
const HYDRATE_TIMEOUT_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

/**
 * Tauri 后端会话存储适配器,作为 pinia-plugin-persistedstate 的
 * StorageLike 实现。
 *
 * 在 plugin 契约之外额外暴露 removeItem,供业务层 (登出 / 切换工作区 /
 * 测试 reset) 主动清理持久化快照。**plugin 自身不会调用 removeItem。**
 */
export interface ITauriSessionStorage extends StorageLike {
  removeItem(key: string): void;
}

/** 加载状态,便于调用方区分 "用户无快照" 与 "IO 超时被迫放弃"。 */
export type THydrateStatus = 'loaded' | 'empty' | 'timeout';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let cache: TSessionSnapshot | null = null;
let isReady = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

const PersistedEditorStoreSchema = z.object({
  sessionSnapshot: SessionSnapshotSchema,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promise.race 风格的超时;超时返回 sentinel,不抛错。 */
const TIMEOUT_SENTINEL: unique symbol = Symbol('hydrate-timeout');

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT_SENTINEL> =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(TIMEOUT_SENTINEL);
    }, timeoutMs);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(TIMEOUT_SENTINEL);
      });
  });

const stringifyError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
};

const logSessionPersistError = (event: string, error: unknown): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'error',
    scope: 'session',
    event,
    detail: stringifyError(error),
  };
  console.error(JSON.stringify(payload));
};

const logSessionPersistWarn = (event: string, detail: string): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    scope: 'session',
    event,
    detail,
  };
  console.warn(JSON.stringify(payload));
};

const enqueuePersistOperation = (
  operation: () => Promise<void>,
  errorEvent: string,
): void => {
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(operation)
    .catch((error) => {
      logSessionPersistError(errorEvent, error);
    });
};

const clearSaveTimer = (): void => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
};

const schedulePersist = (value: TSessionSnapshot): void => {
  clearSaveTimer();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    enqueuePersistOperation(() => saveSession(value), 'snapshot-save-failed');
  }, SAVE_DEBOUNCE_MS);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 异步初始化:从 Tauri 后端加载快照到 cache,然后置 isReady。
 * 必须在 Pinia 读 getItem 之前 await 完成,否则前 300ms 内的读会
 * 拿到 null (Pinia 退化到 store 初始值)。
 *
 * 返回值用于调用方上报 / debug:
 * - 'loaded':成功拿到非空快照
 * - 'empty':成功但无快照 (首次启动)
 * - 'timeout':IO 在 HYDRATE_TIMEOUT_MS 内未返回,被迫以空态启动
 */
export const hydrateSessionStorage = async (): Promise<THydrateStatus> => {
  const result = await withTimeout(loadSession(), HYDRATE_TIMEOUT_MS);
  isReady = true;
  if (result === TIMEOUT_SENTINEL) {
    cache = null;
    logSessionPersistWarn(
      'snapshot-hydrate-timeout',
      `loadSession did not resolve within ${HYDRATE_TIMEOUT_MS}ms; starting with empty cache`,
    );
    return 'timeout';
  }
  cache = result;
  return result == null ? 'empty' : 'loaded';
};

export const tauriSessionStorage: ITauriSessionStorage = {
  getItem(key) {
    if (!isReady || key !== EDITOR_SESSION_KEY || cache == null) {
      return null;
    }
    return JSON.stringify({
      sessionSnapshot: cache,
    });
  },

  setItem(key, value) {
    if (key !== EDITOR_SESSION_KEY) {
      return;
    }
    try {
      const payload = PersistedEditorStoreSchema.parse(JSON.parse(value));
      cache = payload.sessionSnapshot;
      schedulePersist(payload.sessionSnapshot);
    } catch (error) {
      // schema 校验失败:既不写盘也不更新 cache。这是安全选择
      // (避免写入坏数据),但用户感知是 "改的东西没存"——必须留痕。
      logSessionPersistWarn(
        'snapshot-validation-failed',
        `dropped invalid setItem payload: ${stringifyError(error)}`,
      );
    }
  },

  removeItem(key) {
    if (key !== EDITOR_SESSION_KEY) {
      return;
    }
    clearSaveTimer();
    cache = null;
    enqueuePersistOperation(clearSession, 'snapshot-clear-failed');
  },
};