import { commands, type SetWindowBackgroundInput, type WindowStage } from '@/bindings/tauri';
import { AppError, isAppError } from '@/types/app-error';
import { assertDesktopRuntime } from '@/utils/desktop-runtime';
import { toErrorMessage } from '@/utils/error';

type TSpectaCommandOptions = {
  readonly guardHint: string;
  readonly timeoutMs: number;
};

export type TSetWindowBackgroundRequest = Omit<SetWindowBackgroundInput, 'label' | 'a'> &
  Partial<Pick<SetWindowBackgroundInput, 'a'>> & {
    readonly label?: string | null;
  };
export type TWindowStageRequest = {
  readonly stage: WindowStage;
};

const createTraceId = (): string => {
  return crypto.randomUUID();
};

const normalizeSpectaIpcError = (error: unknown, traceId: string): AppError => {
  if (isAppError(error)) {
    return error;
  }

  return new AppError({
    code: 'ipc.invoke-failed',
    message: toErrorMessage(error, `IPC 调用失败，已记录 traceId=${traceId}。`),
    scope: 'ipc',
    traceId,
    cause: error,
  });
};

const runSpectaCommand = async <T>(
  options: TSpectaCommandOptions,
  run: (traceId: string) => Promise<T>,
): Promise<T> => {
  const traceId = createTraceId();
  await assertDesktopRuntime(options.guardHint);

  try {
    return await run(traceId);
  } catch (error) {
    throw normalizeSpectaIpcError(error, traceId);
  }
};

const withTimeout = async <T>(
  promise: Promise<T>,
  options: { timeoutMs: number; traceId: string },
): Promise<T> => {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);

  return new Promise<T>((resolve, reject) => {
    const handleTimeout = (): void => {
      reject(
        new AppError({
          code: 'ipc.timeout',
          message: `IPC 调用超时，已记录 traceId=${options.traceId}。`,
          scope: 'ipc',
          traceId: options.traceId,
        }),
      );
    };

    timeoutSignal.addEventListener('abort', handleTimeout, { once: true });
    promise.then(
      (value) => {
        timeoutSignal.removeEventListener('abort', handleTimeout);
        resolve(value);
      },
      (error: unknown) => {
        timeoutSignal.removeEventListener('abort', handleTimeout);
        reject(error);
      },
    );
  });
};

const toWindowBackgroundInput = (input: TSetWindowBackgroundRequest): SetWindowBackgroundInput => ({
  label: input.label ?? null,
  r: input.r,
  g: input.g,
  b: input.b,
  a: input.a ?? 255,
});

/**
 * Keeps the native window background in sync with the WebView surface background.
 *
 * @throws AppError(scope="ipc")
 */
export const setWindowBackground = (input: TSetWindowBackgroundRequest): Promise<void> =>
  runSpectaCommand(
    { timeoutMs: 1_000, guardHint: 'sync native window background' },
    async (traceId) => {
      await withTimeout(commands.setWindowBackground(toWindowBackgroundInput(input), traceId), {
        timeoutMs: 1_000,
        traceId,
      });
    },
  );

/**
 * 由 Rust 窗口阶段命令统一收口主窗口显示时机。
 *
 * @throws AppError(scope="ipc")
 */
export const applyWindowStage = (input: TWindowStageRequest): Promise<void> =>
  runSpectaCommand({ timeoutMs: 1_000, guardHint: 'apply window stage' }, async (traceId) => {
    await withTimeout(commands.applyWindowStage(input.stage), { timeoutMs: 1_000, traceId });
  });
