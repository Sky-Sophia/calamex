import type { StorageLike } from 'pinia-plugin-persistedstate';
import { loadSession, saveSession } from '@/services/sessionStore';
import { SessionSnapshotSchema, type TSessionSnapshot } from '@/types/session';
import { z } from 'zod';

const EDITOR_SESSION_KEY = 'shell-ide:editor';
const HYDRATE_TIMEOUT_MS = 300;
const SAVE_DEBOUNCE_MS = 500;

let cache: TSessionSnapshot | null = null;
let isReady = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const PersistedEditorStoreSchema = z.object({
  sessionSnapshot: SessionSnapshotSchema,
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
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
        resolve(null);
      });
  });

export const hydrateSessionStorage = async (): Promise<void> => {
  const loaded = await withTimeout(loadSession(), HYDRATE_TIMEOUT_MS);
  cache = loaded;
  isReady = true;
};

const schedulePersist = (value: TSessionSnapshot): void => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSession(value).catch((error) => {
      const payload = {
        timestamp: new Date().toISOString(),
        level: 'error',
        scope: 'session',
        event: 'snapshot-save-failed',
        detail: String(error),
      };
      console.error(JSON.stringify(payload));
    });
  }, SAVE_DEBOUNCE_MS);
};

export const tauriSessionStorage: StorageLike = {
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
    } catch {
      // 由上层 schema / 类型系统兜底，此处静默丢弃非法值
    }
  },

  removeItem(key) {
    if (key !== EDITOR_SESSION_KEY) {
      return;
    }
    cache = null;
  },
};
