import { Store } from '@tauri-apps/plugin-store';
import { AppError } from '@/types/app-error';
import { SessionSnapshotSchema, type TSessionSnapshot } from '@/types/session';

const SESSION_STORE_FILE = 'session.json';
const SESSION_SNAPSHOT_KEY = 'snapshot';
const SESSION_FALLBACK_STORAGE_KEY = 'shell-ide:session-snapshot';

let storePromise: Promise<Store> | null = null;

const getStore = (): Promise<Store> => (storePromise ??= Store.load(SESSION_STORE_FILE));

const createTraceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createSessionSaveError = (cause: unknown): AppError =>
  new AppError({
    code: 'SESSION_SAVE_FAILED',
    message: '保存会话快照失败。',
    scope: 'ipc',
    traceId: createTraceId(),
    cause,
  });

const logWarn = (event: string, extra?: unknown): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    scope: 'session',
    event,
    extra,
  };
  console.warn(JSON.stringify(payload));
};

const isFallbackStorageAvailable = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
};

const readFallbackSnapshot = (): TRawSnapshot | null => {
  if (!isFallbackStorageAvailable()) {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_FALLBACK_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (cause) {
    logWarn('snapshot-fallback-invalid-json', cause);
    return null;
  }
};

const writeFallbackSnapshot = (snapshot: TSessionSnapshot): void => {
  if (!isFallbackStorageAvailable()) {
    throw new Error('fallback storage unavailable');
  }

  window.localStorage.setItem(SESSION_FALLBACK_STORAGE_KEY, JSON.stringify(snapshot));
};

const clearFallbackSnapshot = (): void => {
  if (!isFallbackStorageAvailable()) {
    return;
  }

  window.localStorage.removeItem(SESSION_FALLBACK_STORAGE_KEY);
};

type TRawSnapshot = unknown;

/**
 * schemaVersion 迁移入口。
 * 当前仅支持 v1，后续版本按 from -> to 串行迁移；无路径返回 null 走降级。
 */
const migrate = (raw: TRawSnapshot): TRawSnapshot | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  switch (version) {
    case 1:
      return raw;
    default:
      logWarn('schema-no-migration-path', { from: version });
      return null;
  }
};

export const loadSession = async (): Promise<TSessionSnapshot | null> => {
  try {
    const raw = await (await getStore()).get(SESSION_SNAPSHOT_KEY);
    if (raw == null) {
      return null;
    }

    const migrated = migrate(raw);
    if (migrated == null) {
      return null;
    }

    const parsed = SessionSnapshotSchema.safeParse(migrated);
    if (!parsed.success) {
      logWarn('snapshot-invalid', parsed.error.issues);
      return null;
    }

    return parsed.data;
  } catch (cause) {
    logWarn('snapshot-read-failed', cause);
  }

  const fallbackRaw = readFallbackSnapshot();
  if (fallbackRaw == null) {
    return null;
  }

  const migrated = migrate(fallbackRaw);
  if (migrated == null) {
    return null;
  }

  const parsed = SessionSnapshotSchema.safeParse(migrated);
  if (!parsed.success) {
    logWarn('snapshot-fallback-invalid', parsed.error.issues);
    return null;
  }

  logWarn('snapshot-read-fallback-hit');
  return parsed.data;
};

export const saveSession = async (snapshot: TSessionSnapshot): Promise<void> => {
  let validated: TSessionSnapshot;
  try {
    validated = SessionSnapshotSchema.parse(snapshot);
  } catch (cause) {
    throw createSessionSaveError(cause);
  }

  let storeFailedCause: unknown = null;

  try {
    const store = await getStore();
    await store.set(SESSION_SNAPSHOT_KEY, validated);
    await store.save();
  } catch (cause) {
    storeFailedCause = cause;
    logWarn('snapshot-store-save-failed', cause);
  }

  try {
    writeFallbackSnapshot(validated);
    if (storeFailedCause) {
      logWarn('snapshot-save-via-fallback');
    }
    return;
  } catch (fallbackCause) {
    throw createSessionSaveError({
      store: storeFailedCause,
      fallback: fallbackCause,
    });
  }
};

export const clearSession = async (): Promise<void> => {
  try {
    const store = await getStore();
    await store.delete(SESSION_SNAPSHOT_KEY);
    await store.save();
  } catch (cause) {
    logWarn('snapshot-store-clear-failed', cause);
  }

  clearFallbackSnapshot();
};
