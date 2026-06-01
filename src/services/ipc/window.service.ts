import { z } from 'zod';
import { commands, type SetWindowBackgroundInput, type WindowStage } from '@/bindings/tauri';
import { defineIpc, zTauriVoid } from '@/services/tauri.contracts';

export type TSetWindowBackgroundRequest = Omit<SetWindowBackgroundInput, 'label' | 'a'> &
  Partial<Pick<SetWindowBackgroundInput, 'a'>> & {
    readonly label?: string | null;
  };

export type TWindowStageRequest = {
  readonly stage: WindowStage;
};

const windowStageRequestSchema = z.object({
  stage: z.enum(['main']),
});

const applyWindowStageIpc = defineIpc({
  name: 'apply_window_stage',
  guardHint: 'apply window stage',
  inSchema: windowStageRequestSchema,
  outSchema: zTauriVoid,
  timeoutMs: 1_000,
  idempotent: true,
  audit: 'info',
  mapArgs: (input) => ({ stage: input.stage }),
});

const setWindowBackgroundRequestSchema = z.object({
  label: z.string().nullable().optional(),
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  a: z.number().int().min(0).max(255).optional(),
});

const toWindowBackgroundInput = (input: TSetWindowBackgroundRequest): SetWindowBackgroundInput => ({
  label: input.label ?? null,
  r: input.r,
  g: input.g,
  b: input.b,
  a: input.a ?? 255,
});

const setWindowBackgroundIpc = defineIpc({
  name: 'set_window_background',
  guardHint: 'sync native window background',
  inSchema: setWindowBackgroundRequestSchema,
  outSchema: zTauriVoid,
  timeoutMs: 1_000,
  idempotent: true,
  audit: 'none',
  mapArgs: (input, context) => ({
    input: toWindowBackgroundInput(input),
    traceId: context.traceId,
  }),
});

/**
 * Keeps the native window background in sync with the WebView surface background.
 */
export const setWindowBackground = (input: TSetWindowBackgroundRequest): Promise<void> =>
  setWindowBackgroundIpc(input);

/**
 * 由 Rust 窗口阶段命令统一收口主窗口显示时机。
 */
export const applyWindowStage = (input: TWindowStageRequest): Promise<void> =>
  applyWindowStageIpc(input);
