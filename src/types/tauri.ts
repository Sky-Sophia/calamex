import type {
  IAnalyzeScriptPayload,
  IAnalyzeScriptRequest,
  IExecutionEnvironment,
  IFormatScriptPayload,
  IFormatScriptRequest,
  IImageAssetPayload,
  ISaveScriptRequest,
  IScriptFilePayload,
  IWorkspaceDirectoryPayload,
  IWorkspacePathCreatePayload,
  IWorkspacePathCreateRequest,
  IWorkspacePathDeletePayload,
  IWorkspacePathDeleteRequest,
  IWorkspacePathRenamePayload,
  IWorkspacePathRenameRequest,
} from './editor';
import type {
  IGitCommitRequest,
  IGitCommitResultPayload,
  IGitFileBaselinePayload,
  IGitPathOperationRequest,
  IGitRepositoryStatusPayload,
} from './git';
import type {
  ICloseTerminalSessionRequest,
  ICancelTerminalRunRequest,
  IDispatchTerminalScriptPayload,
  IDispatchTerminalScriptRequest,
  IEnsureTerminalSessionRequest,
  IResizeTerminalSessionRequest,
  ITerminalSessionPayload,
  IWriteTerminalInputRequest,
} from './terminal';
import type { IWorkspaceSearchPayload, IWorkspaceSearchRequest } from './search';

export interface ISshConnectionTestRequest {
  host: string;
  port: number;
  username: string;
  authMode: 'key' | 'password';
  identityPath: string | null;
}

export interface ISshConnectionTestPayload {
  ok: boolean;
  code: string;
  message: string;
}

export interface ISshDirectoryListRequest extends ISshConnectionTestRequest {
  path: string;
}

export interface ISshDirectoryEntryPayload {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
}

export interface ISshDirectoryListPayload {
  path: string;
  entries: ISshDirectoryEntryPayload[];
}

export interface ISshFileDownloadRequest extends ISshConnectionTestRequest {
  remotePath: string;
  localPath: string;
}

export interface ISshFileDownloadPayload {
  remotePath: string;
  localPath: string;
  byteSize: number;
}

export interface ISshFileUploadRequest extends ISshConnectionTestRequest {
  localPath: string;
  remoteDirectory: string;
}

export interface ISshFileUploadPayload {
  localPath: string;
  remotePath: string;
  byteSize: number;
}

export interface ISshPathDeleteRequest extends ISshConnectionTestRequest {
  remotePath: string;
}

export interface ISshPathDeletePayload {
  remotePath: string;
}

export interface ISshPathRenameRequest extends ISshConnectionTestRequest {
  remotePath: string;
  newName: string;
}

export interface ISshPathRenamePayload {
  oldPath: string;
  newPath: string;
}

export interface ISshConfigHostPayload {
  id: string;
  name: string;
  username: string;
  host: string;
  port: number;
  identityPath: string | null;
  lastUsedLabel: string;
}

export interface ITauriService {
  analyzeScript(payload: IAnalyzeScriptRequest): Promise<IAnalyzeScriptPayload>;
  formatScript(payload: IFormatScriptRequest): Promise<IFormatScriptPayload>;
  loadScript(path: string): Promise<IScriptFilePayload>;
  loadImageAsset(path: string): Promise<IImageAssetPayload>;
  saveScript(payload: ISaveScriptRequest): Promise<IScriptFilePayload>;
  detectEnvironment(): Promise<IExecutionEnvironment>;
  listWorkspaceEntries(path?: string, rootPath?: string): Promise<IWorkspaceDirectoryPayload>;
  createWorkspacePath(payload: IWorkspacePathCreateRequest): Promise<IWorkspacePathCreatePayload>;
  renameWorkspacePath(payload: IWorkspacePathRenameRequest): Promise<IWorkspacePathRenamePayload>;
  deleteWorkspacePath(payload: IWorkspacePathDeleteRequest): Promise<IWorkspacePathDeletePayload>;
  searchWorkspace(payload: IWorkspaceSearchRequest): Promise<IWorkspaceSearchPayload>;
  getGitRepositoryStatus(workspaceRootPath?: string | null): Promise<IGitRepositoryStatusPayload>;
  initGitRepository(workspaceRootPath?: string | null): Promise<IGitRepositoryStatusPayload>;
  getGitFileBaseline(path: string): Promise<IGitFileBaselinePayload>;
  stageGitPaths(payload: IGitPathOperationRequest): Promise<IGitRepositoryStatusPayload>;
  unstageGitPaths(payload: IGitPathOperationRequest): Promise<IGitRepositoryStatusPayload>;
  discardGitPaths(payload: IGitPathOperationRequest): Promise<IGitRepositoryStatusPayload>;
  commitGitIndex(payload: IGitCommitRequest): Promise<IGitCommitResultPayload>;
  ensureTerminalSession(payload: IEnsureTerminalSessionRequest): Promise<ITerminalSessionPayload>;
  dispatchScriptToTerminal(
    payload: IDispatchTerminalScriptRequest,
  ): Promise<IDispatchTerminalScriptPayload>;
  writeTerminalInput(payload: IWriteTerminalInputRequest): Promise<void>;
  resizeTerminalSession(payload: IResizeTerminalSessionRequest): Promise<void>;
  closeTerminalSession(payload: ICloseTerminalSessionRequest): Promise<void>;
  cancelTerminalRun(payload: ICancelTerminalRunRequest): Promise<void>;
  testSshConnection(payload: ISshConnectionTestRequest): Promise<ISshConnectionTestPayload>;
  listSshConfigHosts(): Promise<ISshConfigHostPayload[]>;
  listSshDirectory(payload: ISshDirectoryListRequest): Promise<ISshDirectoryListPayload>;
  downloadSshFile(payload: ISshFileDownloadRequest): Promise<ISshFileDownloadPayload>;
  uploadSshFile(payload: ISshFileUploadRequest): Promise<ISshFileUploadPayload>;
  deleteSshPath(payload: ISshPathDeleteRequest): Promise<ISshPathDeletePayload>;
  renameSshPath(payload: ISshPathRenameRequest): Promise<ISshPathRenamePayload>;
}
