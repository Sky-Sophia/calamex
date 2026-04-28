import { tauriService } from '@/services/tauri';
import type {
  IGitCommitResultPayload,
  IGitFileBaselinePayload,
  IGitRepositoryStatusPayload,
} from '@/types/git';
import { areFileSystemPathsEqual, normalizeFileSystemPath } from '@/utils/path';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

const MSG_GIT_INIT_NO_REPOSITORY = 'Git 初始化后仍未检测到仓库。';
const MSG_GIT_NO_REPOSITORY_IN_WORKSPACE = '当前工作区未检测到 Git 仓库。';
const formatGitInitMismatch = (expectedPath: string, actualPath: string): string =>
  `Git 初始化目标不一致：期望 ${expectedPath}，实际 ${actualPath}。`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const createEmptyGitRepositoryStatus = (): IGitRepositoryStatusPayload => ({
  available: false,
  message: null,
  repositoryRootPath: null,
  repositoryName: null,
  gitDirPath: null,
  headBranchName: null,
  headShortName: null,
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
});

const deduplicatePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const key = normalizeFileSystemPath(path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type TStatusFetcher = (
  workspaceRootPath: string,
) => Promise<IGitRepositoryStatusPayload>;

type TPathsMutationRequest = {
  repositoryRootPath: string;
  paths: string[];
};

type TPathsMutator = (
  request: TPathsMutationRequest,
) => Promise<IGitRepositoryStatusPayload>;

export const useGitStore = defineStore('git', () => {
  // -- state -----------------------------------------------------------------

  const status = ref<IGitRepositoryStatusPayload>(createEmptyGitRepositoryStatus());
  const isLoading = ref(false);
  const baselineCache = ref<Record<string, IGitFileBaselinePayload>>({});
  const baselineEpoch = ref(0);

  // monotonically increasing id for status fetches; used to discard stale results.
  let statusRequestId = 0;

  // de-duplicates concurrent in-flight baseline fetches keyed by normalized path.
  const pendingBaselineRequests = new Map<
    string,
    Promise<IGitFileBaselinePayload>
  >();

  // -- getters ---------------------------------------------------------------

  const hasRepository = computed(
    () => status.value.available && Boolean(status.value.repositoryRootPath),
  );

  const totalChangeCount = computed(
    () =>
      status.value.stagedCount +
      status.value.unstagedCount +
      status.value.untrackedCount +
      status.value.conflictedCount,
  );

  // -- baseline cache --------------------------------------------------------

  const clearBaselineCache = (): void => {
    baselineCache.value = {};
    baselineEpoch.value += 1;
  };

  const invalidateFileBaseline = (path?: string | null): void => {
    const cacheKey = normalizeFileSystemPath(path);
    if (!cacheKey) return;
    if (!(cacheKey in baselineCache.value)) return;

    const nextCache = { ...baselineCache.value };
    delete nextCache[cacheKey];
    baselineCache.value = nextCache;
    baselineEpoch.value += 1;
  };

  const getFileBaseline = async (
    path: string,
  ): Promise<IGitFileBaselinePayload> => {
    const cacheKey = normalizeFileSystemPath(path);

    const cached = baselineCache.value[cacheKey];
    if (cached) return cached;

    const pending = pendingBaselineRequests.get(cacheKey);
    if (pending) return pending;

    const epochAtRequest = baselineEpoch.value;
    const request = tauriService
      .getGitFileBaseline(path)
      .then((payload) => {
        if (epochAtRequest === baselineEpoch.value) {
          baselineCache.value = {
            ...baselineCache.value,
            [cacheKey]: payload,
          };
        }
        return payload;
      })
      .finally(() => {
        pendingBaselineRequests.delete(cacheKey);
      });

    pendingBaselineRequests.set(cacheKey, request);
    return request;
  };

  // -- status mutators -------------------------------------------------------

  const reset = (): void => {
    statusRequestId += 1;
    isLoading.value = false;
    status.value = createEmptyGitRepositoryStatus();
    clearBaselineCache();
  };

  const applyStatus = (
    payload: IGitRepositoryStatusPayload,
  ): IGitRepositoryStatusPayload => {
    const previousRepositoryRoot = normalizeFileSystemPath(
      status.value.repositoryRootPath,
    );
    const nextRepositoryRoot = normalizeFileSystemPath(payload.repositoryRootPath);

    status.value = payload;

    if (previousRepositoryRoot !== nextRepositoryRoot || !payload.available) {
      clearBaselineCache();
    }
    return payload;
  };

  const assertInitializedRepositoryStatus = (
    payload: IGitRepositoryStatusPayload,
    workspaceRootPath: string,
  ): void => {
    if (!payload.available || !payload.repositoryRootPath) {
      throw new Error(payload.message ?? MSG_GIT_INIT_NO_REPOSITORY);
    }
    if (!areFileSystemPathsEqual(payload.repositoryRootPath, workspaceRootPath)) {
      throw new Error(
        formatGitInitMismatch(workspaceRootPath, payload.repositoryRootPath),
      );
    }
  };

  /**
   * 共享骨架：刷新或初始化仓库状态时的请求竞争控制 + isLoading 切换 + 落盘。
   * `validatePayload` 在 staleness 检查通过、`applyStatus` 之前对 payload 做断言。
   */
  const runStatusRequest = async (
    workspaceRootPath: string | null | undefined,
    fetchPayload: TStatusFetcher,
    validatePayload?: (
      payload: IGitRepositoryStatusPayload,
      workspaceRootPath: string,
    ) => void,
  ): Promise<IGitRepositoryStatusPayload> => {
    if (!workspaceRootPath) {
      reset();
      return status.value;
    }

    const requestId = statusRequestId + 1;
    statusRequestId = requestId;
    isLoading.value = true;

    try {
      const payload = await fetchPayload(workspaceRootPath);
      if (requestId !== statusRequestId) {
        return status.value;
      }
      validatePayload?.(payload, workspaceRootPath);
      return applyStatus(payload);
    } finally {
      if (requestId === statusRequestId) {
        isLoading.value = false;
      }
    }
  };

  const refreshRepositoryStatus = (
    workspaceRootPath?: string | null,
  ): Promise<IGitRepositoryStatusPayload> =>
    runStatusRequest(workspaceRootPath, (path) =>
      tauriService.getGitRepositoryStatus(path),
    );

  const initRepository = (
    workspaceRootPath?: string | null,
  ): Promise<IGitRepositoryStatusPayload> =>
    runStatusRequest(
      workspaceRootPath,
      (path) => tauriService.initGitRepository(path),
      assertInitializedRepositoryStatus,
    );

  // -- index / paths mutations ----------------------------------------------

  const requireRepositoryRootPath = (): string => {
    const repositoryRootPath = status.value.repositoryRootPath;
    if (!repositoryRootPath) {
      throw new Error(MSG_GIT_NO_REPOSITORY_IN_WORKSPACE);
    }
    return repositoryRootPath;
  };

  /**
   * 共享骨架：stage / unstage / discard 一类的"按路径列表改写工作区"操作。
   * `onSuccess` 在 `applyStatus` 之前用去重后的路径执行副作用（例如基准缓存失效）。
   */
  const runPathsMutation = async (
    paths: string[],
    mutate: TPathsMutator,
    onSuccess?: (deduplicatedPaths: string[]) => void,
  ): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await mutate({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });

    onSuccess?.(deduplicatedPaths);
    return applyStatus(payload);
  };

  const stagePaths = (paths: string[]): Promise<IGitRepositoryStatusPayload> =>
    runPathsMutation(paths, (request) => tauriService.stageGitPaths(request));

  const unstagePaths = (paths: string[]): Promise<IGitRepositoryStatusPayload> =>
    runPathsMutation(paths, (request) => tauriService.unstageGitPaths(request));

  const discardPaths = (paths: string[]): Promise<IGitRepositoryStatusPayload> =>
    runPathsMutation(
      paths,
      (request) => tauriService.discardGitPaths(request),
      (deduplicatedPaths) => deduplicatedPaths.forEach(invalidateFileBaseline),
    );

  const commitIndex = async (
    message: string,
  ): Promise<IGitCommitResultPayload> => {
    const payload = await tauriService.commitGitIndex({
      repositoryRootPath: requireRepositoryRootPath(),
      message,
    });
    applyStatus(payload.status);
    clearBaselineCache();
    return payload;
  };

  return {
    status,
    isLoading,
    hasRepository,
    totalChangeCount,
    baselineEpoch,
    refreshRepositoryStatus,
    initRepository,
    getFileBaseline,
    invalidateFileBaseline,
    clearBaselineCache,
    stagePaths,
    unstagePaths,
    discardPaths,
    commitIndex,
    reset,
  };
});