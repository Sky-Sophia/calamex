import type {
  ITerminalBufferDiagnostic,
  ITerminalDataEvent,
  ITerminalRunHandle,
  ITerminalStateChangedPayload,
  ITerminalVisualWritePayload,
  TTerminalCancelMode,
  TTerminalDataSource,
  TTerminalInputRoute,
  TTerminalRuntimeState,
} from '@/types/terminal';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type { TTerminalInputRoute };

// ---------------------------------------------------------------------------
// Public diagnostic shapes
// ---------------------------------------------------------------------------

export interface ITerminalFrameDiagnostic {
  index: number;
  at: string;
  source: TTerminalDataSource | 'unknown';
  seq: number | null;
  runId: string | null;
  runSeq: number | null;
  bytes: number;
  preview: string;
}

export interface ITerminalFlowDiagnostics {
  runChunkCount: number;
  runChunkBytes: number;
  terminalDataChunks: number;
  terminalDataBytes: number;
  visualWriteChunks: number;
  visualWriteBytes: number;
  injectedResetEvents: number;
  injectedSeparatorEvents: number;
  lastTerminalDataSeq: number | null;
  recentTerminalData: ITerminalFrameDiagnostic[];
  recentVisualWrites: ITerminalFrameDiagnostic[];
  bufferDiagnostics: ITerminalBufferDiagnostic[];
  preRunTerminalData: ITerminalFrameDiagnostic[];
  preRunVisualWrites: ITerminalFrameDiagnostic[];
  preRunBufferDiagnostics: ITerminalBufferDiagnostic[];
  inputEvents: number;
  droppedInputEvents: number;
  lastInputRoute: TTerminalInputRoute | null;
  lastEventName: string | null;
  lastEventAt: string | null;
  lastRunId: string | null;
  lastExitCode: number | null;
  lastCompletedAt: string | null;
  cancelRequestedAt: string | null;
  cancelMode: TTerminalCancelMode | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_FRAMES = 12;
const MAX_BUFFER_DIAGNOSTICS = 24;
const FRAME_PREVIEW_MAX_LENGTH = 120;

const INJECTED_RESET_SOURCE: TTerminalDataSource = 'injected_reset';
const INJECTED_SEPARATOR_SOURCE: TTerminalDataSource = 'injected_separator';

const ANSI_ESCAPE_CHARACTER_PATTERN = new RegExp(String.fromCharCode(27), 'gu');

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();

const numericOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const measureBytes = (value: string | Uint8Array): number => {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }
  return textEncoder ? textEncoder.encode(value).length : value.length;
};

const previewFrameData = (value: string): string =>
  value
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replace(ANSI_ESCAPE_CHARACTER_PATTERN, '\\x1b')
    .slice(0, FRAME_PREVIEW_MAX_LENGTH);

/** Push `item` then trim the head to keep `target.length <= maxSize`. */
const appendCapped = <T>(target: T[], item: T, maxSize: number): void => {
  target.push(item);
  if (target.length > maxSize) {
    target.splice(0, target.length - maxSize);
  }
};

const createFrameDiagnostic = (
  payload: ITerminalDataEvent | ITerminalVisualWritePayload,
  index: number,
): ITerminalFrameDiagnostic => ({
  index,
  at: nowIso(),
  source: payload.source ?? 'unknown',
  seq: numericOrNull(payload.seq),
  runId: payload.runId ?? null,
  runSeq: numericOrNull(payload.runSeq),
  bytes: measureBytes(payload.data),
  preview: previewFrameData(payload.data),
});

const pushRecentFrame = (
  target: ITerminalFrameDiagnostic[],
  payload: ITerminalDataEvent | ITerminalVisualWritePayload,
  index: number,
): void => {
  appendCapped(target, createFrameDiagnostic(payload, index), MAX_RECENT_FRAMES);
};

const mergeRunHandle = (
  current: ITerminalRunHandle,
  next: ITerminalRunHandle,
): ITerminalRunHandle => ({
  runId: next.runId,
  sessionId: next.sessionId || current.sessionId,
  cwd: next.cwd || current.cwd,
  commandLine: next.commandLine || current.commandLine,
  // Only adopt next.usedTempFile if next carries fresh command/cwd context.
  usedTempFile:
    next.commandLine || next.cwd ? next.usedTempFile : current.usedTempFile,
  startedAt: next.startedAt || current.startedAt,
  startedAtMs: next.startedAtMs ?? current.startedAtMs,
  pid: next.pid ?? current.pid ?? null,
});

const createEmptyDiagnostics = (): ITerminalFlowDiagnostics => ({
  runChunkCount: 0,
  runChunkBytes: 0,
  terminalDataChunks: 0,
  terminalDataBytes: 0,
  visualWriteChunks: 0,
  visualWriteBytes: 0,
  injectedResetEvents: 0,
  injectedSeparatorEvents: 0,
  lastTerminalDataSeq: null,
  recentTerminalData: [],
  recentVisualWrites: [],
  bufferDiagnostics: [],
  preRunTerminalData: [],
  preRunVisualWrites: [],
  preRunBufferDiagnostics: [],
  inputEvents: 0,
  droppedInputEvents: 0,
  lastInputRoute: null,
  lastEventName: null,
  lastEventAt: null,
  lastRunId: null,
  lastExitCode: null,
  lastCompletedAt: null,
  cancelRequestedAt: null,
  cancelMode: null,
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTerminalRuntimeStore = defineStore('terminal-runtime', () => {
  // -- state -----------------------------------------------------------------

  const state = ref<TTerminalRuntimeState>('booting');
  const activeRun = ref<ITerminalRunHandle | null>(null);
  const interactiveReady = ref(false);
  const showRunSeparator = ref(true);
  const deepDiagnosticsEnabled = ref(false);
  const diagnostics = ref<ITerminalFlowDiagnostics>(createEmptyDiagnostics());

  // -- getters ---------------------------------------------------------------

  const isRunning = computed(() => state.value === 'running');

  // -- diagnostic markers ----------------------------------------------------

  const markEvent = (eventName: string): void => {
    if (!deepDiagnosticsEnabled.value) return;
    diagnostics.value.lastEventName = eventName;
    diagnostics.value.lastEventAt = nowIso();
  };

  // -- interactive lifecycle -------------------------------------------------

  const markInteractiveReady = (): void => {
    interactiveReady.value = true;
    markEvent('terminal:interactive-ready');
  };

  const markInteractiveExited = (): void => {
    interactiveReady.value = false;
    markEvent('terminal:interactive-exited');
  };

  // -- run lifecycle ---------------------------------------------------------

  const markSwitchingToRun = (): void => {
    state.value = 'switching_to_run';
    markEvent('terminal:switching-to-run');
  };

  const markRunStarted = (run: ITerminalRunHandle): void => {
    // Same run id arriving again — patch the handle and bump diagnostics.
    if (activeRun.value?.runId === run.runId) {
      activeRun.value = mergeRunHandle(activeRun.value, run);
      diagnostics.value.lastRunId = run.runId;
      markEvent('terminal:run-started');
      return;
    }

    // New run — snapshot current "recent" buffers as the pre-run history,
    // then start fresh diagnostics.
    const preRunTerminalData = diagnostics.value.recentTerminalData.slice();
    const preRunVisualWrites = diagnostics.value.recentVisualWrites.slice();
    const preRunBufferDiagnostics = diagnostics.value.bufferDiagnostics.slice();

    activeRun.value = run;
    diagnostics.value = {
      ...createEmptyDiagnostics(),
      preRunTerminalData,
      preRunVisualWrites,
      preRunBufferDiagnostics,
      lastRunId: run.runId,
      lastEventName: 'terminal:run-started',
      lastEventAt: nowIso(),
    };
  };

  const updateActiveRun = (run: ITerminalRunHandle): void => {
    if (activeRun.value?.runId !== run.runId) return;
    activeRun.value = mergeRunHandle(activeRun.value, run);
  };

  const markSwitchingToIdle = (): void => {
    if (!activeRun.value) return;
    state.value = 'switching_to_idle';
    markEvent('terminal:switching-to-idle');
  };

  const markRunCompleted = (
    runId: string,
    exitCode: number | null,
    finishedAt: string,
  ): void => {
    if (activeRun.value?.runId === runId) {
      activeRun.value = null;
    }
    diagnostics.value.lastRunId = runId;
    diagnostics.value.lastExitCode = exitCode;
    diagnostics.value.lastCompletedAt = finishedAt;
    markEvent('terminal:run-completed');
  };

  const applyStateChanged = (payload: ITerminalStateChangedPayload): void => {
    state.value = payload.to;
    if (payload.to === 'idle_interactive') {
      interactiveReady.value = true;
    } else if (payload.to === 'booting') {
      interactiveReady.value = false;
    }
    markEvent(`terminal:state-changed:${payload.from}->${payload.to}`);
  };

  // -- raw data ingest -------------------------------------------------------

  const recordTerminalData = (payload: ITerminalDataEvent): void => {
    if (!deepDiagnosticsEnabled.value) return;

    diagnostics.value.terminalDataChunks += 1;
    diagnostics.value.terminalDataBytes += measureBytes(payload.data);
    diagnostics.value.lastTerminalDataSeq = numericOrNull(payload.seq);

    pushRecentFrame(
      diagnostics.value.recentTerminalData,
      payload,
      diagnostics.value.terminalDataChunks,
    );

    if (payload.source === INJECTED_RESET_SOURCE) {
      diagnostics.value.injectedResetEvents += 1;
    } else if (payload.source === INJECTED_SEPARATOR_SOURCE) {
      diagnostics.value.injectedSeparatorEvents += 1;
    }

    markEvent(payload.source ? `terminal:data:${payload.source}` : 'terminal:data');
  };

  const recordVisualWrite = (payload: ITerminalVisualWritePayload): void => {
    if (!deepDiagnosticsEnabled.value) return;

    diagnostics.value.visualWriteChunks += 1;
    diagnostics.value.visualWriteBytes += measureBytes(payload.data);

    pushRecentFrame(
      diagnostics.value.recentVisualWrites,
      payload,
      diagnostics.value.visualWriteChunks,
    );

    markEvent(payload.source ? `xterm:write:${payload.source}` : 'xterm:write');
  };

  const recordBufferDiagnostic = (payload: ITerminalBufferDiagnostic): void => {
    if (!deepDiagnosticsEnabled.value) return;
    appendCapped(diagnostics.value.bufferDiagnostics, payload, MAX_BUFFER_DIAGNOSTICS);
    markEvent(`xterm:buffer:${payload.label}`);
  };

  const recordRunChunk = (runId: string, data: string): void => {
    if (!deepDiagnosticsEnabled.value) return;
    diagnostics.value.lastRunId = runId;
    diagnostics.value.runChunkCount += 1;
    diagnostics.value.runChunkBytes += measureBytes(data);
    markEvent('terminal:run-chunk');
  };

  const recordCancelRequested = (mode: TTerminalCancelMode): void => {
    if (!deepDiagnosticsEnabled.value) return;
    diagnostics.value.cancelMode = mode;
    diagnostics.value.cancelRequestedAt = nowIso();
    markEvent('cancel_terminal_run');
  };

  const recordInputRoute = (
    route: TTerminalInputRoute,
    data: Uint8Array,
  ): void => {
    if (!deepDiagnosticsEnabled.value) return;
    diagnostics.value.inputEvents += 1;
    diagnostics.value.lastInputRoute = route;
    if (route === 'dropped') {
      diagnostics.value.droppedInputEvents += 1;
    }
    markEvent(`terminal:input:${route}:${measureBytes(data)}`);
  };

  // -- toggles & reset -------------------------------------------------------

  const setRunSeparatorVisible = (visible: boolean): void => {
    showRunSeparator.value = visible;
    markEvent(
      visible ? 'terminal:separator-visible' : 'terminal:separator-hidden',
    );
  };

  const setDeepDiagnosticsEnabled = (enabled: boolean): void => {
    deepDiagnosticsEnabled.value = enabled;
    // markEvent is gated by the flag, so this only stamps when enabling.
    markEvent('terminal:diagnostics-enabled');
  };

  const reset = (): void => {
    state.value = 'booting';
    activeRun.value = null;
    interactiveReady.value = false;
    diagnostics.value = createEmptyDiagnostics();
  };

  return {
    state,
    activeRun,
    interactiveReady,
    showRunSeparator,
    deepDiagnosticsEnabled,
    diagnostics,
    isRunning,
    markInteractiveReady,
    markInteractiveExited,
    markSwitchingToRun,
    markRunStarted,
    updateActiveRun,
    markSwitchingToIdle,
    markRunCompleted,
    applyStateChanged,
    recordTerminalData,
    recordVisualWrite,
    recordBufferDiagnostic,
    recordRunChunk,
    recordCancelRequested,
    recordInputRoute,
    setRunSeparatorVisible,
    setDeepDiagnosticsEnabled,
    reset,
  };
});