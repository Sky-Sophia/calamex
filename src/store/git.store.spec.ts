import type { IGitRepositoryStatusPayload } from '@/types/git';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGitStore } from './git';

// ---------------------------------------------------------------------------
// Test fixtures & helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = 'D:/repo';
const PARENT_WORKSPACE_ROOT = 'D:/parent';

const MSG_REPO_UNAVAILABLE = '当前工作区未检测到 Git 仓库。';
const MSG_INIT_MISMATCH = 'Git 初始化目标不一致';

interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = <T>(): IDeferred<T> => {
  // Promise executor 是同步执行的，下面两个 ! 在 Promise 构造完成前就会被赋值。
  let resolve!: IDeferred<T>['resolve'];
  let reject!: IDeferred<T>['reject'];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const createStatus = (
  overrides: Partial<IGitRepositoryStatusPayload> = {},
): IGitRepositoryStatusPayload => ({
  available: true,
  message: null,
  repositoryRootPath: WORKSPACE_ROOT,
  repositoryName: 'repo',
  gitDirPath: `${WORKSPACE_ROOT}/.git`,
  headBranchName: 'main',
  headShortName: 'main',
  headShortOid: null,
  isDetached: false,
  isClean: true,
  ahead: 0,
  behind: 0,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictedCount: 0,
  files: [],
  lastCommit: null,
  ...overrides,
});

const createUnavailableStatus = (): IGitRepositoryStatusPayload =>
  createStatus({
    available: false,
    message: MSG_REPO_UNAVAILABLE,
    repositoryRootPath: null,
    repositoryName: null,
    gitDirPath: null,
    headBranchName: null,
    headShortName: null,
  });

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const tauriServiceMock = vi.hoisted(() => ({
  getGitRepositoryStatus: vi.fn(),
  initGitRepository: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
  tauriService: tauriServiceMock,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGitStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('初始化仓库结果不会被旧刷新请求覆盖回未初始化状态', async () => {
    const gitStore = useGitStore();

    // 1) 先发一个永远悬挂的 refresh，让它的 statusRequestId 抢先占位但不解析。
    const staleRefresh = createDeferred<IGitRepositoryStatusPayload>();
    tauriServiceMock.getGitRepositoryStatus.mockReturnValueOnce(staleRefresh.promise);

    // 2) 紧跟一个 init,它会把 statusRequestId 推到下一个值并立刻完成。
    const initializedStatus = createStatus();
    tauriServiceMock.initGitRepository.mockResolvedValueOnce(initializedStatus);

    const refreshPromise = gitStore.refreshRepositoryStatus(WORKSPACE_ROOT);
    await gitStore.initRepository(WORKSPACE_ROOT);

    // init 已经成功落盘。
    expect(gitStore.status.available).toBe(true);
    expect(gitStore.status.repositoryRootPath).toBe(WORKSPACE_ROOT);

    // 3) 现在让陈旧的 refresh 拿到一份 unavailable 结果——它必须被 staleness 检查丢弃。
    staleRefresh.resolve(createUnavailableStatus());
    await refreshPromise;

    expect(gitStore.status.available).toBe(true);
    expect(gitStore.status.repositoryRootPath).toBe(WORKSPACE_ROOT);
    expect(gitStore.isLoading).toBe(false);
  });

  it('初始化返回非当前工作区仓库时会报错且不写入状态', async () => {
    const gitStore = useGitStore();

    // 故意让 init 返回一个父目录仓库的状态，模拟 git init 命中了上层已存在的 .git。
    const parentRepositoryStatus = createStatus({
      repositoryRootPath: PARENT_WORKSPACE_ROOT,
      repositoryName: 'parent',
      gitDirPath: `${PARENT_WORKSPACE_ROOT}/.git`,
    });
    tauriServiceMock.initGitRepository.mockResolvedValueOnce(parentRepositoryStatus);

    await expect(gitStore.initRepository(WORKSPACE_ROOT)).rejects.toThrow(
      MSG_INIT_MISMATCH,
    );

    // 抛错走 finally → isLoading 复位；但 applyStatus 没有被调用，状态保持默认空。
    expect(gitStore.status.available).toBe(false);
    expect(gitStore.status.repositoryRootPath).toBeNull();
    expect(gitStore.isLoading).toBe(false);
  });
});