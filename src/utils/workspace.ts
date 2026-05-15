import type { IWorkspaceDirectoryPayload, IWorkspaceEntry } from '@/types/editor';
import { normalizeFileSystemPath } from '@/utils/path';

export type TWorkspaceChildrenMap = Record<string, IWorkspaceEntry[]>;
export type TListWorkspaceEntries = (
  path?: string,
  rootPath?: string,
) => Promise<IWorkspaceDirectoryPayload>;

interface IWorkspaceTraversalOptions {
  shouldContinue?: () => boolean;
}

const EMPTY_WORKSPACE_KEY = '__empty_workspace__';

const normalizeWorkspaceQuery = (query: string): string => query.trim().toLowerCase();
const isWorkspaceDirectoryEntry = (entry: IWorkspaceEntry): boolean => entry.kind === 'directory';
const isWorkspaceFileEntry = (entry: IWorkspaceEntry): boolean => entry.kind === 'file';

export const resolveWorkspaceKey = (workspaceRootPath: string | null): string =>
  workspaceRootPath ?? EMPTY_WORKSPACE_KEY;

const resolvePreloadedWorkspaceRoot = (
  workspaceRootPath: string | null,
  preloadedWorkspaceRoot: IWorkspaceDirectoryPayload | null,
): IWorkspaceDirectoryPayload | null => {
  if (!workspaceRootPath || !preloadedWorkspaceRoot) {
    return null;
  }

  return preloadedWorkspaceRoot.rootPath === workspaceRootPath ? preloadedWorkspaceRoot : null;
};

export const resolveWorkspaceRootPayload = async (
  workspaceRootPath: string,
  preloadedWorkspaceRoot: IWorkspaceDirectoryPayload | null,
  listWorkspaceEntries: TListWorkspaceEntries,
): Promise<IWorkspaceDirectoryPayload> => {
  const matchedPreloadedRoot = resolvePreloadedWorkspaceRoot(
    workspaceRootPath,
    preloadedWorkspaceRoot,
  );
  if (matchedPreloadedRoot) {
    return matchedPreloadedRoot;
  }

  return listWorkspaceEntries(undefined, workspaceRootPath);
};

const createWorkspaceDirectoryPayload = (
  rootPath: string,
  rootName: string,
  entries: IWorkspaceEntry[] = [],
): IWorkspaceDirectoryPayload => ({
  rootPath,
  rootName,
  entries,
});

export const isWorkspaceRootAccessible = async (
  workspaceRootPath: string,
  listWorkspaceEntries: TListWorkspaceEntries,
): Promise<boolean> => {
  try {
    await listWorkspaceEntries(undefined, workspaceRootPath);
    return true;
  } catch {
    return false;
  }
};

export const loadWorkspaceRootPayloadOrEmpty = async (
  workspaceRootPath: string,
  workspaceRootName: string,
  listWorkspaceEntries: TListWorkspaceEntries,
): Promise<IWorkspaceDirectoryPayload> => {
  try {
    return await listWorkspaceEntries(undefined, workspaceRootPath);
  } catch {
    return createWorkspaceDirectoryPayload(workspaceRootPath, workspaceRootName);
  }
};

export const collectWorkspaceFileEntries = async (
  rootPayload: IWorkspaceDirectoryPayload,
  listWorkspaceEntries: TListWorkspaceEntries,
  options: IWorkspaceTraversalOptions = {},
): Promise<IWorkspaceEntry[]> => {
  const files = rootPayload.entries.filter(isWorkspaceFileEntry);
  const pendingDirectories = rootPayload.entries.filter(isWorkspaceDirectoryEntry);
  const visitedDirectories = new Set<string>();
  const shouldContinue = options.shouldContinue ?? (() => true);

  while (pendingDirectories.length > 0) {
    if (!shouldContinue()) {
      return files;
    }

    const directoryEntry = pendingDirectories.shift();
    if (!directoryEntry || visitedDirectories.has(directoryEntry.path)) {
      continue;
    }

    visitedDirectories.add(directoryEntry.path);
    const directoryPayload = await listWorkspaceEntries(directoryEntry.path, rootPayload.rootPath);

    if (!shouldContinue()) {
      return files;
    }

    directoryPayload.entries.forEach((entry) => {
      if (isWorkspaceDirectoryEntry(entry)) {
        pendingDirectories.push(entry);
        return;
      }

      files.push(entry);
    });
  }

  return files;
};

export const countLoadedWorkspaceEntries = (childrenMap: TWorkspaceChildrenMap): number =>
  Object.values(childrenMap).reduce((total, entries) => total + entries.length, 0);

const workspaceEntryMatchesSearch = (entry: IWorkspaceEntry, query: string): boolean => {
  const normalizedQuery = normalizeWorkspaceQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return (
    entry.name.toLowerCase().includes(normalizedQuery) ||
    normalizeFileSystemPath(entry.path).toLowerCase().includes(normalizedQuery)
  );
};

const workspaceEntryMatchesTree = (
  entry: IWorkspaceEntry,
  query: string,
  childrenMap: TWorkspaceChildrenMap,
): boolean => {
  const normalizedQuery = normalizeWorkspaceQuery(query);
  if (!normalizedQuery || workspaceEntryMatchesSearch(entry, normalizedQuery)) {
    return true;
  }

  if (entry.kind !== 'directory') {
    return false;
  }

  const descendants = childrenMap[entry.path] ?? [];
  return descendants.some((child) =>
    workspaceEntryMatchesTree(child, normalizedQuery, childrenMap),
  );
};

export const filterWorkspaceEntriesByQuery = (
  entries: IWorkspaceEntry[],
  query: string,
  childrenMap: TWorkspaceChildrenMap,
): IWorkspaceEntry[] => {
  const normalizedQuery = normalizeWorkspaceQuery(query);
  if (!normalizedQuery) {
    return entries;
  }

  return entries.filter((entry) => workspaceEntryMatchesTree(entry, normalizedQuery, childrenMap));
};

export const collectWorkspaceExpandedPathsByQuery = (
  entries: IWorkspaceEntry[],
  query: string,
  childrenMap: TWorkspaceChildrenMap,
): Set<string> => {
  const normalizedQuery = normalizeWorkspaceQuery(query);
  const expandedPaths = new Set<string>();

  if (!normalizedQuery) {
    return expandedPaths;
  }

  const visit = (entry: IWorkspaceEntry): boolean => {
    if (workspaceEntryMatchesSearch(entry, normalizedQuery)) {
      if (entry.kind === 'directory') {
        expandedPaths.add(entry.path);
      }

      return true;
    }

    if (entry.kind !== 'directory') {
      return false;
    }

    const descendants = childrenMap[entry.path] ?? [];
    const hasMatchingDescendant = descendants.some((child) => visit(child));

    if (hasMatchingDescendant) {
      expandedPaths.add(entry.path);
    }

    return hasMatchingDescendant;
  };

  entries.forEach((entry) => {
    void visit(entry);
  });

  return expandedPaths;
};

export const sortByRelativePath = <T extends { relativePath: string }>(entries: T[]): T[] =>
  [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
