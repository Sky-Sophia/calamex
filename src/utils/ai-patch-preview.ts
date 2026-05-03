import type {
  IAiDiffHunkPreview,
  IAiDiffPreviewLine,
  IAiPatchFile,
  IAiPatchHunk,
  IAiPatchSet,
} from '@/types/ai';
import type { IGitDiffPreviewPayload } from '@/types/git';
import { normalizeFileSystemPath } from '@/utils/path';

export interface IAiPatchPreviewFile {
  path: string;
  displayPath: string;
  hunks: IAiDiffHunkPreview[];
  gitDiffPreview: IGitDiffPreviewPayload;
}

interface ILineCursor {
  oldLineNumber: number;
  newLineNumber: number;
}

interface IMaterializedPatchContent {
  originalContent: string;
  modifiedContent: string;
}

const PATCH_DIFF_HASH_OFFSET = 0x811c9dc5;
const PATCH_DIFF_HASH_PRIME = 0x01000193;

export const formatAiPatchDisplayPath = (path: string): string => {
  const normalized = normalizeFileSystemPath(path, {
    collapseDuplicateSeparators: true,
    trimTrailingSeparator: true,
    foldWindowsCase: false,
  });

  return normalized || path;
};

const formatPatchRange = (start: number, lines: number): string =>
  lines === 1 ? String(start) : `${start},${lines}`;

const buildPatchHunkHeader = (hunk: IAiPatchHunk): string =>
  `@@ -${formatPatchRange(hunk.oldStart, hunk.oldLines)} +${formatPatchRange(
    hunk.newStart,
    hunk.newLines,
  )} @@`;

const buildPatchDiffRef = (path: string): string =>
  `patch-preview:${encodeURIComponent(formatAiPatchDisplayPath(path))}`;

const hashPatchDiffKey = (value: string): string => {
  let hash = PATCH_DIFF_HASH_OFFSET;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, PATCH_DIFF_HASH_PRIME) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
};

const buildPatchDiffPreviewId = (file: IAiPatchFile): string => {
  const source = [
    formatAiPatchDisplayPath(file.path),
    file.originalHash,
    ...file.hunks.flatMap((hunk) => [
      String(hunk.oldStart),
      String(hunk.oldLines),
      String(hunk.newStart),
      String(hunk.newLines),
      ...hunk.lines,
    ]),
  ].join('\n');

  return `patch-diff:${hashPatchDiffKey(source)}`;
};

const getPatchRelativePath = (
  filePath: string,
  workspaceRootPath: string | null | undefined,
): string => {
  const displayPath = formatAiPatchDisplayPath(filePath);
  const displayRoot = formatAiPatchDisplayPath(workspaceRootPath ?? '');

  if (!displayRoot) {
    return displayPath;
  }

  const comparablePath = displayPath.toLowerCase();
  const comparableRoot = displayRoot.toLowerCase();

  if (comparablePath === comparableRoot) {
    return '';
  }

  if (comparablePath.startsWith(`${comparableRoot}/`)) {
    return displayPath.slice(displayRoot.length + 1);
  }

  return displayPath;
};

const buildLinePreview = (
  file: IAiPatchFile,
  hunkIndex: number,
  line: string,
  lineIndex: number,
  cursor: ILineCursor,
): IAiDiffPreviewLine | null => {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return null;
  }

  const id = `${file.path}:${hunkIndex}:${lineIndex}`;

  if (line.startsWith('+')) {
    const item: IAiDiffPreviewLine = {
      id,
      kind: 'add',
      content: line.slice(1),
      newLineNumber: cursor.newLineNumber,
    };
    cursor.newLineNumber += 1;
    return item;
  }

  if (line.startsWith('-')) {
    const item: IAiDiffPreviewLine = {
      id,
      kind: 'delete',
      content: line.slice(1),
      oldLineNumber: cursor.oldLineNumber,
    };
    cursor.oldLineNumber += 1;
    return item;
  }

  const content = line.startsWith(' ') ? line.slice(1) : line;
  const item: IAiDiffPreviewLine = {
    id,
    kind: 'context',
    content,
    oldLineNumber: cursor.oldLineNumber,
    newLineNumber: cursor.newLineNumber,
  };
  cursor.oldLineNumber += 1;
  cursor.newLineNumber += 1;
  return item;
};

const buildPatchPreviewHunks = (file: IAiPatchFile): IAiDiffHunkPreview[] => {
  const displayPath = formatAiPatchDisplayPath(file.path);
  const diffRef = buildPatchDiffRef(file.path);

  return file.hunks.map((hunk, hunkIndex) => {
    const cursor: ILineCursor = {
      oldLineNumber: hunk.oldStart,
      newLineNumber: hunk.newStart,
    };

    return {
      id: `${file.path}:${hunk.oldStart}:${hunk.newStart}:${hunkIndex}`,
      filePath: displayPath,
      diffRef,
      header: buildPatchHunkHeader(hunk),
      lines: hunk.lines
        .map((line, lineIndex) => buildLinePreview(file, hunkIndex, line, lineIndex, cursor))
        .filter((line): line is IAiDiffPreviewLine => line !== null),
    };
  });
};

const materializePatchContent = (file: IAiPatchFile): IMaterializedPatchContent => {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        continue;
      }

      if (line.startsWith('+')) {
        modifiedLines.push(line.slice(1));
        continue;
      }

      if (line.startsWith('-')) {
        originalLines.push(line.slice(1));
        continue;
      }

      const content = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(content);
      modifiedLines.push(content);
    }
  }

  return {
    originalContent: originalLines.join('\n'),
    modifiedContent: modifiedLines.join('\n'),
  };
};

const buildGitDiffPreview = (
  file: IAiPatchFile,
  workspaceRootPath: string | null | undefined,
): IGitDiffPreviewPayload => {
  const displayPath = formatAiPatchDisplayPath(file.path);
  const relativePath = getPatchRelativePath(file.path, workspaceRootPath);
  const { originalContent, modifiedContent } = materializePatchContent(file);

  return {
    id: buildPatchDiffPreviewId(file),
    repositoryRootPath: formatAiPatchDisplayPath(workspaceRootPath ?? ''),
    path: displayPath,
    relativePath,
    title: `${relativePath || displayPath} · Patch Diff`,
    mode: 'worktree',
    originalContent,
    modifiedContent,
    isEmpty: originalContent === modifiedContent,
  };
};

export const buildAiPatchPreviewFiles = (
  patch: IAiPatchSet,
  workspaceRootPath: string | null | undefined,
): IAiPatchPreviewFile[] =>
  patch.files.map((file) => ({
    path: file.path,
    displayPath: formatAiPatchDisplayPath(file.path),
    hunks: buildPatchPreviewHunks(file),
    gitDiffPreview: buildGitDiffPreview(file, workspaceRootPath),
  }));
