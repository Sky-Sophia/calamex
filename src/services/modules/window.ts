import { ipc } from '@/services/ipc';
import { zTauriVoid } from '@/services/tauri.contracts';
import { z } from 'zod';

export const SetWindowBackgroundInput = z.object({
  label: z.string().min(1).optional(),
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255).default(255),
});

const StartupTransitionInput = z.void();
const SetWindowBackgroundOutput = zTauriVoid;
const BeginStartupTransitionOutput = zTauriVoid;
const FinalizeStartupTransitionOutput = zTauriVoid;

export type TSetWindowBackgroundInput = z.infer<typeof SetWindowBackgroundInput>;
export type TSetWindowBackgroundRequest = z.input<typeof SetWindowBackgroundInput>;

/**
 * Keeps the native window background in sync with the WebView surface background.
 *
 * @throws AppError(scope="ipc")
 */
export const setWindowBackground = (input: TSetWindowBackgroundRequest): Promise<void> =>
  ipc('set_window_background', input, SetWindowBackgroundInput, SetWindowBackgroundOutput, {
    timeoutMs: 1_000,
    guardHint: 'sync native window background',
    idempotent: true,
    mapArgs: (payload, { traceId }) => ({ input: payload, traceId }),
  });

/**
 * Hides the standalone welcome window first, then reveals the main window with the
 * startup bridge still mounted in the DOM so the user never sees both windows together.
 */
export const beginStartupTransition = (): Promise<void> =>
  ipc(
    'begin_startup_transition',
    undefined,
    StartupTransitionInput,
    BeginStartupTransitionOutput,
    {
      timeoutMs: 1_000,
      guardHint: 'begin startup transition',
      idempotent: true,
    },
  );

/**
 * Destroys the hidden welcome window after the startup bridge fade has finished.
 */
export const finalizeStartupTransition = (): Promise<void> =>
  ipc(
    'finalize_startup_transition',
    undefined,
    StartupTransitionInput,
    FinalizeStartupTransitionOutput,
    {
      timeoutMs: 1_000,
      guardHint: 'finalize startup transition',
      idempotent: true,
    },
  );
