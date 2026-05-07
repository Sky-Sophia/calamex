import { ipc } from '@/services/ipc';
import { zTauriVoid } from '@/services/tauri.contracts';
import { z } from 'zod';

export const WindowStageInput = z.object({
  stage: z.enum(['main']),
});

export const SetWindowBackgroundInput = z.object({
  label: z.string().min(1).optional(),
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255).default(255),
});

const SetWindowBackgroundOutput = zTauriVoid;
const WindowStageOutput = zTauriVoid;

export type TSetWindowBackgroundInput = z.infer<typeof SetWindowBackgroundInput>;
export type TSetWindowBackgroundRequest = z.input<typeof SetWindowBackgroundInput>;
export type TWindowStageRequest = z.input<typeof WindowStageInput>;

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
 * 由 Rust 窗口阶段命令统一收口主窗口显示时机。
 *
 * @throws AppError(scope="ipc")
 */
export const applyWindowStage = (input: TWindowStageRequest): Promise<void> =>
  ipc('apply_window_stage', input, WindowStageInput, WindowStageOutput, {
    timeoutMs: 1_000,
    guardHint: 'apply window stage',
    idempotent: true,
    mapArgs: (payload) => ({ stage: payload.stage }),
  });
