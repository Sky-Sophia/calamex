import { tauriService } from '@/services/tauri';
import { useTerminalRuntimeStore } from '@/services/terminal/state';
import { getTerminalEventBus, type ITerminalEventBus } from '@/services/terminal/eventBus';
import { createTerminalRunStore, type TerminalRunStore } from '@/services/terminal/runStore';
import type { ITauriService } from '@/types/tauri';
import {
  DEFAULT_TERMINAL_SESSION_ID,
  type IDispatchTerminalScriptRequest,
  type ITerminalDataEvent,
  type ITerminalRunHandle,
  type ITerminalRunStartedPayload,
  type TTerminalCancelMode,
  type TTerminalRuntimeState,
} from '@/types/terminal';
import { storeToRefs } from 'pinia';
import { readonly, type DeepReadonly, type Ref } from 'vue';

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 28;
const SWITCHING_INPUT_BUFFER_MS = 200;

export type TTerminalDataHandler = (payload: ITerminalDataEvent) => void;
export type TTerminalUnsubscribe = () => void;

export interface ITerminalFacade {
  ensureView(epoch: string): Promise<void>;
  dispatchScript(spec: IDispatchTerminalScriptRequest): Promise<ITerminalRunHandle>;
  cancelRun(runId: string, mode: TTerminalCancelMode): Promise<void>;
  writeInput(sessionId: string, data: Uint8Array): Promise<void>;
  writeInputForCurrentState(data: Uint8Array): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  routeInput(
    state: TTerminalRuntimeState,
    activeRun: ITerminalRunHandle | null,
  ): string | null;
  onTerminalData(handler: TTerminalDataHandler): TTerminalUnsubscribe;
  dispose(): void;
  readonly state: DeepReadonly<Ref<TTerminalRuntimeState>>;
  readonly activeRun: DeepReadonly<Ref<ITerminalRunHandle | null>>;
  readonly interactiveReady: DeepReadonly<Ref<boolean>>;
}

export interface ITerminalFacadeOptions {
  tauri?: Pick<
    ITauriService,
    | 'ensureTerminalSession'
    | 'dispatchScriptToTerminal'
    | 'cancelTerminalRun'
    | 'writeTerminalInput'
    | 'resizeTerminalSession'
  >;
  eventBus?: ITerminalEventBus;
  runStore?: TerminalRunStore;
  sessionId?: string;
}

export const useTerminalFacade = (options: ITerminalFacadeOptions = {}): ITerminalFacade => {
  const runtimeStore = useTerminalRuntimeStore();
  const { state, activeRun, interactiveReady } = storeToRefs(runtimeStore);
  const tauri = options.tauri ?? tauriService;
  const eventBus = options.eventBus ?? getTerminalEventBus();
  const runStore = options.runStore ?? createTerminalRunStore();
  const interactiveSessionId = options.sessionId ?? DEFAULT_TERMINAL_SESSION_ID;
  const terminalDataHandlers = new Set<TTerminalDataHandler>();
  const switchingInputBuffer: Uint8Array[] = [];
  let eventBridgeStarted = false;
  let inputBufferTimerId: number | null = null;
  let terminalDataUnlisten: TTerminalUnsubscribe | null = null;
  let runChunkUnlisten: TTerminalUnsubscribe | null = null;
  let runStartedUnlisten: TTerminalUnsubscribe | null = null;
  let runCompletedUnlisten: TTerminalUnsubscribe | null = null;
  let interactiveReadyUnlisten: TTerminalUnsubscribe | null = null;
  let interactiveExitedUnlisten: TTerminalUnsubscribe | null = null;
  let stateChangedUnlisten: TTerminalUnsubscribe | null = null;
  let eventBridgePromise: Promise<void> | null = null;
  const pendingRunHandles = new Map<string, ITerminalRunHandle>();
  const pendingRunStartedPayloads = new Map<string, ITerminalRunStartedPayload>();

  const buildRunStartedHandle = (
    payload: ITerminalRunStartedPayload,
    pendingHandle: ITerminalRunHandle | null,
  ): ITerminalRunHandle => ({
    runId: payload.runId,
    sessionId: payload.sessionId,
    cwd: pendingHandle?.cwd ?? '',
    commandLine: pendingHandle?.commandLine ?? '',
    usedTempFile: pendingHandle?.usedTempFile ?? false,
    startedAt: pendingHandle?.startedAt ?? new Date(payload.startedAtMs).toISOString(),
    startedAtMs: payload.startedAtMs,
    pid: payload.pid,
  });

  const activateStartedRun = (payload: ITerminalRunStartedPayload): void => {
    const pendingHandle = pendingRunHandles.get(payload.runId) ?? null;
    const handle = buildRunStartedHandle(payload, pendingHandle);
    runStore.startRun(handle);
    runtimeStore.markRunStarted(handle);
    pendingRunStartedPayloads.delete(payload.runId);
  };

  const clearInputBufferTimer = (): void => {
    if (inputBufferTimerId === null) {
      return;
    }
    window.clearTimeout(inputBufferTimerId);
    inputBufferTimerId = null;
  };

  const flushSwitchingInputBuffer = async (): Promise<void> => {
    clearInputBufferTimer();
    const targetSessionId = routeInput(state.value, activeRun.value);
    if (!targetSessionId) {
      switchingInputBuffer.length = 0;
      console.warn('[terminal-facade] switching 状态超过缓冲窗口，已丢弃输入。');
      return;
    }

    const queued = switchingInputBuffer.splice(0);
    for (const item of queued) {
      await writeInput(targetSessionId, item);
    }
  };

  const scheduleSwitchingInputFlush = (): void => {
    clearInputBufferTimer();
    inputBufferTimerId = window.setTimeout(() => {
      void flushSwitchingInputBuffer();
    }, SWITCHING_INPUT_BUFFER_MS);
  };

  const ensureEventBridge = async (): Promise<void> => {
    if (eventBridgeStarted) {
      return;
    }
    if (eventBridgePromise) {
      return eventBridgePromise;
    }

    if (!terminalDataUnlisten) {
      terminalDataUnlisten = eventBus.onTerminalData((payload) => {
        for (const handler of terminalDataHandlers) {
          handler(payload);
        }
      });
    }
    if (!runChunkUnlisten) {
      runChunkUnlisten = eventBus.onRunChunk((payload) => {
        runtimeStore.recordRunChunk(payload.runId, payload.data);
        runStore.appendChunk(payload);
      });
    }
    if (!runStartedUnlisten) {
      runStartedUnlisten = eventBus.onRunStarted((payload) => {
        pendingRunStartedPayloads.set(payload.runId, payload);
        activateStartedRun(payload);
      });
    }
    if (!runCompletedUnlisten) {
      runCompletedUnlisten = eventBus.onRunCompleted((payload) => {
        runStore.completeRun(payload);
        runtimeStore.markRunCompleted(payload.runId, payload.exitCode, payload.finishedAt);
        pendingRunHandles.delete(payload.runId);
        pendingRunStartedPayloads.delete(payload.runId);
      });
    }
    if (!interactiveReadyUnlisten) {
      interactiveReadyUnlisten = eventBus.onInteractiveReady(() => {
        runtimeStore.markInteractiveReady();
      });
    }
    if (!interactiveExitedUnlisten) {
      interactiveExitedUnlisten = eventBus.onInteractiveExited((payload) => {
        if (payload.sessionId === interactiveSessionId) {
          runtimeStore.markInteractiveExited();
        }
      });
    }
    if (!stateChangedUnlisten) {
      stateChangedUnlisten = eventBus.onStateChanged((payload) => {
        runtimeStore.applyStateChanged(payload);
        if (switchingInputBuffer.length > 0 && routeInput(state.value, activeRun.value)) {
          void flushSwitchingInputBuffer();
        }
      });
    }
    eventBridgePromise = eventBus.start()
      .then(() => {
        eventBridgeStarted = true;
      })
      .catch((error: unknown) => {
        terminalDataUnlisten?.();
        runChunkUnlisten?.();
        runStartedUnlisten?.();
        runCompletedUnlisten?.();
        interactiveReadyUnlisten?.();
        interactiveExitedUnlisten?.();
        stateChangedUnlisten?.();
        terminalDataUnlisten = null;
        runChunkUnlisten = null;
        runStartedUnlisten = null;
        runCompletedUnlisten = null;
        interactiveReadyUnlisten = null;
        interactiveExitedUnlisten = null;
        stateChangedUnlisten = null;
        throw error;
      })
      .finally(() => {
        eventBridgePromise = null;
      });

    return eventBridgePromise;
  };

  const ensureView = async (epoch: string): Promise<void> => {
    if (!epoch.trim()) {
      throw new Error('终端视图 epoch 不能为空。');
    }

    await ensureEventBridge();
    await tauri.ensureTerminalSession({
      sessionId: interactiveSessionId,
      cwd: null,
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
    });
  };

  const dispatchScript = async (
    spec: IDispatchTerminalScriptRequest,
  ): Promise<ITerminalRunHandle> => {
    await ensureEventBridge();

    try {
      const payload = await tauri.dispatchScriptToTerminal(spec);
      const handle: ITerminalRunHandle = {
        runId: spec.runId,
        sessionId: payload.sessionId,
        cwd: payload.cwd,
        commandLine: payload.commandLine,
        usedTempFile: payload.usedTempFile,
        startedAt: payload.startedAt,
      };
      pendingRunHandles.set(spec.runId, handle);
      runStore.startRun(handle);
      const startedPayload = pendingRunStartedPayloads.get(spec.runId);
      if (startedPayload) {
        activateStartedRun(startedPayload);
      } else {
        runtimeStore.updateActiveRun(handle);
      }
      const completedRecord = runStore.getRecord(spec.runId);
      if (completedRecord?.completedAt) {
        pendingRunHandles.delete(spec.runId);
        return handle;
      }
      return handle;
    } catch (error) {
      runtimeStore.markRunCompleted(spec.runId, null, new Date().toISOString());
      throw error;
    }
  };

  const cancelRun = (runId: string, mode: TTerminalCancelMode): Promise<void> => {
    runtimeStore.recordCancelRequested(mode);
    return tauri.cancelTerminalRun({ runId, mode });
  };

  const writeInput = async (sessionId: string, data: Uint8Array): Promise<void> => {
    const decoder = new TextDecoder();
    await tauri.writeTerminalInput({
      sessionId,
      data: decoder.decode(data),
    });
  };

  const routeInput = (
    currentState: TTerminalRuntimeState,
    currentActiveRun: ITerminalRunHandle | null,
  ): string | null => {
    if (currentState === 'idle_interactive') {
      return interactiveSessionId;
    }

    if (currentState === 'running') {
      return currentActiveRun?.sessionId ?? null;
    }

    return null;
  };

  const writeInputForCurrentState = async (data: Uint8Array): Promise<void> => {
    const targetSessionId = routeInput(state.value, activeRun.value);
    if (targetSessionId) {
      runtimeStore.recordInputRoute(state.value === 'running' ? 'run' : 'interactive', data);
      await writeInput(targetSessionId, data);
      return;
    }

    if (state.value === 'switching_to_run' || state.value === 'switching_to_idle') {
      runtimeStore.recordInputRoute('buffered', data);
      switchingInputBuffer.push(data);
      scheduleSwitchingInputFlush();
      return;
    }

    runtimeStore.recordInputRoute('dropped', data);
    console.warn('[terminal-facade] 终端尚未 ready，已丢弃输入。');
  };

  const resize = (cols: number, rows: number): Promise<void> =>
    tauri.resizeTerminalSession({
      sessionId: interactiveSessionId,
      cols,
      rows,
    });

  const onTerminalData = (handler: TTerminalDataHandler): TTerminalUnsubscribe => {
    terminalDataHandlers.add(handler);
    return () => {
      terminalDataHandlers.delete(handler);
    };
  };

  const dispose = (): void => {
    clearInputBufferTimer();
    switchingInputBuffer.length = 0;
    terminalDataHandlers.clear();
    terminalDataUnlisten?.();
    runChunkUnlisten?.();
    runStartedUnlisten?.();
    runCompletedUnlisten?.();
    interactiveReadyUnlisten?.();
    interactiveExitedUnlisten?.();
    stateChangedUnlisten?.();
    terminalDataUnlisten = null;
    runChunkUnlisten = null;
    runStartedUnlisten = null;
    runCompletedUnlisten = null;
    interactiveReadyUnlisten = null;
    interactiveExitedUnlisten = null;
    stateChangedUnlisten = null;
    pendingRunHandles.clear();
    pendingRunStartedPayloads.clear();
    eventBus.stop();
    eventBridgeStarted = false;
    eventBridgePromise = null;
  };

  return {
    ensureView,
    dispatchScript,
    cancelRun,
    writeInput,
    writeInputForCurrentState,
    resize,
    routeInput,
    onTerminalData,
    dispose,
    state: readonly(state),
    activeRun: readonly(activeRun),
    interactiveReady: readonly(interactiveReady),
  };
};
