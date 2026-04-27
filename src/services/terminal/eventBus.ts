import type {
  ITerminalDataEvent,
  ITerminalExitEvent,
  ITerminalRunCompletedPayload,
  ITerminalRunChunkPayload,
  ITerminalRunStartedPayload,
  ITerminalStateChangedPayload,
} from '@/types/terminal';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { z } from 'zod';

export const TERMINAL_DATA_EVENT = 'terminal:data';
export const TERMINAL_RUN_CHUNK_EVENT = 'terminal:run-chunk';
export const TERMINAL_RUN_STARTED_EVENT = 'terminal:run-started';
export const TERMINAL_RUN_COMPLETED_EVENT = 'terminal:run-completed';
export const TERMINAL_INTERACTIVE_READY_EVENT = 'terminal:interactive-ready';
export const TERMINAL_INTERACTIVE_EXITED_EVENT = 'terminal:interactive-exited';
export const TERMINAL_STATE_CHANGED_EVENT = 'terminal:state-changed';

type TEventHandler<TPayload> = (payload: TPayload) => void;

const terminalDataEventSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
  source: z.enum(['interactive', 'run', 'injected_reset', 'injected_separator']).optional(),
  seq: z.number().int().nonnegative().optional(),
  runId: z.string().optional(),
  runSeq: z.number().int().positive().optional(),
});

const terminalRunChunkEventSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  data: z.string(),
  seq: z.number().int().nonnegative().optional(),
});

const terminalRunCompletedEventSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  exitCode: z.number().int().nullable(),
  finishedAt: z.string(),
});

const terminalRunStartedEventSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  startedAtMs: z.number().int().nonnegative(),
  pid: z.number().int().nonnegative(),
});

const terminalRuntimeStateSchema = z.enum([
  'booting',
  'idle_interactive',
  'switching_to_run',
  'running',
  'switching_to_idle',
]);

const terminalStateChangedEventSchema = z.object({
  from: terminalRuntimeStateSchema,
  to: terminalRuntimeStateSchema,
  atMs: z.number().int().nonnegative(),
});

const terminalExitEventSchema = z.object({
  sessionId: z.string(),
  exitCode: z.number().int().nullable(),
});

export interface ITerminalEventBus {
  start(): Promise<void>;
  stop(): void;
  onTerminalData(handler: TEventHandler<ITerminalDataEvent>): UnlistenFn;
  onRunChunk(handler: TEventHandler<ITerminalRunChunkPayload>): UnlistenFn;
  onRunStarted(handler: TEventHandler<ITerminalRunStartedPayload>): UnlistenFn;
  onRunCompleted(handler: TEventHandler<ITerminalRunCompletedPayload>): UnlistenFn;
  onInteractiveReady(handler: TEventHandler<void>): UnlistenFn;
  onInteractiveExited(handler: TEventHandler<ITerminalExitEvent>): UnlistenFn;
  onStateChanged(handler: TEventHandler<ITerminalStateChangedPayload>): UnlistenFn;
}

export type TTerminalListen = typeof listen;

const removeHandler = <TPayload>(
  handlers: Set<TEventHandler<TPayload>>,
  handler: TEventHandler<TPayload>,
): void => {
  handlers.delete(handler);
};

const emitToHandlers = <TPayload>(
  handlers: Set<TEventHandler<TPayload>>,
  payload: TPayload,
): void => {
  for (const handler of handlers) {
    handler(payload);
  }
};

export const createTerminalEventBus = (
  listenFn: TTerminalListen = listen,
): ITerminalEventBus => {
  const terminalDataHandlers = new Set<TEventHandler<ITerminalDataEvent>>();
  const runChunkHandlers = new Set<TEventHandler<ITerminalRunChunkPayload>>();
  const runStartedHandlers = new Set<TEventHandler<ITerminalRunStartedPayload>>();
  const runCompletedHandlers = new Set<TEventHandler<ITerminalRunCompletedPayload>>();
  const interactiveReadyHandlers = new Set<TEventHandler<void>>();
  const interactiveExitedHandlers = new Set<TEventHandler<ITerminalExitEvent>>();
  const stateChangedHandlers = new Set<TEventHandler<ITerminalStateChangedPayload>>();
  let unlisteners: UnlistenFn[] = [];
  let startPromise: Promise<void> | null = null;

  const parseAndEmit = <TPayload>(
    eventName: string,
    schema: z.ZodType<TPayload>,
    handlers: Set<TEventHandler<TPayload>>,
    payload: unknown,
  ): void => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      console.warn(`[terminal-event] ${eventName} payload 校验失败`, parsed.error.flatten());
      return;
    }
    emitToHandlers(handlers, parsed.data);
  };

  const start = (): Promise<void> => {
    if (unlisteners.length > 0) {
      return Promise.resolve();
    }
    if (startPromise) {
      return startPromise;
    }

    startPromise = Promise.all([
      listenFn<unknown>(TERMINAL_DATA_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_DATA_EVENT,
          terminalDataEventSchema,
          terminalDataHandlers,
          payload,
        );
      }),
      listenFn<unknown>(TERMINAL_RUN_CHUNK_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_RUN_CHUNK_EVENT,
          terminalRunChunkEventSchema,
          runChunkHandlers,
          payload,
        );
      }),
      listenFn<unknown>(TERMINAL_RUN_STARTED_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_RUN_STARTED_EVENT,
          terminalRunStartedEventSchema,
          runStartedHandlers,
          payload,
        );
      }),
      listenFn<unknown>(TERMINAL_RUN_COMPLETED_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_RUN_COMPLETED_EVENT,
          terminalRunCompletedEventSchema,
          runCompletedHandlers,
          payload,
        );
      }),
      listenFn<unknown>(TERMINAL_INTERACTIVE_READY_EVENT, () => {
        emitToHandlers(interactiveReadyHandlers, undefined);
      }),
      listenFn<unknown>(TERMINAL_INTERACTIVE_EXITED_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_INTERACTIVE_EXITED_EVENT,
          terminalExitEventSchema,
          interactiveExitedHandlers,
          payload,
        );
      }),
      listenFn<unknown>(TERMINAL_STATE_CHANGED_EVENT, ({ payload }) => {
        parseAndEmit(
          TERMINAL_STATE_CHANGED_EVENT,
          terminalStateChangedEventSchema,
          stateChangedHandlers,
          payload,
        );
      }),
    ]).then((nextUnlisteners) => {
      unlisteners = nextUnlisteners;
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  const stop = (): void => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
    unlisteners = [];
    startPromise = null;
  };

  return {
    start,
    stop,
    onTerminalData(handler) {
      terminalDataHandlers.add(handler);
      return () => removeHandler(terminalDataHandlers, handler);
    },
    onRunChunk(handler) {
      runChunkHandlers.add(handler);
      return () => removeHandler(runChunkHandlers, handler);
    },
    onRunStarted(handler) {
      runStartedHandlers.add(handler);
      return () => removeHandler(runStartedHandlers, handler);
    },
    onRunCompleted(handler) {
      runCompletedHandlers.add(handler);
      return () => removeHandler(runCompletedHandlers, handler);
    },
    onInteractiveReady(handler) {
      interactiveReadyHandlers.add(handler);
      return () => removeHandler(interactiveReadyHandlers, handler);
    },
    onInteractiveExited(handler) {
      interactiveExitedHandlers.add(handler);
      return () => removeHandler(interactiveExitedHandlers, handler);
    },
    onStateChanged(handler) {
      stateChangedHandlers.add(handler);
      return () => removeHandler(stateChangedHandlers, handler);
    },
  };
};

let terminalEventBusSingleton: ITerminalEventBus | null = null;

export const getTerminalEventBus = (): ITerminalEventBus => {
  if (!terminalEventBusSingleton) {
    terminalEventBusSingleton = createTerminalEventBus();
  }
  return terminalEventBusSingleton;
};
