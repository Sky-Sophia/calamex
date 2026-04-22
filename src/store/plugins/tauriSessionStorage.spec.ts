import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadSession = vi.fn();
const mockSaveSession = vi.fn();

vi.mock('@/services/sessionStore', () => ({
  loadSession: mockLoadSession,
  saveSession: mockSaveSession,
}));

describe('tauriSessionStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrateSessionStorage 超时后不抛异常，getItem 返回 null', async () => {
    vi.useFakeTimers();
    mockLoadSession.mockReturnValue(new Promise(() => undefined));

    const { hydrateSessionStorage, tauriSessionStorage } = await import(
      '@/store/plugins/tauriSessionStorage'
    );

    const task = hydrateSessionStorage();
    await vi.advanceTimersByTimeAsync(301);
    await task;

    expect(tauriSessionStorage.getItem('shell-ide:editor')).toBeNull();
  });

  it('hydrate 后 getItem 返回缓存快照', async () => {
    mockLoadSession.mockResolvedValue({
      schemaVersion: 1,
      workspaceRoot: '/tmp/workspace',
      openTabs: [],
      activeTabPath: null,
      viewStates: [],
      recentWorkspaces: [],
      recentFiles: [],
      savedAt: new Date().toISOString(),
    });

    const { hydrateSessionStorage, tauriSessionStorage } = await import(
      '@/store/plugins/tauriSessionStorage'
    );

    await hydrateSessionStorage();
    const raw = tauriSessionStorage.getItem('shell-ide:editor');

    expect(raw).not.toBeNull();
    expect(typeof raw).toBe('string');
  });
});
