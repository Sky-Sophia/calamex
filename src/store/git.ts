import { tauriService } from '@/services/tauri';
import type {
  IGitCommitResultPayload,
  IGitFileBaselinePayload,
  IGitRepositoryStatusPayload,
} from '@/types/git';
import { areFileSystemPathsEqual, normalizeFileSystemPath } from '@/utils/path';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

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
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(path);
  }

  return result;
};

export const useGitStore = defineStore('git', () => {
  const status = ref<IGitRepositoryStatusPayload>(createEmptyGitRepositoryStatus());
  const isLoading = ref(false);
  const baselineCache = ref<Record<string, IGitFileBaselinePayload>>({});
  const baselineEpoch = ref(0);

  let statusRequestId = 0;
  const pendingBaselineRequests = new Map<string, Promise<IGitFileBaselinePayload>>();

  const hasRepository = computed(() => status.value.available && Boolean(status.value.repositoryRootPath));
  const totalChangeCount = computed(
    () =>
      status.value.stagedCount +
      status.value.unstagedCount +
      status.value.untrackedCount +
      status.value.conflictedCount,
  );

  const clearBaselineCache = (): void => {
    baselineCache.value = {};
    baselineEpoch.value += 1;
  };

  const reset = (): void => {
    statusRequestId += 1;
    isLoading.value = false;
    status.value = createEmptyGitRepositoryStatus();
    clearBaselineCache();
  };

  const applyStatus = (payload: IGitRepositoryStatusPayload): IGitRepositoryStatusPayload => {
    const previousRepositoryRoot = normalizeFileSystemPath(status.value.repositoryRootPath);
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
      throw new Error(payload.message ?? 'Git 初始化后仍未检测到仓库。');
    }

    if (!areFileSystemPathsEqual(payload.repositoryRootPath, workspaceRootPath)) {
      throw new Error(
        `Git 初始化目标不一致：期望 ${workspaceRootPath}，实际 ${payload.repositoryRootPath}。`,
      );
    }
  };

  const refreshRepositoryStatus = async (
    workspaceRootPath?: string | null,
  ): Promise<IGitRepositoryStatusPayload> => {
    if (!workspaceRootPath) {
      reset();
      return status.value;
    }

    const requestId = statusRequestId + 1;
    statusRequestId = requestId;
    isLoading.value = true;

    try {
      const payload = await tauriService.getGitRepositoryStatus(workspaceRootPath);
      if (requestId !== statusRequestId) {
        return status.value;
      }

      return applyStatus(payload);
    } finally {
      if (requestId === statusRequestId) {
        isLoading.value = false;
      }
    }
  };

  const initRepository = async (
    workspaceRootPath?: string | null,
  ): Promise<IGitRepositoryStatusPayload> => {
    if (!workspaceRootPath) {
      reset();
      return status.value;
    }

    const requestId = statusRequestId + 1;
    statusRequestId = requestId;
    isLoading.value = true;

    try {
      const payload = await tauriService.initGitRepository(workspaceRootPath);
      if (requestId !== statusRequestId) {
        return status.value;
      }

      assertInitializedRepositoryStatus(payload, workspaceRootPath);
      return applyStatus(payload);
    } finally {
      if (requestId === statusRequestId) {
        isLoading.value = false;
      }
    }
  };

  const getFileBaseline = async (path: string): Promise<IGitFileBaselinePayload> => {
    const cacheKey = normalizeFileSystemPath(path);
    const cached = baselineCache.value[cacheKey];
    if (cached) {
      return cached;
    }

    const pending = pendingBaselineRequests.get(cacheKey);
    if (pending) {
      return pending;
    }

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

  const invalidateFileBaseline = (path?: string | null): void => {
    const cacheKey = normalizeFileSystemPath(path);
    if (!cacheKey) {
      return;
    }

    if (!(cacheKey in baselineCache.value)) {
      return;
    }

    const nextCache = { ...baselineCache.value };
    delete nextCache[cacheKey];
    baselineCache.value = nextCache;
    baselineEpoch.value += 1;
  };

  const requireRepositoryRootPath = (): string => {
    const repositoryRootPath = status.value.repositoryRootPath;
    if (!repositoryRootPath) {
      throw new Error('当前工作区未检测到 Git 仓库。');
    }

    return repositoryRootPath;
  };

  const stagePaths = async (paths: string[]): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await tauriService.stageGitPaths({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });
    return applyStatus(payload);
  };

  const unstagePaths = async (paths: string[]): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await tauriService.unstageGitPaths({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });
    return applyStatus(payload);
  };

  const discardPaths = async (paths: string[]): Promise<IGitRepositoryStatusPayload> => {
    const deduplicatedPaths = deduplicatePaths(paths);
    if (deduplicatedPaths.length === 0) {
      return status.value;
    }

    const payload = await tauriService.discardGitPaths({
      repositoryRootPath: requireRepositoryRootPath(),
      paths: deduplicatedPaths,
    });
    deduplicatedPaths.forEach(invalidateFileBaseline);
    return applyStatus(payload);
  };

  const commitIndex = async (message: string): Promise<IGitCommitResultPayload> => {
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
