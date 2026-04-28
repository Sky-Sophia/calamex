import { ref } from 'vue';

import { aiService } from '@/services/modules/ai';
import type { IAiCodeActionRequest, IAiCodeActionResult } from '@/types/ai';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TAiCodeActionKind = IAiCodeActionRequest['kind'];

export interface IUseAiCodeActionSelectionOptions {
  filePath?: string | null;
  language?: string;
  diagnostics?: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SELECTION_LANGUAGE = 'text';

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Lightweight wrapper around `aiService.codeAction` that tracks the latest
 * result and a loading flag. Errors are intentionally re-thrown so callers
 * can handle them (e.g. surface a toast or revert UI state).
 */
export const useAiCodeAction = () => {
  const result = ref<IAiCodeActionResult | null>(null);
  const isLoading = ref(false);

  /**
   * Run a fully-formed code action request.
   * On success, `result` is updated; on failure, the error is re-thrown
   * and `result` is left untouched.
   */
  const runCodeAction = async (
    payload: IAiCodeActionRequest,
  ): Promise<IAiCodeActionResult> => {
    isLoading.value = true;
    try {
      const nextResult = await aiService.codeAction(payload);
      result.value = nextResult;
      return nextResult;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * Convenience wrapper for selection-driven actions (explain / fix / etc.)
   * with sensible defaults for `filePath`, `language`, and `diagnostics`.
   */
  const runSelectionAction = (
    kind: TAiCodeActionKind,
    selection: string,
    options: IUseAiCodeActionSelectionOptions = {},
  ): Promise<IAiCodeActionResult> =>
    runCodeAction({
      kind,
      filePath: options.filePath ?? null,
      language: options.language ?? DEFAULT_SELECTION_LANGUAGE,
      selection,
      diagnostics: options.diagnostics ? [...options.diagnostics] : [],
    });

  /** Clear the cached result. Does not affect any in-flight request. */
  const reset = (): void => {
    result.value = null;
  };

  return { result, isLoading, runCodeAction, runSelectionAction, reset };
};