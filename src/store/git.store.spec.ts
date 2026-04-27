import type { IGitRepositoryStatusPayload } from '@/types/git';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from './git';

interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const tauriServiceMock = vi.hoisted(() => ({
  getGitRepositoryStatus: vi.fn(),
  initGitRepository: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
  tauriService: tauriServiceMock,
}));

const createStatus = (
  overrides: Partial<IGitRepositoryStatusPayload> = {},
): IGitRepositoryStatusPayload => ({
  available: true,
  message: null,
  repositoryRootPath: 'D:/repo',
  repositoryName: 'repo',
  gitDirPath: 'D:/repo/.git',
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
    message: '当前工作区未检测到 Git 仓库。',
    repositoryRootPath: null,
    repositoryName: null,
    gitDirPath: null,
    headBranchName: null,
    headShortName: null,
    isClean: true,
  });

const createDeferred = <T>(): IDeferred<T> => {
  let resolve: IDeferred<T>['resolve'] = () => {
    throw new Error('deferred resolve 尚未初始化');
  };
  let reject: IDeferred<T>['reject'] = () => {
    throw new Error('deferred reject 尚未初始化');
  };

  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

describe('useGitStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('初始化仓库结果不会被旧刷新请求覆盖回未初始化状态', async () => {
    const gitStore = useGitStore();
    const staleRefresh = createDeferred<IGitRepositoryStatusPayload>();
    const initializedStatus = createStatus();
    const unavailableStatus = createUnavailableStatus();

    tauriServiceMock.getGitRepositoryStatus.mockReturnValueOnce(staleRefresh.promise);
    tauriServiceMock.initGitRepository.mockResolvedValueOnce(initializedStatus);

    const refreshPromise = gitStore.refreshRepositoryStatus('D:/repo');
    await gitStore.initRepository('D:/repo');

    expect(gitStore.status.available).toBe(true);
    expect(gitStore.status.repositoryRootPath).toBe('D:/repo');

    staleRefresh.resolve(unavailableStatus);
    await refreshPromise;

    expect(gitStore.status.available).toBe(true);
    expect(gitStore.status.repositoryRootPath).toBe('D:/repo');
    expect(gitStore.isLoading).toBe(false);
  });

  it('初始化返回非当前工作区仓库时会报错且不写入状态', async () => {
    const gitStore = useGitStore();
    const parentRepositoryStatus = createStatus({
      repositoryRootPath: 'D:/parent',
      repositoryName: 'parent',
      gitDirPath: 'D:/parent/.git',
    });

    tauriServiceMock.initGitRepository.mockResolvedValueOnce(parentRepositoryStatus);

    await expect(gitStore.initRepository('D:/repo')).rejects.toThrow('Git 初始化目标不一致');
    expect(gitStore.status.available).toBe(false);
    expect(gitStore.status.repositoryRootPath).toBeNull();
    expect(gitStore.isLoading).toBe(false);
  });
});
