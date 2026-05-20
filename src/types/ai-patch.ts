export const AI_AGENT_CHANGED_FILE_STATUSES = [
  'added',
  'modified',
  'deleted',
  'renamed',
] as const;

export const AI_DIFF_PREVIEW_LINE_KINDS = [
  'add',
  'delete',
  'hunk',
  'context',
] as const;

export type TAiAgentChangedFileStatus =
  (typeof AI_AGENT_CHANGED_FILE_STATUSES)[number];

export type TAiDiffPreviewLineKind =
  (typeof AI_DIFF_PREVIEW_LINE_KINDS)[number];

export interface IAiAgentChangedFile {
  path: string;
  status: TAiAgentChangedFileStatus;
  additions: number;
  deletions: number;
  diffRef: string;
  rollbackRef?: string;
}

export interface IAiAgentPatchSummary {
  id: string;
  runId: string;
  stepId: string;
  files: IAiAgentChangedFile[];
  totalAdditions: number;
  totalDeletions: number;
  patchRef: string;
  appliedAt?: string;
  revertedAt?: string;
  pinned?: boolean;
}

export interface IAiDiffPreviewLine {
  id: string;
  kind: TAiDiffPreviewLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface IAiDiffHunkPreview {
  id: string;
  filePath: string;
  diffRef: string;
  header: string;
  lines: IAiDiffPreviewLine[];
}

export interface IAiDiffEditorPreview {
  id: string;
  title: string;
  filePath: string;
  diffRef: string;
  patchRef?: string;
  runId?: string;
  stepId?: string;
  hunks: IAiDiffHunkPreview[];
}
