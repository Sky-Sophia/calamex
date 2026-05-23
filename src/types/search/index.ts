import type {
  WorkspaceReplacementAppliedFile,
  WorkspaceReplacementApplyPayload,
  WorkspaceReplacementApplyRequest,
  WorkspaceReplacementExpectedFile,
  WorkspaceReplacementFilePreview,
  WorkspaceReplacementLinePreview,
  WorkspaceReplacementPreviewPayload,
  WorkspaceReplacementRequest,
  WorkspaceSearchPayload,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceSearchResultKind,
  WorkspaceSearchScope,
} from '@/bindings/tauri';

export type TWorkspaceSearchScope = WorkspaceSearchScope;

export type TWorkspaceSearchResultKind = WorkspaceSearchResultKind;

export type IWorkspaceSearchRequest = Omit<WorkspaceSearchRequest, 'limit'> & {
  limit?: number;
};

export type IWorkspaceSearchResult = WorkspaceSearchResult;

export type IWorkspaceSearchPayload = WorkspaceSearchPayload;

export type IWorkspaceReplacementRequest = Omit<WorkspaceReplacementRequest, 'limit'> & {
  limit?: number;
};

export type IWorkspaceReplacementExpectedFile = WorkspaceReplacementExpectedFile;

export type IWorkspaceReplacementApplyRequest = Omit<
  WorkspaceReplacementApplyRequest,
  'request'
> & {
  request: IWorkspaceReplacementRequest;
};

export type IWorkspaceReplacementFilePreview = WorkspaceReplacementFilePreview;

export type IWorkspaceReplacementLinePreview = WorkspaceReplacementLinePreview;

export type IWorkspaceReplacementPreviewPayload = WorkspaceReplacementPreviewPayload;

export type IWorkspaceReplacementAppliedFile = WorkspaceReplacementAppliedFile;

export type IWorkspaceReplacementApplyPayload = WorkspaceReplacementApplyPayload;