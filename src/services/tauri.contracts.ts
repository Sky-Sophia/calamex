import { z } from 'zod';

export const zTauriVoid = z
  .union([z.null(), z.undefined(), z.void()])
  .transform(() => undefined as void);

const documentEncodingSchema = z.enum([
  'utf-8',
  'utf-8-bom',
  'gbk',
  'gb18030',
  'utf-16le',
  'utf-16be',
]);

const executorKindSchema = z.enum(['wsl']);

const gitChangeKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'typechange',
  'untracked',
  'conflicted',
]);

const workspaceEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(['directory', 'file']),
  hasChildren: z.boolean(),
});

const executionOptionSchema = z.object({
  type: executorKindSchema,
  label: z.string(),
  available: z.boolean(),
  description: z.string(),
  commandPath: z.string().nullable(),
});

const executionOptionSnakeSchema = z.object({
  type: executorKindSchema,
  label: z.string(),
  available: z.boolean(),
  description: z.string(),
  command_path: z.string().nullable(),
}).transform((value) => ({
  type: value.type,
  label: value.label,
  available: value.available,
  description: value.description,
  commandPath: value.command_path,
}));

const scriptDiagnosticSchema = z.object({
  line: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
  level: z.enum(['error', 'warning', 'info', 'style']),
  code: z.string(),
  message: z.string(),
});

const scriptFilePayloadSchema = z.object({
  path: z.string(),
  name: z.string(),
  content: z.string(),
  encoding: documentEncodingSchema,
  lineCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
});

const gitCommitSummaryPayloadSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  summary: z.string(),
  authorName: z.string(),
  authoredAt: z.string(),
});

const gitFileStatusPayloadSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  previousPath: z.string().nullable(),
  previousRelativePath: z.string().nullable(),
  indexStatus: gitChangeKindSchema.nullable(),
  worktreeStatus: gitChangeKindSchema.nullable(),
  isConflicted: z.boolean(),
  isUntracked: z.boolean(),
});

const gitRepositoryStatusPayloadSchema = z.object({
  available: z.boolean(),
  message: z.string().nullable(),
  repositoryRootPath: z.string().nullable(),
  repositoryName: z.string().nullable(),
  gitDirPath: z.string().nullable(),
  headBranchName: z.string().nullable(),
  headShortName: z.string().nullable(),
  headShortOid: z.string().nullable(),
  isDetached: z.boolean(),
  isClean: z.boolean(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  stagedCount: z.number().int().nonnegative(),
  unstagedCount: z.number().int().nonnegative(),
  untrackedCount: z.number().int().nonnegative(),
  conflictedCount: z.number().int().nonnegative(),
  files: z.array(gitFileStatusPayloadSchema),
  lastCommit: gitCommitSummaryPayloadSchema.nullable(),
});

const terminalSessionPayloadSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  shellLabel: z.string(),
  created: z.boolean(),
  initialOutput: z.string().nullable().optional(),
});

const terminalSessionPayloadSnakeSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  shell_label: z.string(),
  created: z.boolean(),
  initial_output: z.string().nullable().optional(),
}).transform((value) => ({
  sessionId: value.session_id,
  cwd: value.cwd,
  shellLabel: value.shell_label,
  created: value.created,
  initialOutput: value.initial_output,
}));

const dispatchTerminalScriptPayloadSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  commandLine: z.string(),
  usedTempFile: z.boolean(),
  startedAt: z.string(),
});

const dispatchTerminalScriptPayloadSnakeSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  command_line: z.string(),
  used_temp_file: z.boolean(),
  started_at: z.string(),
}).transform((value) => ({
  sessionId: value.session_id,
  cwd: value.cwd,
  commandLine: value.command_line,
  usedTempFile: value.used_temp_file,
  startedAt: value.started_at,
}));

const executionEnvironmentPayloadSchema = z.object({
  recommended: executorKindSchema,
  hasAny: z.boolean(),
  executors: z.array(z.union([executionOptionSchema, executionOptionSnakeSchema])),
});

const executionEnvironmentPayloadSnakeSchema = z.object({
  recommended: executorKindSchema,
  has_any: z.boolean(),
  executors: z.array(z.union([executionOptionSchema, executionOptionSnakeSchema])),
}).transform((value) => ({
  recommended: value.recommended,
  hasAny: value.has_any,
  executors: value.executors,
}));

export const tauriContracts = {
  getStartupWorkspace: {
    inSchema: z.void(),
    outSchema: z.object({
      rootPath: z.string(),
      rootName: z.string(),
      defaultFilePath: z.string().nullable(),
      protectedRootPaths: z.array(z.string()),
    }),
  },
  analyzeScript: {
    inSchema: z.object({
      path: z.string().nullable(),
      name: z.string().nullable().optional(),
      content: z.string(),
    }),
    outSchema: z.object({
      available: z.boolean(),
      message: z.string().nullable(),
      dialect: z.string(),
      diagnostics: z.array(scriptDiagnosticSchema),
    }),
  },
  formatScript: {
    inSchema: z.object({
      path: z.string().nullable(),
      content: z.string(),
      encoding: documentEncodingSchema,
    }),
    outSchema: z.object({
      content: z.string(),
      encoding: documentEncodingSchema,
      lineCount: z.number().int().nonnegative(),
      charCount: z.number().int().nonnegative(),
    }),
  },
  loadScript: {
    inSchema: z.object({
      path: z.string().min(1),
    }),
    outSchema: scriptFilePayloadSchema,
  },
  loadImageAsset: {
    inSchema: z.object({
      path: z.string().min(1),
    }),
    outSchema: z.object({
      path: z.string(),
      name: z.string(),
      mimeType: z.string(),
      dataUrl: z.string(),
      byteSize: z.number().int().nonnegative(),
    }),
  },
  saveScript: {
    inSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      encoding: documentEncodingSchema,
    }),
    outSchema: scriptFilePayloadSchema,
  },
  detectEnvironment: {
    inSchema: z.void(),
    outSchema: z.union([executionEnvironmentPayloadSchema, executionEnvironmentPayloadSnakeSchema]),
  },
  runScript: {
    inSchema: z.object({
      path: z.string().nullable(),
      content: z.string(),
      encoding: documentEncodingSchema,
      executor: executorKindSchema,
      isDirty: z.boolean(),
    }),
    outSchema: z.object({
      success: z.boolean(),
      stdout: z.string(),
      stderr: z.string(),
      combinedOutput: z.string(),
      exitCode: z.number().int().nullable(),
      executor: executorKindSchema,
      executorLabel: z.string(),
      durationMs: z.number().nonnegative(),
      startedAt: z.string(),
      finishedAt: z.string(),
      commandLine: z.string(),
      logPath: z.string().nullable(),
      usedTempFile: z.boolean(),
    }),
  },
  listWorkspaceEntries: {
    inSchema: z.object({
      path: z.string().optional(),
      rootPath: z.string().optional(),
    }),
    outSchema: z.object({
      rootPath: z.string(),
      rootName: z.string(),
      entries: z.array(workspaceEntrySchema),
    }),
  },
  getGitRepositoryStatus: {
    inSchema: z.object({
      workspaceRootPath: z.string().nullable().optional(),
    }),
    outSchema: gitRepositoryStatusPayloadSchema,
  },
  initGitRepository: {
    inSchema: z.object({
      workspaceRootPath: z.string().nullable().optional(),
    }),
    outSchema: gitRepositoryStatusPayloadSchema,
  },
  getGitFileBaseline: {
    inSchema: z.object({
      path: z.string().min(1),
    }),
    outSchema: z.object({
      available: z.boolean(),
      message: z.string().nullable(),
      repositoryRootPath: z.string().nullable(),
      filePath: z.string(),
      relativePath: z.string().nullable(),
      isTracked: z.boolean(),
      content: z.string().nullable(),
    }),
  },
  stageGitPaths: {
    inSchema: z.object({
      repositoryRootPath: z.string(),
      paths: z.array(z.string()),
    }),
    outSchema: gitRepositoryStatusPayloadSchema,
  },
  unstageGitPaths: {
    inSchema: z.object({
      repositoryRootPath: z.string(),
      paths: z.array(z.string()),
    }),
    outSchema: gitRepositoryStatusPayloadSchema,
  },
  commitGitIndex: {
    inSchema: z.object({
      repositoryRootPath: z.string(),
      message: z.string(),
    }),
    outSchema: z.object({
      status: gitRepositoryStatusPayloadSchema,
      commit: gitCommitSummaryPayloadSchema,
    }),
  },
  ensureTerminalSession: {
    inSchema: z.object({
      sessionId: z.string(),
      cwd: z.string().nullable(),
      cols: z.number().int().min(1),
      rows: z.number().int().min(1),
    }),
    outSchema: z.union([terminalSessionPayloadSchema, terminalSessionPayloadSnakeSchema]),
  },
  dispatchScriptToTerminal: {
    inSchema: z.object({
      sessionId: z.string(),
      path: z.string().nullable(),
      content: z.string(),
      isDirty: z.boolean(),
      runId: z.string(),
    }),
    outSchema: z.union([dispatchTerminalScriptPayloadSchema, dispatchTerminalScriptPayloadSnakeSchema]),
  },
  writeTerminalInput: {
    inSchema: z.object({
      sessionId: z.string(),
      data: z.string(),
    }),
    outSchema: zTauriVoid,
  },
  resizeTerminalSession: {
    inSchema: z.object({
      sessionId: z.string(),
      cols: z.number().int().min(1),
      rows: z.number().int().min(1),
    }),
    outSchema: zTauriVoid,
  },
  closeTerminalSession: {
    inSchema: z.object({
      sessionId: z.string(),
    }),
    outSchema: zTauriVoid,
  },
} as const;