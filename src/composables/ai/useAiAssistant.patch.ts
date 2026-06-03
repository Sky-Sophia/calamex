import { tauriService } from '@/services/tauri';
import type { IAiAgentPatchSummary, IAiPatchSet } from '@/types/ai';
import {
  AGENT_RUNTIME_EVENT_SCHEMA_VERSION,
  type TAgentRuntimeEvent,
  type TAgentUiEvent,
} from '@/types/ai/sidecar';
import type { IAnalyzeScriptPayload, IEditorDocument } from '@/types/editor';
import { toErrorMessage } from '@/utils/error';
import { areFileSystemPathsEqual, normalizeFileSystemPath } from '@/utils/path';

import { createScopedId } from './useAiAssistant.runtime-events';

// ---------------------------------------------------------------------------
// Patch materialize / ShellCheck / sidecar patch parsing (extracted from useAiAssistant.ts)
// ---------------------------------------------------------------------------

const SHELL_SCRIPT_FILE_PATTERN = /\.(?:sh|bash|dash|ksh|bats)$/iu;
const SIDECAR_PATCH_TOOL_NAMES = new Set(['apply_file_edits', 'propose_file_patch']);

export interface ISidecarPatchEntry {
  patch: IAiPatchSet;
  alreadyApplied: boolean;
}

const reversePatchLine = (line: string): string => {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return line;
  }

  if (line.startsWith('+')) {
    return `-${line.slice(1)}`;
  }

  if (line.startsWith('-')) {
    return `+${line.slice(1)}`;
  }

  return line;
};

export const buildReversePatchSet = (
  patches: readonly IAiPatchSet[] | undefined,
  summary: IAiAgentPatchSummary,
): IAiPatchSet | null => {
  const files = (patches ?? [])
    .flatMap((patch) => patch.files)
    .filter((patchFile) =>
      summary.files.some((file) => areFileSystemPathsEqual(file.path, patchFile.path)),
    )
    .map((file) => ({
      path: file.path,
      originalHash: file.originalHash,
      hunks: file.hunks.map((hunk) => ({
        oldStart: hunk.newStart,
        oldLines: hunk.newLines,
        newStart: hunk.oldStart,
        newLines: hunk.oldLines,
        lines: hunk.lines.map(reversePatchLine),
      })),
    }));

  return files.length > 0
    ? {
        summary: `回滚 ${summary.files.length} 个文件的 AI 修改`,
        files,
      }
    : null;
};

export const normalizePatchDisplayPath = (path: string): string => {
  const normalized = normalizeFileSystemPath(path, {
    collapseDuplicateSeparators: true,
    trimTrailingSeparator: true,
    foldWindowsCase: false,
  });

  return normalized || path;
};

export const materializePatchedContent = (
  patchFile: IAiPatchSet['files'][number],
): string | null => {
  const output: string[] = [];

  for (const hunk of patchFile.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+') || line.startsWith(' ')) {
        output.push(line.slice(1));
        continue;
      }

      if (line.startsWith('-')) {
        continue;
      }

      return null;
    }
  }

  return output.join('\n');
};

export const countDocumentLines = (content: string): number => {
  if (!content.length) {
    return 1;
  }

  return content.split('\n').length;
};

export const getPathFileName = (path: string): string => {
  const normalized = path.replace(/\\/gu, '/');
  const fileName = normalized
    .split('/')
    .filter((part) => part.length > 0)
    .at(-1);

  return fileName ?? path;
};

const hasShellShebang = (content: string): boolean => {
  const firstLine = content.split(/\r?\n/u, 1)[0]?.toLocaleLowerCase() ?? '';

  return firstLine.startsWith('#!') && /\b(?:ba|da|k)?sh\b/u.test(firstLine);
};

const shouldRunShellCheckForPatchFile = (path: string, content: string): boolean =>
  SHELL_SCRIPT_FILE_PATTERN.test(path) || hasShellShebang(content);

const countShellCheckDiagnostics = (
  diagnostics: readonly IAnalyzeScriptPayload['diagnostics'][number][],
): { errors: number; warnings: number; infos: number } => {
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.level === 'error') {
      errors += 1;
    } else if (diagnostic.level === 'warning') {
      warnings += 1;
    } else {
      infos += 1;
    }
  }

  return { errors, warnings, infos };
};

const collectShellCheckDiagnosticCodes = (
  diagnostics: readonly IAnalyzeScriptPayload['diagnostics'][number][],
): string[] => {
  const codes = new Set<string>();

  for (const diagnostic of diagnostics) {
    const code = diagnostic.code.trim().toUpperCase();

    if (code) {
      codes.add(code);
    }
  }

  return [...codes];
};

const formatShellCheckCounts = (counts: {
  errors: number;
  warnings: number;
  infos: number;
}): string =>
  [
    counts.errors > 0 ? `${counts.errors} 错误` : '',
    counts.warnings > 0 ? `${counts.warnings} 警告` : '',
    counts.infos > 0 ? `${counts.infos} 提示` : '',
  ]
    .filter((item) => item.length > 0)
    .join('、');

const summarizeShellCheckAnalysis = (path: string, analysis: IAnalyzeScriptPayload): string => {
  const displayPath = normalizePatchDisplayPath(path);

  if (!analysis.available) {
    return `${displayPath}：ShellCheck 不可用${analysis.message ? `，${analysis.message}` : ''}`;
  }

  if (analysis.diagnostics.length === 0) {
    return `${displayPath}：ShellCheck 通过（${analysis.dialect}）`;
  }

  const counts = countShellCheckDiagnostics(analysis.diagnostics);
  const diagnosticCodes = collectShellCheckDiagnosticCodes(analysis.diagnostics);
  const firstDiagnostic = analysis.diagnostics[0];
  const diagnosticCodesText =
    diagnosticCodes.length > 0 ? `；问题编号 ${diagnosticCodes.join('、')}` : '';
  const firstDiagnosticText = firstDiagnostic
    ? `；首个问题 L${firstDiagnostic.line}:${firstDiagnostic.column} ${firstDiagnostic.message}`
    : '';

  return `${displayPath}：ShellCheck ${formatShellCheckCounts(counts)}${diagnosticCodesText}${firstDiagnosticText}`;
};

const createHostToolCompletedRuntimeEvent = (input: {
  runId: string;
  sessionId: string;
  seq: number;
  toolName: string;
  ok: boolean;
  resultPreview?: string;
  errorMessage?: string;
  level?: TAgentRuntimeEvent['level'];
}): TAgentRuntimeEvent => ({
  id: createScopedId(`host-${input.toolName}`),
  type: 'agent.tool.completed',
  runId: input.runId,
  sessionId: input.sessionId,
  agentId: 'host',
  timestamp: new Date().toISOString(),
  seq: input.seq,
  schemaVersion: AGENT_RUNTIME_EVENT_SCHEMA_VERSION,
  redacted: true,
  visibility: 'user',
  ...(input.level ? { level: input.level } : {}),
  toolName: input.toolName,
  ok: input.ok,
  ...(input.resultPreview ? { resultPreview: input.resultPreview } : {}),
  ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
});

export const syncPatchedDocument = (
  document: IEditorDocument,
  patch: IAiPatchSet,
  appliedPaths: string[],
): void => {
  if (!document.path || document.kind !== 'text') {
    return;
  }

  const patchFile = patch.files.find((file) => areFileSystemPathsEqual(file.path, document.path));

  if (!patchFile) {
    return;
  }

  const wasApplied = appliedPaths.some((path) => areFileSystemPathsEqual(path, patchFile.path));

  if (!wasApplied) {
    return;
  }

  const nextContent = materializePatchedContent(patchFile);

  if (nextContent === null) {
    return;
  }

  document.path = normalizePatchDisplayPath(patchFile.path);
  document.content = nextContent;
  document.savedContent = nextContent;
  document.isDirty = false;
  document.lineCount = countDocumentLines(nextContent);
  document.charCount = [...nextContent].length;
};

export const runShellCheckForAppliedPatch = async (input: {
  patch: IAiPatchSet;
  appliedPaths: readonly string[];
  runId: string;
  sessionId: string;
  seqStart: number;
}): Promise<TAgentRuntimeEvent[]> => {
  const events: TAgentRuntimeEvent[] = [];
  let seq = input.seqStart;

  for (const file of input.patch.files) {
    const wasApplied = input.appliedPaths.some((path) => areFileSystemPathsEqual(path, file.path));

    if (!wasApplied) {
      continue;
    }

    const content = materializePatchedContent(file);

    if (content === null || !shouldRunShellCheckForPatchFile(file.path, content)) {
      continue;
    }

    try {
      const analysis = await tauriService.analyzeScript({
        path: file.path,
        name: getPathFileName(file.path),
        content,
      });
      const counts = countShellCheckDiagnostics(analysis.diagnostics);
      const hasErrors = counts.errors > 0;
      const hasWarnings = counts.warnings > 0 || counts.infos > 0;

      events.push(
        createHostToolCompletedRuntimeEvent({
          runId: input.runId,
          sessionId: input.sessionId,
          seq,
          toolName: 'shellcheck',
          ok: analysis.available && !hasErrors,
          level: !analysis.available || hasErrors ? 'error' : hasWarnings ? 'warn' : 'info',
          resultPreview: summarizeShellCheckAnalysis(file.path, analysis),
          ...(!analysis.available && analysis.message ? { errorMessage: analysis.message } : {}),
        }),
      );
      seq += 1;
    } catch (error) {
      const message = toErrorMessage(error, 'ShellCheck 诊断失败。');

      events.push(
        createHostToolCompletedRuntimeEvent({
          runId: input.runId,
          sessionId: input.sessionId,
          seq,
          toolName: 'shellcheck',
          ok: false,
          level: 'error',
          errorMessage: message,
          resultPreview: `${normalizePatchDisplayPath(file.path)}：${message}`,
        }),
      );
      seq += 1;
    }
  }

  return events;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isPatchHunk = (value: unknown): value is IAiPatchSet['files'][number]['hunks'][number] => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.oldStart === 'number' &&
    typeof value.oldLines === 'number' &&
    typeof value.newStart === 'number' &&
    typeof value.newLines === 'number' &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => typeof line === 'string')
  );
};

const isPatchFile = (value: unknown): value is IAiPatchSet['files'][number] => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.path === 'string' &&
    typeof value.originalHash === 'string' &&
    (value.originalModifiedAtMs === undefined ||
      value.originalModifiedAtMs === null ||
      typeof value.originalModifiedAtMs === 'number') &&
    Array.isArray(value.hunks) &&
    value.hunks.every(isPatchHunk)
  );
};

const isPatchSet = (value: unknown): value is IAiPatchSet => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.summary === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(isPatchFile)
  );
};

const extractPatchEntryFromToolOutput = (output: unknown): ISidecarPatchEntry | null => {
  const normalizedOutput = typeof output === 'string' ? parseJsonObject(output) : output;

  if (!isRecord(normalizedOutput)) {
    return null;
  }

  const patch = normalizedOutput.patch;

  return isPatchSet(patch)
    ? {
        patch,
        alreadyApplied: normalizedOutput.applied === true,
      }
    : null;
};

export const extractSidecarPatchEntries = (
  events: readonly TAgentUiEvent[],
): ISidecarPatchEntry[] =>
  events.flatMap((event) => {
    if (event.type !== 'tool_result' || !SIDECAR_PATCH_TOOL_NAMES.has(event.toolName)) {
      return [];
    }

    const patchEntry = extractPatchEntryFromToolOutput(event.output);

    return patchEntry ? [patchEntry] : [];
  });
