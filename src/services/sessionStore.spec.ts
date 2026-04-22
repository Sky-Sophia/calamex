import { AppError } from '@/types/app-error';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(async () => mockStore),
  },
}));

describe('sessionStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadSession 文件不存在时返回 null', async () => {
    mockStore.get.mockResolvedValueOnce(null);
    const { loadSession } = await import('@/services/sessionStore');

    const result = await loadSession();

    expect(result).toBeNull();
  });

  it('loadSession schema 校验失败时返回 null 并记录 warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockStore.get.mockResolvedValueOnce({
      schemaVersion: 999,
      workspaceRoot: null,
      openTabs: [],
      activeTabPath: null,
      viewStates: [],
      recentWorkspaces: [],
      recentFiles: [],
      savedAt: new Date().toISOString(),
    });

    const { loadSession } = await import('@/services/sessionStore');
    const result = await loadSession();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('saveSession 入参非法时抛出 AppError(SESSION_SAVE_FAILED)', async () => {
    const { saveSession } = await import('@/services/sessionStore');

    await expect(saveSession({} as never)).rejects.toMatchObject<AppError>({
      code: 'SESSION_SAVE_FAILED',
      scope: 'ipc',
    });
  });

  it('schemaVersion 不匹配时返回 null 且不抛异常', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockStore.get.mockResolvedValueOnce({ schemaVersion: 2 });

    const { loadSession } = await import('@/services/sessionStore');

    await expect(loadSession()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
