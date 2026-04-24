import { useMessage } from '@/composables/useMessage';
import { tauriService } from '@/services/tauri';
import type { useEditorStore } from '@/store/editor';
import { useTerminalRegistryStore } from '@/terminal/registry';
import type { IEditorDocument } from '@/types/editor';
import {
  DEFAULT_TERMINAL_SESSION_ID,
  type IDispatchTerminalScriptRequest,
  type ITerminalRunCompletePayload,
  type ITerminalRunOutputEvent,
} from '@/types/terminal';
import { toErrorMessage } from '@/utils/error';
import { DEFAULT_EXECUTOR, getExecutorLabel } from '@/utils/templates';
import {
  TERMINAL_RUN_LOG_CODES,
  TERMINAL_RUN_LOG_TITLES,
  buildDispatchedTerminalRunSummary,
  buildPendingTerminalRunSummary,
  buildTerminalRunCompletionDetail,
  buildTerminalRunHistoryEntry,
  buildTerminalRunResult,
  createActiveTerminalRunMeta,
  createTerminalRunId,
  type IActiveTerminalRunMeta,
} from '@/utils/terminal-run';
import { onScopeDispose, type ComputedRef } from 'vue';

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 28;
const TERMINAL_OUTPUT_BATCH_INTERVAL_MS = 120;
const TERMINAL_RUN_COMPLETION_TIMEOUT_MS = 30 * 60 * 1000;

type TEditorStore = ReturnType<typeof useEditorStore>;

type TUseTerminalRunOptions = {
  canRun: ComputedRef<boolean>;
  editorStore: TEditorStore;
};

const isTextDocument = (document: IEditorDocument): boolean => document.kind === 'text';

const shouldDispatchDocumentContent = (document: IEditorDocument): boolean =>
  document.isDirty || !document.path;

const buildTerminalDispatchRequest = (
  document: IEditorDocument,
  runId: string,
): IDispatchTerminalScriptRequest => ({
  sessionId: DEFAULT_TERMINAL_SESSION_ID,
  path: document.path,
  content: shouldDispatchDocumentContent(document) ? document.content : '',
  isDirty: document.isDirty,
  runId,
});

export const useTerminalRun = ({ canRun, editorStore }: TUseTerminalRunOptions) => {
  const notifier = useMessage();
  const terminalRegistryStore = useTerminalRegistryStore();

  let bufferedTerminalOutput = '';
  let bufferedTerminalOutputTimerId: number | null = null;
  let terminalRunFallbackTimerId: number | null = null;
  let isDisposed = false;
  let activeTerminalRunMeta: IActiveTerminalRunMeta | null = null;
  let hasEnsuredTerminalSession = false;

  const clearBufferedTerminalOutputTimer = (): void => {
    if (bufferedTerminalOutputTimerId === null) {
      return;
    }

    window.clearTimeout(bufferedTerminalOutputTimerId);
    bufferedTerminalOutputTimerId = null;
  };

  const clearTerminalRunFallbackTimer = (): void => {
    if (terminalRunFallbackTimerId === null) {
      return;
    }

    window.clearTimeout(terminalRunFallbackTimerId);
    terminalRunFallbackTimerId = null;
  };

  const flushBufferedTerminalOutput = (): void => {
    clearBufferedTerminalOutputTimer();

    if (!bufferedTerminalOutput) {
      return;
    }

    if (isDisposed) {
      bufferedTerminalOutput = '';
      return;
    }

    editorStore.appendTerminalOutput(bufferedTerminalOutput);
    bufferedTerminalOutput = '';
  };

  const resetBufferedTerminalOutput = (): void => {
    clearBufferedTerminalOutputTimer();
    bufferedTerminalOutput = '';
  };

  const clearActiveTerminalRunState = (): void => {
    editorStore.setPendingTerminalRunId(null);
    editorStore.setActiveRunSummary(null);
    editorStore.isRunning = false;
    activeTerminalRunMeta = null;
  };

  const appendRunLifecycleLog = (
    level: 'info' | 'success' | 'error',
    title: string,
    detail: string,
    runId: string | null,
    code: string,
  ): void => {
    editorStore.appendLog(level, title, detail, {
      scope: 'run',
      runId,
      code,
    });
  };

  const getCurrentTerminalRunId = (): string | null =>
    activeTerminalRunMeta?.runId
    ?? editorStore.pendingTerminalRunId
    ?? editorStore.activeRunSummary?.runId
    ?? null;

  const resolveTerminalRunId = (runId: string | null | undefined): string | null => {
    const normalizedRunId = typeof runId === 'string' ? runId.trim() : '';
    if (
      normalizedRunId
      && (
        editorStore.pendingTerminalRunId === normalizedRunId
        || activeTerminalRunMeta?.runId === normalizedRunId
        || editorStore.activeRunSummary?.runId === normalizedRunId
      )
    ) {
      return normalizedRunId;
    }

    if (!normalizedRunId) {
      return getCurrentTerminalRunId();
    }

    return null;
  };

  const isCurrentTerminalRun = (runId: string | null | undefined): boolean =>
    resolveTerminalRunId(runId) !== null;

  const failTerminalRun = (
    title: string,
    errorOrMessage: unknown,
    fallbackMessage: string,
    logCode: string,
    options: {
      writeMessageToTerminalOutput?: boolean;
    } = {},
  ): void => {
    const message =
      typeof errorOrMessage === 'string'
        ? errorOrMessage
        : toErrorMessage(errorOrMessage, fallbackMessage);
    const failedRunId = getCurrentTerminalRunId();

    resetBufferedTerminalOutput();
    clearTerminalRunFallbackTimer();
    clearActiveTerminalRunState();

    if (options.writeMessageToTerminalOutput) {
      editorStore.setTerminalOutput(message);
    }

    appendRunLifecycleLog('error', title, message, failedRunId, logCode);
    notifier.error(message);
  };

  const scheduleTerminalRunCompletionTimeout = (runId: string): void => {
    clearTerminalRunFallbackTimer();
    terminalRunFallbackTimerId = window.setTimeout(() => {
      terminalRunFallbackTimerId = null;

      if (isDisposed || !isCurrentTerminalRun(runId)) {
        return;
      }

      failTerminalRun(
        TERMINAL_RUN_LOG_TITLES.timeout,
        '终端运行超时，已停止等待完成事件，请检查终端状态。',
        TERMINAL_RUN_LOG_TITLES.timeout,
        TERMINAL_RUN_LOG_CODES.timeout,
      );
    }, TERMINAL_RUN_COMPLETION_TIMEOUT_MS);
  };

  const ensureIntegratedTerminalSession = async (): Promise<void> => {
    await tauriService.ensureTerminalSession({
      sessionId: DEFAULT_TERMINAL_SESSION_ID,
      cwd: null,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
    });
    hasEnsuredTerminalSession = true;
  };

  const ensureIntegratedTerminalEventBridge = async (): Promise<void> => {
    const session = terminalRegistryStore.get(DEFAULT_TERMINAL_SESSION_ID);
    if (!session) {
      return;
    }

    await session.registerEventListeners();
  };

  const ensureIntegratedTerminalSessionBeforeDispatch = async (): Promise<void> => {
    await ensureIntegratedTerminalEventBridge();

    if (hasEnsuredTerminalSession) {
      return;
    }

    await ensureIntegratedTerminalSession();
  };

  const shouldReconnectIntegratedTerminal = (error: unknown): boolean => {
    const message = toErrorMessage(error, '');
    return message.includes('目标终端会话不存在');
  };

  const dispatchScriptToIntegratedTerminal = async (document: IEditorDocument, runId: string) => {
    await ensureIntegratedTerminalSessionBeforeDispatch();
    const dispatchRequest = buildTerminalDispatchRequest(document, runId);

    try {
      return await tauriService.dispatchScriptToTerminal(dispatchRequest);
    } catch (error) {
      if (!shouldReconnectIntegratedTerminal(error)) {
        throw error;
      }

      hasEnsuredTerminalSession = false;
      await ensureIntegratedTerminalSession();
      return tauriService.dispatchScriptToTerminal(dispatchRequest);
    }
  };

  const primeTerminalRun = (document: IEditorDocument): string => {
    const runId = createTerminalRunId();
    const startedAt = new Date().toISOString();
    const usedTempFile = document.isDirty || !document.path;

    editorStore.setPendingTerminalRunId(runId);
    editorStore.setActiveRunSummary(
      buildPendingTerminalRunSummary(document, runId, startedAt, DEFAULT_EXECUTOR, usedTempFile),
    );
    resetBufferedTerminalOutput();
    editorStore.lastRunResult = null;
    editorStore.setTerminalOutput('');
    activeTerminalRunMeta = createActiveTerminalRunMeta(runId, startedAt, 'bash', usedTempFile);
    appendRunLifecycleLog(
      'info',
      TERMINAL_RUN_LOG_TITLES.start,
      `当前脚本将使用 ${getExecutorLabel(DEFAULT_EXECUTOR)} 执行。`,
      runId,
      TERMINAL_RUN_LOG_CODES.start,
    );
    scheduleTerminalRunCompletionTimeout(runId);

    return runId;
  };

  const runScriptInIntegratedTerminal = async (document: IEditorDocument): Promise<void> => {
    if (!isTextDocument(document)) {
      throw new Error('当前文档不是可执行脚本文本。');
    }

    const runId = primeTerminalRun(document);

    try {
      const dispatchResult = await dispatchScriptToIntegratedTerminal(document, runId);
      if (isDisposed || !isCurrentTerminalRun(runId)) {
        return;
      }

      activeTerminalRunMeta = createActiveTerminalRunMeta(
        runId,
        dispatchResult.startedAt,
        dispatchResult.commandLine,
        dispatchResult.usedTempFile,
      );
      editorStore.setActiveRunSummary(
        buildDispatchedTerminalRunSummary(document, activeTerminalRunMeta, DEFAULT_EXECUTOR),
      );
      appendRunLifecycleLog(
        'success',
        TERMINAL_RUN_LOG_TITLES.dispatched,
        dispatchResult.commandLine,
        runId,
        TERMINAL_RUN_LOG_CODES.dispatched,
      );

      if (dispatchResult.usedTempFile) {
        appendRunLifecycleLog(
          'info',
          TERMINAL_RUN_LOG_TITLES.tempFile,
          '当前内容已写入临时 shell 脚本文件后执行。',
          runId,
          TERMINAL_RUN_LOG_CODES.tempFile,
        );
      }

      notifier.success('脚本已发送到集成终端。');
    } catch (error) {
      if (isDisposed || !isCurrentTerminalRun(runId)) {
        return;
      }

      failTerminalRun(
        '脚本执行失败',
        error,
        '脚本执行失败',
        TERMINAL_RUN_LOG_CODES.failed,
        {
          writeMessageToTerminalOutput: true,
        },
      );
    }
  };

  const finalizeTerminalRun = (payload: ITerminalRunCompletePayload): void => {
    const resolvedRunId = resolveTerminalRunId(payload.runId);
    if (isDisposed || !resolvedRunId) {
      return;
    }

    const normalizedPayload =
      payload.runId === resolvedRunId ? payload : { ...payload, runId: resolvedRunId };
    const activeRunSummary = editorStore.activeRunSummary;

    clearTerminalRunFallbackTimer();
    flushBufferedTerminalOutput();

    const runResult = buildTerminalRunResult({
      output: editorStore.getTerminalOutputSnapshot(),
      exitCode: normalizedPayload.exitCode,
      finishedAt: normalizedPayload.finishedAt,
      executor: DEFAULT_EXECUTOR,
      activeRunMeta: activeTerminalRunMeta,
      activeRunSummary,
    });

    editorStore.lastRunResult = runResult;
    editorStore.appendRunHistory(
      buildTerminalRunHistoryEntry(runResult, activeRunSummary, editorStore.document),
    );
    clearActiveTerminalRunState();

    appendRunLifecycleLog(
      runResult.success ? 'success' : 'error',
      runResult.success ? TERMINAL_RUN_LOG_TITLES.completed : TERMINAL_RUN_LOG_TITLES.failed,
      buildTerminalRunCompletionDetail(runResult),
      runResult.runId,
      runResult.success ? TERMINAL_RUN_LOG_CODES.completed : TERMINAL_RUN_LOG_CODES.failed,
    );

    if (runResult.success) {
      notifier.success('脚本执行完成。');
    } else {
      notifier.error('脚本执行失败，请检查终端输出。');
    }
  };

  const handleIntegratedTerminalRunComplete = (payload: ITerminalRunCompletePayload): void => {
    finalizeTerminalRun(payload);
  };

  const runScript = async (): Promise<void> => {
    if (editorStore.isRunning) {
      notifier.warning('已有脚本正在运行，请等待完成或先停止当前运行。');
      return;
    }

    if (!canRun.value) {
      notifier.warning(
        isTextDocument(editorStore.document)
          ? '请先提供可执行脚本内容，并确认当前系统存在可用的 WSL2 运行环境。'
          : '当前打开的是图片预览，无法直接执行。',
      );
      return;
    }

    if (!editorStore.environment.hasAny) {
      notifier.error('当前系统不可用：WSL2。');
      return;
    }

    editorStore.isRunning = true;

    try {
      await runScriptInIntegratedTerminal(editorStore.document);
    } catch (error) {
      failTerminalRun('脚本执行失败', error, '脚本执行失败', TERMINAL_RUN_LOG_CODES.failed, {
        writeMessageToTerminalOutput: true,
      });
    }
  };

  const appendTerminalOutput = (payload: ITerminalRunOutputEvent): void => {
    if (isDisposed || !payload.data || !isCurrentTerminalRun(payload.runId)) {
      return;
    }

    bufferedTerminalOutput += payload.data;
    if (bufferedTerminalOutputTimerId !== null) {
      return;
    }

    bufferedTerminalOutputTimerId = window.setTimeout(() => {
      flushBufferedTerminalOutput();
    }, TERMINAL_OUTPUT_BATCH_INTERVAL_MS);
  };

  onScopeDispose(() => {
    isDisposed = true;
    resetBufferedTerminalOutput();
    clearTerminalRunFallbackTimer();
    clearActiveTerminalRunState();
  });

  return {
    runScript,
    appendTerminalOutput,
    handleIntegratedTerminalRunComplete,
  };
};
