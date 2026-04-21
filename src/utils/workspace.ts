import type { IWorkspaceDirectoryPayload, IWorkspaceEntry } from '@/types/editor';
import { normalizeFileSystemPath } from '@/utils/path';

export type TWorkspaceChildrenMap = Record<string, IWorkspaceEntry[]>;

const normalizeWorkspaceQuery = (query: string): string => query.trim().toLowerCase();

export const resolvePreloadedWorkspaceRoot = (
  workspaceRootPath: string | null,
  preloadedWorkspaceRoot: IWorkspaceDirectoryPayload | null,
): IWorkspaceDirectoryPayload | null => {
  if (!workspaceRootPath || !preloadedWorkspaceRoot) {
    return null;
  }

  return preloadedWorkspaceRoot.rootPath === workspaceRootPath ? preloadedWorkspaceRoot : null;
};

export const workspaceEntryMatchesSearch = (
  entry: IWorkspaceEntry,
  query: string,
): boolean => {
  const normalizedQuery = normalizeWorkspaceQuery(query);
  if (!normalizedQuery) {
    return true;
  }

  return (
    entry.name.toLowerCase().includes(normalizedQuery) ||
    normalizeFileSystemPath(entry.path).toLowerCase().includes(normalizedQuery)
  );
};

export const workspaceEntryMatchesTree = (
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

  return entries.filter((entry) =>
    workspaceEntryMatchesTree(entry, normalizedQuery, childrenMap),
  );
};

export const sortByRelativePath = <T extends { relativePath: string }>(entries: T[]): T[] =>
  [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
