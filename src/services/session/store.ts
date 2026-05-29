import { Store } from '@tauri-apps/plugin-store';

import { AppError } from '@/types/app-error';
import { SessionSnapshotSchema, type TSessionSnapshot } from '@/types/session';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_STORE_FILE = 'session.json';
const SESSION_SNAPSHOT_KEY = 'snapshot';
const SESSION_FALLBACK_STORAGE_KEY = 'shell-ide:session-snapshot';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 持久化层读到的、尚未通过 schema 校验的原始值。 */
type TRawSnapshot = unknown;

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const createTraceId = (): string => {
  return crypto.randomUUID();
};

/**
 * 把任意 cause 转成人类可读字符串。
 *
 * Error 对象的 message / stack 不可枚举,直接 JSON.stringify(err) 得到 "{}",
 * 这里手动取 stack / message,保住调试信息。
 */
const stringifyCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.stack ?? `${cause.name}: ${cause.message}`;
  }
  if (typeof cause === 'object' && cause !== null) {
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }
  return String(cause);
};

const logWarn = (event: string, extra?: unknown): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level: 'warn',
    scope: 'session',
    event,
    extra: extra === undefined ? undefined : stringifyCause(extra),
  };
  console.warn(JSON.stringify(payload));
};

// ---------------------------------------------------------------------------
// Error factories
// ---------------------------------------------------------------------------

const createSessionValidationError = (cause: unknown): AppError =>
  new AppError({
    code: 'SESSION_VALIDATION_FAILED',
    message: '会话快照不符合 schema,已拒绝保存。',
    scope: 'ipc',
    traceId: createTraceId(),
    cause,
  });

const createSessionPersistError = (cause: unknown): AppError =>
  new AppError({
    code: 'SESSION_PERSIST_FAILED',
    message: '保存会话快照失败:主存储与降级存储均无法写入。',
    scope: 'ipc',
    traceId: createTraceId(),
    cause,
  });

// ---------------------------------------------------------------------------
// Store loader (with retry on rejected cache)
// ---------------------------------------------------------------------------

let storePromise: Promise<Store> | null = null;

/**
 * Tauri Store 单例 lazy loader。
 *
 * 关键设计:`Store.load` 失败时**清空 storePromise**,允许下次重试。
 * 旧实现用 `??=` 把 rejected promise 永久缓存,会导致主存储在启动期
 * 短暂失败 (Tauri runtime race / IPC 还没就绪) 后,整个进程生命周期
 * 都被迫降级到 localStorage,即使后端早已恢复。
 */
const getStore = (): Promise<Store> => {
  if (storePromise) {
    return storePromise;
  }
  storePromise = Store.load(SESSION_STORE_FILE).catch((error) => {
    storePromise = null;
    throw error;
  });
  return storePromise;
};

// ---------------------------------------------------------------------------
// Fallback storage (localStorage)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * schemaVersion 迁移入口。
 *
 * 当前仅支持 v1;后续版本按 from -> to 串行迁移。无匹配路径返回 null,
 * 调用方走降级或当作 "无快照" 处理。
 *
 * 添加新版本范式:
 *   case 1: return migrateV1ToV2(raw);
 *   case 2: return raw;
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

/** migrate + schema parse 的统一管线;校验失败返回 null 并打 warn。 */
const validateRawSnapshot = (raw: TRawSnapshot, invalidEvent: string): TSessionSnapshot | null => {
  const migrated = migrate(raw);
  if (migrated == null) {
    return null;
  }
  const parsed = SessionSnapshotSchema.safeParse(migrated);
  if (!parsed.success) {
    logWarn(invalidEvent, parsed.error.issues);
    return null;
  }
  return parsed.data;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 读取会话快照。
 *
 * 行为:
 * 1. 优先读主存储 (Tauri Store);成功且非空 → 直接返回。
 * 2. 主存储 IO **抛错** → 回退到 localStorage fallback。
 * 3. 主存储**显式为空** (key 不存在) → 不读 fallback,直接返回 null。
 *
 * 第 3 条是关键设计:clearSession 之后 fallback 也已清空,但如果用户
 * 手动改了 localStorage 或某次 clear 没清干净,允许 "主为空回查 fallback"
 * 就会把已删除的会话从 fallback 复活回来。所以主权威说没有就是没有。
 */
export const loadSession = async (): Promise<TSessionSnapshot | null> => {
  try {
    const raw = await (await getStore()).get(SESSION_SNAPSHOT_KEY);
    if (raw == null) {
      return null;
    }
    return validateRawSnapshot(raw, 'snapshot-invalid');
  } catch (cause) {
    logWarn('snapshot-read-failed', cause);
  }

  const fallbackRaw = readFallbackSnapshot();
  if (fallbackRaw == null) {
    return null;
  }
  const result = validateRawSnapshot(fallbackRaw, 'snapshot-fallback-invalid');
  if (result != null) {
    logWarn('snapshot-read-fallback-hit');
  }
  return result;
};

/**
 * 保存会话快照。
 *
 * 行为:
 * 1. 按 schema 校验输入,失败抛 `SESSION_VALIDATION_FAILED` (调用方 Bug)。
 * 2. 写主存储 (Tauri Store)。
 * 3. 镜像写 fallback (localStorage),作为主存储未来损坏时的应急副本。
 *
 * 关键修复:**主存储成功而 fallback 镜像写失败时,只警告,不抛错**。
 * 主存储是权威——既然权威已经写入,就不能让上游误以为 "保存失败"。
 * 仅当主与 fallback **都**失败时才抛 `SESSION_PERSIST_FAILED`。
 */
export const saveSession = async (snapshot: TSessionSnapshot): Promise<void> => {
  let validated: TSessionSnapshot;
  try {
    validated = SessionSnapshotSchema.parse(snapshot);
  } catch (cause) {
    throw createSessionValidationError(cause);
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

  if (storeFailedCause == null) {
    // 主存储已是权威。fallback 仅是镜像,失败只警告,不向上抛。
    try {
      writeFallbackSnapshot(validated);
    } catch (fallbackCause) {
      logWarn('snapshot-fallback-mirror-failed', fallbackCause);
    }
    return;
  }

  // 主存储失败 → fallback 是最后一道防线;再失败就真的没救了。
  try {
    writeFallbackSnapshot(validated);
    logWarn('snapshot-save-via-fallback');
  } catch (fallbackCause) {
    throw createSessionPersistError({
      store: stringifyCause(storeFailedCause),
      fallback: stringifyCause(fallbackCause),
    });
  }
};

/** 清除会话快照 (主 + fallback)。fire-and-forget 语义,主存储失败仅警告。 */
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
