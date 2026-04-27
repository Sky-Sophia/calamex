export type TWorkspaceSearchScope = 'all' | 'file-name' | 'symbol' | 'content';

export type TWorkspaceSearchResultKind = 'file-name' | 'content' | 'symbol';

export interface IWorkspaceSearchRequest {
  workspaceRootPath: string;
  query: string;
  scope: TWorkspaceSearchScope;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePatterns: string[];
  excludePatterns: string[];
  limit?: number;
}

export interface IWorkspaceSearchResult {
  path: string;
  relativePath: string;
  name: string;
  kind: TWorkspaceSearchResultKind;
  lineNumber: number | null;
  lineText: string | null;
  score: number;
}

export interface IWorkspaceSearchPayload {
  rootPath: string;
  scannedFileCount: number;
  results: IWorkspaceSearchResult[];
}
