import { tauriService } from '@/services/tauri';
import { useEditorStore } from '@/store/editor';
import type { TThemeMode } from '@/types/app';
import type {
  ITerminalDataEvent,
  ITerminalExitEvent,
  ITerminalRunCompletePayload,
  ITerminalSessionPayload,
  ITerminalStatusChangePayload,
  TTerminalConnectionState,
} from '@/types/terminal';
import { DEFAULT_TERMINAL_SESSION_ID } from '@/types/terminal';
import { waitForDesktopRuntime } from '@/utils/desktop-runtime';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 28;
const MIN_RENDERABLE_TERMINAL_WIDTH = 24;
const MIN_RENDERABLE_TERMINAL_HEIGHT = 24;
const TERMINAL_ENABLE_WEBGL_RENDERER = false;
const TERMINAL_WEBGL_RECOVERY_DELAY_MS = 180;
const TERMINAL_STREAM_MARKER_PREFIX = '\u001b]SH_EDITOR:';
const TERMINAL_STREAM_MARKER_SUFFIX = '\u0007';
const TERMINAL_STREAM_START_MARKER_PREFIX = 'SH_EDITOR_RUN_BEGIN:';
const TERMINAL_STREAM_END_MARKER_PREFIX = 'SH_EDITOR_RUN_END:';
const TERMINAL_RUN_START_MARKER_WAIT_TIMEOUT_MS = 4200;
const TERMINAL_LAYOUT_SETTLE_DELAY_MS = 72;
const TERMINAL_OUTPUT_FLUSH_DELAY_MS = 16;
const TERMINAL_SCROLL_RECOVERY_DELAY_MS = 64;
const TERMINAL_SCROLLBACK_LIMIT = 12000;
const POST_RUN_PROMPT_DETECTION_BUFFER_LIMIT = 512;
const POST_RUN_PROMPT_CHECK_DELAY_MS = 180;
const POST_RUN_PROMPT_CHECK_RETRY_MS = 260;
const POST_RUN_PROMPT_MAX_REFRESH_ATTEMPTS = 2;
const MAX_PENDING_MARKER_BODY_LENGTH = 512;

const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`,
  'g',
);
const SHELL_PROMPT_PATTERN = /[\r\n][^\r\n]{0,200}[#$>]\s*$/;
const TERMINAL_STREAM_HIDDEN_MARKER_PATTERN = new RegExp(
  String.raw`\u001b\]SH_EDITOR:SH_EDITOR_RUN_(?:BEGIN|END):[^\u0007]*\u0007`,
  'g',
);

const createTerminalTheme = (theme: TThemeMode) =>
  theme === 'light'
    ? {
      background: '#f5f7fb',
      foreground: '#111827',
      cursor: '#335cff',
      cursorAccent: '#f5f7fb',
      selectionBackground: 'rgba(76, 111, 255, 0.18)',
      scrollbarSliderBackground: 'rgba(15, 23, 42, 0.12)',
      scrollbarSliderHoverBackground: 'rgba(15, 23, 42, 0.22)',
      scrollbarSliderActiveBackground: 'rgba(51, 92, 255, 0.32)',
      black: '#15181d',
      red: '#c2415b',
      green: '#15803d',
      yellow: '#a16207',
      blue: '#335cff',
      magenta: '#7c3aed',
      cyan: '#0f766e',
      white: '#475569',
      brightBlack: '#64748b',
      brightRed: '#e11d48',
      brightGreen: '#16a34a',
      brightYellow: '#ca8a04',
      brightBlue: '#4f46e5',
      brightMagenta: '#9333ea',
      brightCyan: '#0891b2',
      brightWhite: '#0f172a',
    }
    : {
      background: '#15191e',
      foreground: '#d7dce5',
      cursor: '#7c89ff',
      cursorAccent: '#15191e',
      selectionBackground: 'rgba(94, 106, 210, 0.26)',
      scrollbarSliderBackground: 'rgba(255, 255, 255, 0.1)',
      scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.18)',
      scrollbarSliderActiveBackground: 'rgba(124, 137, 255, 0.34)',
      black: '#111318',
      red: '#ff7b88',
      green: '#5dd39e',
      yellow: '#f3c969',
      blue: '#7c89ff',
      magenta: '#c792ea',
      cyan: '#89ddff',
      white: '#d7dce5',
      brightBlack: '#656b76',
      brightRed: '#ff9aa5',
      brightGreen: '#74e2ad',
      brightYellow: '#f8d88b',
      brightBlue: '#9aa6ff',
      brightMagenta: '#d7a6ff',
      brightCyan: '#a9e7ff',
      brightWhite: '#f5f7fb',
    };

const resolveErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripTerminalHiddenMarkers = (value: string): string =>
  value.replace(TERMINAL_STREAM_HIDDEN_MARKER_PATTERN, '');

const resolveTerminalMarkerSearchTailLength = (value: string): number => {
  const maxTailLength = Math.min(value.length, TERMINAL_STREAM_MARKER_PREFIX.length - 1);
  for (let tailLength = maxTailLength; tailLength > 0; tailLength -= 1) {
    if (TERMINAL_STREAM_MARKER_PREFIX.startsWith(value.slice(-tailLength))) {
      return tailLength;
    }
  }
  return 0;
};

const splitTerminalMarkerChunk = (
  value: string,
): {
  before: string;
  markerToken: string | null;
  remainder: string;
} => {
  const markerStartIndex = value.indexOf(TERMINAL_STREAM_MARKER_PREFIX);
  if (markerStartIndex === -1) {
    const tailLength = resolveTerminalMarkerSearchTailLength(value);
    return {
      before: value.slice(0, value.length - tailLength),
      markerToken: null,
      remainder: value.slice(value.length - tailLength),
    };
  }
  const markerContentStartIndex = markerStartIndex + TERMINAL_STREAM_MARKER_PREFIX.length;
  const markerEndIndex = value.indexOf(TERMINAL_STREAM_MARKER_SUFFIX, markerContentStartIndex);
  if (markerEndIndex === -1) {
    if (value.length - markerContentStartIndex > MAX_PENDING_MARKER_BODY_LENGTH) {
      return {
        before: value,
        markerToken: null,
        remainder: '',
      };
    }
    return {
      before: value.slice(0, markerStartIndex),
      markerToken: null,
      remainder: value.slice(markerStartIndex),
    };
  }
  return {
    before: value.slice(0, markerStartIndex),
    markerToken: value.slice(markerContentStartIndex, markerEndIndex),
    remainder: value.slice(markerEndIndex + TERMINAL_STREAM_MARKER_SUFFIX.length),
  };
};

const sanitizeCapturedTerminalNoise = (value: string, runId: string | null): string => {
  if (!value) {
    return value;
  }
  const sanitizedValue = stripTerminalHiddenMarkers(value);
  if (!runId) {
    return sanitizedValue;
  }
  const escapedRunId = escapeRegExp(runId);
  return sanitizedValue
    .replace(
      new RegExp(
        `(^|[\\r\\n])([^\\r\\n]*[#$>]\\s+)(?:__sh_editor_out=|i=['"]${escapedRunId}['"]).*?(?=$|[\\r\\n])`,
        'g',
      ),
      '$1$2',
    )
    .replace(
      new RegExp(
        `(^|[\\r\\n])(?:__sh_editor_out=|i=['"]${escapedRunId}['"]).*?(?=$|[\\r\\n])`,
        'g',
      ),
      '$1',
    )
    .replace(
      new RegExp(
        `(^|[\\r\\n])([^\\r\\n]*[#$>]\\s+)?bash\\s+['"][^\\r\\n]*sh-editor-dispatch-${escapedRunId}\\.sh['"]?(?=$|[\\r\\n])`,
        'g',
      ),
      '$1',
    )
    .replace(new RegExp(`SH_EDITOR_RUN_BEGIN:${escapedRunId}`, 'g'), '')
    .replace(new RegExp(`SH_EDITOR_RUN_END:${escapedRunId}:-?\\d+`, 'g'), '');
};

const resolveInteger = (
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const integer = Math.trunc(numeric);
  if (!Number.isFinite(integer)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, integer));
};

const isPrintableTerminalInput = (data: string): boolean => {
  if (data.length === 0) {
    return false;
  }

  const firstCharacterCode = data.charCodeAt(0);
  return firstCharacterCode >= 0x20 && firstCharacterCode !== 0x7f;
};

type TUseIntegratedTerminalOptions = {
  visible: Ref<boolean>;
  theme: Ref<TThemeMode>;
  sessionId?: string;
  onStatusChange?: (payload: ITerminalStatusChangePayload) => void;
  onOutput?: (value: string) => void;
  onRunComplete?: (payload: ITerminalRunCompletePayload) => void;
};

type TTerminalLayoutSyncOptions = {
  settle?: boolean;
};

const sharedStatus = ref<TTerminalConnectionState>('connecting');
const sharedStatusMessage = ref('正在连接 WSL2 终端…');
const sharedSession = ref<ITerminalSessionPayload | null>(null);
const sharedTerminalRef = shallowRef<Terminal | null>(null);
const sharedFitAddonRef = shallowRef<FitAddon | null>(null);
const sharedWebglAddonRef = shallowRef<WebglAddon | null>(null);

export const useIntegratedTerminalStatus = () => ({
  status: readonly(sharedStatus),
  statusMessage: readonly(sharedStatusMessage),
});

let sharedVisibleRef: Ref<boolean> | null = null;
let sharedStatusListener: ((payload: ITerminalStatusChangePayload) => void) | null = null;
let sharedOutputListener: ((value: string) => void) | null = null;
let sharedRunCompleteListener: ((payload: ITerminalRunCompletePayload) => void) | null = null;

let fontLoadingCleanup: (() => void) | null = null;
let visibilityChangeCleanup: (() => void) | null = null;
let windowFocusCleanup: (() => void) | null = null;
let windowResizeCleanup: (() => void) | null = null;
let webglContextLossCleanup: { dispose(): void } | null = null;
let resizeObserver: ResizeObserver | null = null;

let layoutFrameId: number | null = null;
let layoutSettleTimeoutId: number | null = null;
let viewportFrameId: number | null = null;
let pendingLayoutSettleSync = false;

let shouldClearTextureAtlasOnViewportSync = false;
let shouldRefreshViewportOnViewportSync = false;
let shouldScrollToBottomOnViewportSync = false;

let dataUnlisten: UnlistenFn | null = null;
let exitUnlisten: UnlistenFn | null = null;
let eventListenerRegistration: Promise<void> | null = null;

let runStartMarkerTimeoutId: number | null = null;
let programmaticScrollReleaseFrameId: number | null = null;
let terminalWriteFrameId: number | null = null;
let terminalWriteTimeoutId: number | null = null;
let scrollRecoveryTimeoutId: number | null = null;

let isTerminalWriteInFlight = false;
let isProgrammaticScrollSync = false;
let isAutoFollowEnabled = true;
let bufferedTerminalWrite = '';
let pendingScrollToBottomAfterWrite = false;
let shouldFitBeforeNextVisibleWrite = false;

const pendingTerminalWriteCallbacks: Array<() => void> = [];
const replaySuppressedRunIds = new Set<string>();

let terminalStreamBuffer = '';
let expectedRunId: string | null = null;
let activeRunId: string | null = null;
let capturedRunOutput = '';

let pendingPromptRestoreRunId: string | null = null;
let pendingPromptRestoreBuffer = '';
let promptRestoreAttemptCount = 0;
let promptRestoreTimeoutId: number | null = null;

let webglRendererBlocked = false;
let previousHostSize = { width: 0, height: 0 };
let previousTerminalSize = { cols: 0, rows: 0 };

const didHostSizeChange = (width: number, height: number): boolean => {
  const normalizedWidth = Math.round(width);
  const normalizedHeight = Math.round(height);

  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    return false;
  }

  if (
    previousHostSize.width === normalizedWidth &&
    previousHostSize.height === normalizedHeight
  ) {
    return false;
  }

  previousHostSize = {
    width: normalizedWidth,
    height: normalizedHeight,
  };

  return true;
};

const didTerminalSizeChange = (cols: number, rows: number): boolean => {
  const normalizedCols = Math.max(0, Math.trunc(cols));
  const normalizedRows = Math.max(0, Math.trunc(rows));

  if (normalizedCols <= 0 || normalizedRows <= 0) {
    return false;
  }

  if (
    previousTerminalSize.cols === normalizedCols &&
    previousTerminalSize.rows === normalizedRows
  ) {
    return false;
  }

  previousTerminalSize = {
    cols: normalizedCols,
    rows: normalizedRows,
  };

  return true;
};

export const useIntegratedTerminal = ({
  visible,
  theme,
  sessionId = DEFAULT_TERMINAL_SESSION_ID,
  onStatusChange,
  onOutput,
  onRunComplete,
}: TUseIntegratedTerminalOptions) => {
  const editorStore = useEditorStore();
  sharedVisibleRef = visible;
  sharedStatusListener = onStatusChange ?? null;
  sharedOutputListener = onOutput ?? null;
  sharedRunCompleteListener = onRunComplete ?? null;

  const hostRef = ref<HTMLElement | null>(null);
  const status = sharedStatus;
  const statusMessage = sharedStatusMessage;
  const session = sharedSession;
  const terminalRef = sharedTerminalRef;
  const fitAddonRef = sharedFitAddonRef;
  const webglAddonRef = sharedWebglAddonRef;

  const buildRunCompletePayload = (
    runId: string,
    exitCode: number | null,
    output: string,
  ): ITerminalRunCompletePayload =>
  ({
    sessionId,
    runId,
    exitCode,
    output,
    finishedAt: new Date().toISOString(),
  } as ITerminalRunCompletePayload);

  const emitStatus = (state: TTerminalConnectionState, message: string): void => {
    status.value = state;
    statusMessage.value = message;
    sharedStatusListener?.({ state, message });
  };

  const emitOutput = (value: string): void => {
    sharedOutputListener?.(value);
  };

  const emitRunComplete = (payload: ITerminalRunCompletePayload): void => {
    sharedRunCompleteListener?.(payload);
  };

  const isTerminalVisible = (): boolean => Boolean(sharedVisibleRef?.value);

  const clearLayoutFrame = (): void => {
    if (layoutFrameId !== null) {
      cancelAnimationFrame(layoutFrameId);
      layoutFrameId = null;
    }
  };
  const clearViewportFrame = (): void => {
    if (viewportFrameId !== null) {
      cancelAnimationFrame(viewportFrameId);
      viewportFrameId = null;
    }
  };
  const clearLayoutSettleTimeout = (): void => {
    if (layoutSettleTimeoutId !== null) {
      window.clearTimeout(layoutSettleTimeoutId);
      layoutSettleTimeoutId = null;
    }
  };
  const clearTerminalWriteFrame = (): void => {
    if (terminalWriteFrameId !== null) {
      cancelAnimationFrame(terminalWriteFrameId);
      terminalWriteFrameId = null;
    }
  };
  const clearTerminalWriteTimeout = (): void => {
    if (terminalWriteTimeoutId !== null) {
      window.clearTimeout(terminalWriteTimeoutId);
      terminalWriteTimeoutId = null;
    }
  };
  const clearScrollRecoveryTimeout = (): void => {
    if (scrollRecoveryTimeoutId !== null) {
      window.clearTimeout(scrollRecoveryTimeoutId);
      scrollRecoveryTimeoutId = null;
    }
  };

  const flushPendingTerminalWriteCallbacks = (): void => {
    if (pendingTerminalWriteCallbacks.length === 0) {
      return;
    }
    const callbacks = pendingTerminalWriteCallbacks.splice(0, pendingTerminalWriteCallbacks.length);
    callbacks.forEach((callback) => {
      callback();
    });
  };

  const flushTerminalWriteBufferNow = (options?: {
    afterWrite?: () => void;
    forceLayout?: boolean;
  }): void => {
    if (options?.afterWrite) {
      pendingTerminalWriteCallbacks.push(options.afterWrite);
    }
    clearTerminalWriteFrame();
    clearTerminalWriteTimeout();
    const terminal = terminalRef.value;
    if (!terminal) {
      if (!isTerminalWriteInFlight) {
        flushPendingTerminalWriteCallbacks();
      }
      return;
    }
    if (isTerminalWriteInFlight) {
      return;
    }
    if (!bufferedTerminalWrite) {
      if (options?.forceLayout || shouldFitBeforeNextVisibleWrite) {
        syncTerminalLayout();
        shouldFitBeforeNextVisibleWrite = false;
        scheduleViewportSync({ scrollToBottom: true });
      }
      flushPendingTerminalWriteCallbacks();
      return;
    }
    if (options?.forceLayout || shouldFitBeforeNextVisibleWrite) {
      syncTerminalLayout();
      shouldFitBeforeNextVisibleWrite = false;
    }
    const chunk = bufferedTerminalWrite;
    const shouldScrollToBottom = pendingScrollToBottomAfterWrite;
    bufferedTerminalWrite = '';
    pendingScrollToBottomAfterWrite = false;
    isTerminalWriteInFlight = true;
    terminal.write(chunk, () => {
      isTerminalWriteInFlight = false;
      scheduleViewportSync({ scrollToBottom: shouldScrollToBottom });
      if (bufferedTerminalWrite) {
        flushTerminalWriteBufferNow();
        return;
      }
      flushPendingTerminalWriteCallbacks();
    });
  };

  const scheduleTerminalWriteFlush = (): void => {
    if (terminalWriteFrameId === null) {
      terminalWriteFrameId = requestAnimationFrame(() => {
        terminalWriteFrameId = null;
        flushTerminalWriteBufferNow();
      });
    }
    if (terminalWriteTimeoutId !== null) {
      return;
    }
    terminalWriteTimeoutId = window.setTimeout(() => {
      terminalWriteTimeoutId = null;
      flushTerminalWriteBufferNow();
    }, TERMINAL_OUTPUT_FLUSH_DELAY_MS);
  };

  const queueTerminalWrite = (
    value: string,
    options?: {
      scrollToBottom?: boolean;
    },
  ): void => {
    if (!value) {
      return;
    }
    bufferedTerminalWrite += value;
    if (options?.scrollToBottom) {
      pendingScrollToBottomAfterWrite = true;
    }
    scheduleTerminalWriteFlush();
  };

  const syncTerminalSurfaceTone = (): void => {
    const background = createTerminalTheme(theme.value).background;
    hostRef.value?.style.setProperty('--terminal-fill', background);
    if (hostRef.value) {
      hostRef.value.style.backgroundColor = background;
    }
    if (terminalRef.value?.element) {
      terminalRef.value.element.style.setProperty('--terminal-fill', background);
      terminalRef.value.element.style.backgroundColor = background;
    }
  };

  const disposeWebglRenderer = (): void => {
    webglContextLossCleanup?.dispose();
    webglContextLossCleanup = null;
    webglAddonRef.value?.dispose();
    webglAddonRef.value = null;
  };

  const clearTerminalTextureAtlas = (): void => {
    if (webglAddonRef.value) {
      webglAddonRef.value.clearTextureAtlas();
      return;
    }
    terminalRef.value?.clearTextureAtlas();
  };

  const canUseWebglRenderer = (): boolean =>
    TERMINAL_ENABLE_WEBGL_RENDERER &&
    !webglRendererBlocked &&
    typeof window !== 'undefined' &&
    'WebGL2RenderingContext' in window;

  const ensurePreferredRenderer = (): void => {
    const terminal = terminalRef.value;
    if (!terminal || webglAddonRef.value || !canUseWebglRenderer()) {
      return;
    }
    try {
      const addon = new WebglAddon();
      webglContextLossCleanup = addon.onContextLoss(() => {
        disposeWebglRenderer();
        window.setTimeout(() => {
          ensurePreferredRenderer();
          scheduleLayoutSync();
          scheduleViewportSync({ clearTextureAtlas: true, refresh: true, scrollToBottom: true });
        }, TERMINAL_WEBGL_RECOVERY_DELAY_MS);
      });
      terminal.loadAddon(addon);
      webglAddonRef.value = addon;
    } catch (error) {
      webglRendererBlocked = true;
      console.warn('WebGL 终端渲染器初始化失败，已回退默认渲染器', error);
    }
  };

  const refreshTerminalViewportNow = (): void => {
    const terminal = terminalRef.value;
    const shouldClearTextureAtlas = shouldClearTextureAtlasOnViewportSync;
    const shouldRefresh = shouldRefreshViewportOnViewportSync || shouldClearTextureAtlas;
    const shouldScrollToBottom = shouldScrollToBottomOnViewportSync;
    shouldClearTextureAtlasOnViewportSync = false;
    shouldRefreshViewportOnViewportSync = false;
    shouldScrollToBottomOnViewportSync = false;
    if (!terminal) {
      return;
    }
    if (shouldClearTextureAtlas) {
      clearTerminalTextureAtlas();
    }
    if (
      shouldScrollToBottom &&
      isTerminalVisible() &&
      isAutoFollowEnabled &&
      !isViewportNearBottom(terminal)
    ) {
      runWithProgrammaticScrollLock(() => {
        terminal.scrollToBottom();
      });
    }
    if (shouldRefresh) {
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
    }
  };

  const clearProgrammaticScrollReleaseFrame = (): void => {
    if (programmaticScrollReleaseFrameId !== null) {
      cancelAnimationFrame(programmaticScrollReleaseFrameId);
      programmaticScrollReleaseFrameId = null;
    }
  };

  const clearPromptRestoreTimeout = (): void => {
    if (promptRestoreTimeoutId !== null) {
      window.clearTimeout(promptRestoreTimeoutId);
      promptRestoreTimeoutId = null;
    }
  };

  const clearRunStartMarkerTimeout = (): void => {
    if (runStartMarkerTimeoutId !== null) {
      window.clearTimeout(runStartMarkerTimeoutId);
      runStartMarkerTimeoutId = null;
    }
  };

  const releaseProgrammaticScrollLock = (): void => {
    clearProgrammaticScrollReleaseFrame();
    programmaticScrollReleaseFrameId = requestAnimationFrame(() => {
      isProgrammaticScrollSync = false;
      programmaticScrollReleaseFrameId = null;
    });
  };

  const runWithProgrammaticScrollLock = (callback: () => void): void => {
    isProgrammaticScrollSync = true;
    callback();
    releaseProgrammaticScrollLock();
  };

  const isViewportNearBottom = (terminal: Terminal): boolean => {
    const buffer = terminal.buffer.active;
    return buffer.baseY - buffer.viewportY <= 1;
  };

  const scheduleViewportSync = (options?: {
    clearTextureAtlas?: boolean;
    refresh?: boolean;
    scrollToBottom?: boolean;
  }): void => {
    if (options?.clearTextureAtlas) {
      shouldClearTextureAtlasOnViewportSync = true;
    }
    if (options?.refresh) {
      shouldRefreshViewportOnViewportSync = true;
    }
    if (options?.scrollToBottom) {
      shouldScrollToBottomOnViewportSync = true;
    }
    clearViewportFrame();
    viewportFrameId = requestAnimationFrame(() => {
      viewportFrameId = null;
      refreshTerminalViewportNow();
    });
  };

  const scheduleScrollRecovery = (): void => {
    if (!webglAddonRef.value) {
      return;
    }

    clearScrollRecoveryTimeout();
    scrollRecoveryTimeoutId = window.setTimeout(() => {
      scrollRecoveryTimeoutId = null;
      scheduleViewportSync({
        clearTextureAtlas: true,
        refresh: true,
      });
    }, TERMINAL_SCROLL_RECOVERY_DELAY_MS);
  };

  const syncTerminalLayout = (): void => {
    const terminal = terminalRef.value;
    const fitAddon = fitAddonRef.value;
    const hostElement = hostRef.value;
    if (!terminal || !fitAddon || !hostElement) {
      return;
    }
    if (
      hostElement.clientWidth < MIN_RENDERABLE_TERMINAL_WIDTH ||
      hostElement.clientHeight < MIN_RENDERABLE_TERMINAL_HEIGHT
    ) {
      return;
    }
    try {
      fitAddon.fit();
    } catch (error) {
      console.warn('终端尺寸同步失败', error);
    }
  };

  const scheduleLayoutSync = (options?: TTerminalLayoutSyncOptions): void => {
    if (options?.settle) {
      pendingLayoutSettleSync = true;
    }

    clearLayoutSettleTimeout();

    if (layoutFrameId !== null) {
      return;
    }

    layoutFrameId = requestAnimationFrame(() => {
      layoutFrameId = null;
      syncTerminalLayout();

      if (!pendingLayoutSettleSync) {
        return;
      }

      pendingLayoutSettleSync = false;
      layoutSettleTimeoutId = window.setTimeout(() => {
        layoutSettleTimeoutId = null;
        syncTerminalLayout();
      }, TERMINAL_LAYOUT_SETTLE_DELAY_MS);
    });
  };

  const focusTerminal = (): void => {
    terminalRef.value?.focus();
  };

  const scheduleRunStartMarkerTimeout = (runId: string): void => {
    clearRunStartMarkerTimeout();
    runStartMarkerTimeoutId = window.setTimeout(() => {
      runStartMarkerTimeoutId = null;
      if (expectedRunId !== runId || activeRunId === runId) {
        return;
      }
      clearTrackedRunState(runId);
    }, TERMINAL_RUN_START_MARKER_WAIT_TIMEOUT_MS);
  };

  const clearTrackedRunState = (runId?: string): void => {
    const matchesExpectedRun = !runId || expectedRunId === runId;
    const matchesActiveRun = !runId || activeRunId === runId;
    if (!matchesExpectedRun && !matchesActiveRun) {
      return;
    }
    clearRunStartMarkerTimeout();
    terminalStreamBuffer = '';
    const affectedRunId = runId ?? expectedRunId ?? activeRunId;
    if (matchesExpectedRun) {
      expectedRunId = null;
    }
    if (matchesActiveRun) {
      activeRunId = null;
    }
    if (affectedRunId) {
      replaySuppressedRunIds.delete(affectedRunId);
    }
    capturedRunOutput = '';
  };

  const resetTerminalRunCapture = (): void => {
    clearTrackedRunState();
    pendingPromptRestoreRunId = null;
    pendingPromptRestoreBuffer = '';
    promptRestoreAttemptCount = 0;
    clearPromptRestoreTimeout();
  };

  const normalizeTerminalOutputForPromptCheck = (value: string): string =>
    `\n${value.replace(ANSI_ESCAPE_PATTERN, '')}`;

  const clearPendingPromptRestore = (): void => {
    pendingPromptRestoreRunId = null;
    pendingPromptRestoreBuffer = '';
    promptRestoreAttemptCount = 0;
    clearPromptRestoreTimeout();
  };

  const schedulePromptRestoreCheck = (): void => {
    clearPromptRestoreTimeout();
    if (!pendingPromptRestoreRunId || !session.value) {
      return;
    }
    const delay =
      promptRestoreAttemptCount === 0
        ? POST_RUN_PROMPT_CHECK_DELAY_MS
        : POST_RUN_PROMPT_CHECK_RETRY_MS;
    promptRestoreTimeoutId = window.setTimeout(() => {
      promptRestoreTimeoutId = null;
      if (!pendingPromptRestoreRunId || !session.value) {
        return;
      }
      if (
        SHELL_PROMPT_PATTERN.test(normalizeTerminalOutputForPromptCheck(pendingPromptRestoreBuffer))
      ) {
        clearPendingPromptRestore();
        return;
      }
      if (promptRestoreAttemptCount >= POST_RUN_PROMPT_MAX_REFRESH_ATTEMPTS) {
        void tauriService.writeTerminalInput({ sessionId, data: '\u0003' }).catch(() => {
          // Ignore recovery failures when the shell has already detached.
        });
        clearPendingPromptRestore();
        return;
      }
      promptRestoreAttemptCount += 1;
      void tauriService.writeTerminalInput({ sessionId, data: '\n' }).catch(() => {
        clearPendingPromptRestore();
      });
      schedulePromptRestoreCheck();
    }, delay);
  };

  const trackPostRunPrompt = (output: string): void => {
    if (!pendingPromptRestoreRunId || !output) {
      return;
    }
    pendingPromptRestoreBuffer = `${pendingPromptRestoreBuffer}${output}`.slice(
      -POST_RUN_PROMPT_DETECTION_BUFFER_LIMIT,
    );
    if (
      SHELL_PROMPT_PATTERN.test(normalizeTerminalOutputForPromptCheck(pendingPromptRestoreBuffer))
    ) {
      clearPendingPromptRestore();
    }
  };

  const beginPromptRestore = (runId: string): void => {
    pendingPromptRestoreRunId = runId;
    pendingPromptRestoreBuffer = '';
    promptRestoreAttemptCount = 0;
    schedulePromptRestoreCheck();
  };

  const processTerminalData = (
    chunk: string,
  ): {
    visibleOutput: string;
    capturedOutput: string;
    completedRuns: ITerminalRunCompletePayload[];
  } => {
    terminalStreamBuffer += chunk;
    const visibleChunks: string[] = [];
    const capturedChunks: string[] = [];
    const completedRuns: ITerminalRunCompletePayload[] = [];

    const appendRunOutput = (value: string): void => {
      if (!value) {
        return;
      }
      if (activeRunId && replaySuppressedRunIds.has(activeRunId)) {
        return;
      }
      visibleChunks.push(value);
      capturedChunks.push(value);
      capturedRunOutput += value;
    };

    while (terminalStreamBuffer.length > 0) {
      if (activeRunId) {
        const markerChunk = splitTerminalMarkerChunk(terminalStreamBuffer);
        if (markerChunk.before) {
          appendRunOutput(markerChunk.before);
        }
        terminalStreamBuffer = markerChunk.remainder;
        if (!markerChunk.markerToken) {
          break;
        }
        const completedRunId = activeRunId;
        const endMarkerPrefix = `${TERMINAL_STREAM_END_MARKER_PREFIX}${completedRunId}:`;
        if (markerChunk.markerToken.startsWith(endMarkerPrefix)) {
          const exitCodeRaw = markerChunk.markerToken.slice(endMarkerPrefix.length);
          const parsedExitCode = Number.parseInt(exitCodeRaw, 10);
          const wasSuppressed = replaySuppressedRunIds.has(completedRunId);
          const completedRun = buildRunCompletePayload(
            completedRunId,
            Number.isFinite(parsedExitCode) ? parsedExitCode : null,
            capturedRunOutput,
          );
          activeRunId = null;
          capturedRunOutput = '';
          if (wasSuppressed) {
            replaySuppressedRunIds.delete(completedRunId);
          } else {
            completedRuns.push(completedRun);
          }
        }
        continue;
      }

      if (expectedRunId) {
        const markerChunk = splitTerminalMarkerChunk(terminalStreamBuffer);
        if (markerChunk.before) {
          visibleChunks.push(markerChunk.before);
          capturedChunks.push(markerChunk.before);
        }
        terminalStreamBuffer = markerChunk.remainder;
        if (!markerChunk.markerToken) {
          break;
        }
        if (markerChunk.markerToken === `${TERMINAL_STREAM_START_MARKER_PREFIX}${expectedRunId}`) {
          clearRunStartMarkerTimeout();
          activeRunId = expectedRunId;
          expectedRunId = null;
          capturedRunOutput = '';
        }
        continue;
      }

      const markerChunk = splitTerminalMarkerChunk(terminalStreamBuffer);
      if (markerChunk.before) {
        visibleChunks.push(markerChunk.before);
        capturedChunks.push(markerChunk.before);
      }
      terminalStreamBuffer = markerChunk.remainder;
      if (!markerChunk.markerToken) {
        break;
      }
    }

    const noiseSuppressionRunId =
      pendingPromptRestoreRunId ??
      activeRunId ??
      expectedRunId ??
      completedRuns[completedRuns.length - 1]?.runId ??
      null;

    return {
      visibleOutput: stripTerminalHiddenMarkers(visibleChunks.join('')),
      capturedOutput: sanitizeCapturedTerminalNoise(capturedChunks.join(''), noiseSuppressionRunId),
      completedRuns,
    };
  };

  const bindResizeObserver = (): void => {
    if (typeof ResizeObserver === 'undefined' || !hostRef.value) {
      return;
    }
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver((entries) => {
      const targetEntry = entries[0];
      if (!targetEntry || !didHostSizeChange(targetEntry.contentRect.width, targetEntry.contentRect.height)) {
        return;
      }

      if (isTerminalVisible()) {
        scheduleLayoutSync();
      }
    });
    resizeObserver.observe(hostRef.value);

    if (windowResizeCleanup) {
      return;
    }
    const handleWindowResize = (): void => {
      if (!isTerminalVisible()) {
        return;
      }

      if (!hostRef.value || !didHostSizeChange(hostRef.value.clientWidth, hostRef.value.clientHeight)) {
        return;
      }

      scheduleLayoutSync();
    };
    window.addEventListener('resize', handleWindowResize);
    windowResizeCleanup = () => {
      window.removeEventListener('resize', handleWindowResize);
      windowResizeCleanup = null;
    };
  };

  const bindRenderRecoveryListeners = (): void => {
    if (!windowFocusCleanup) {
      const handleWindowFocus = (): void => {
        if (!isTerminalVisible()) {
          return;
        }
        ensurePreferredRenderer();
        scheduleLayoutSync({ settle: true });
        scheduleViewportSync({ clearTextureAtlas: true, refresh: true, scrollToBottom: true });
      };
      window.addEventListener('focus', handleWindowFocus);
      windowFocusCleanup = () => {
        window.removeEventListener('focus', handleWindowFocus);
        windowFocusCleanup = null;
      };
    }

    if (!visibilityChangeCleanup) {
      const handleVisibilityChange = (): void => {
        if (document.visibilityState !== 'visible' || !isTerminalVisible()) {
          return;
        }
        ensurePreferredRenderer();
        scheduleLayoutSync({ settle: true });
        scheduleViewportSync({ clearTextureAtlas: true, refresh: true, scrollToBottom: true });
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      visibilityChangeCleanup = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        visibilityChangeCleanup = null;
      };
    }

    if (fontLoadingCleanup || typeof document === 'undefined' || !('fonts' in document)) {
      return;
    }
    const fontSet = document.fonts;
    const handleFontMetricsReady = (): void => {
      if (!isTerminalVisible()) {
        return;
      }
      ensurePreferredRenderer();
      scheduleLayoutSync({ settle: true });
      scheduleViewportSync({ refresh: true });
    };
    const readyPromise = fontSet.ready;
    void readyPromise.then(() => {
      handleFontMetricsReady();
    });
    fontSet.addEventListener('loadingdone', handleFontMetricsReady);
    fontLoadingCleanup = () => {
      fontSet.removeEventListener('loadingdone', handleFontMetricsReady);
      fontLoadingCleanup = null;
    };
  };

  const ensureSession = async (): Promise<void> => {
    const runtimeReady = await waitForDesktopRuntime();
    if (!runtimeReady) {
      emitStatus('error', '内置终端仅支持 Tauri 桌面端。');
      return;
    }
    const terminal = terminalRef.value;
    if (!terminal) {
      return;
    }
    emitStatus('connecting', '正在连接 WSL2 终端…');
    await nextTick();
    syncTerminalLayout();
    try {
      const payload = await tauriService.ensureTerminalSession({
        sessionId,
        cwd: null,
        cols: resolveInteger(terminal.cols, DEFAULT_COLS, 2, 5000),
        rows: resolveInteger(terminal.rows, DEFAULT_ROWS, 1, 3000),
      });
      session.value = payload;
      emitStatus('ready', `${payload.shellLabel} 已连接`);
      ensurePreferredRenderer();
      scheduleViewportSync({ scrollToBottom: true });
      if (visible.value) {
        focusTerminal();
      }
    } catch (error) {
      const message = resolveErrorMessage(error, '连接 WSL2 终端失败。');
      emitStatus('error', message);
      terminal.writeln(`\x1b[31m${message}\x1b[0m`, () => {
        scheduleViewportSync({ scrollToBottom: true });
      });
    }
  };

  const handleTerminalDataEvent = (event: { payload: ITerminalDataEvent }): void => {
    if (event.payload.sessionId !== sessionId) {
      return;
    }
    const terminal = terminalRef.value;
    if (!terminal) {
      return;
    }
    const processed = processTerminalData(event.payload.data);

    if (processed.completedRuns.length > 0) {
      beginPromptRestore(processed.completedRuns[processed.completedRuns.length - 1].runId);
    }

    if (processed.visibleOutput) {
      queueTerminalWrite(processed.visibleOutput, { scrollToBottom: true });
      trackPostRunPrompt(processed.visibleOutput);
    }

    if (processed.capturedOutput) {
      emitOutput(processed.capturedOutput);
    }

    if (processed.completedRuns.length > 0) {
      if (isTerminalVisible()) {
        focusTerminal();
      }
      for (const completedRun of processed.completedRuns) {
        flushTerminalWriteBufferNow({
          afterWrite: () => {
            scheduleViewportSync({ scrollToBottom: true });
            emitRunComplete(completedRun);
          },
          forceLayout: true,
        });
      }
    }
  };

  const handleTerminalExitEvent = (event: { payload: ITerminalExitEvent }): void => {
    if (event.payload.sessionId !== sessionId) {
      return;
    }
    session.value = null;
    const message =
      event.payload.exitCode === null
        ? 'WSL2 终端已断开。'
        : `WSL2 终端已退出（代码 ${event.payload.exitCode}）。`;
    if (activeRunId) {
      emitRunComplete(
        buildRunCompletePayload(activeRunId, event.payload.exitCode ?? -1, capturedRunOutput),
      );
      resetTerminalRunCapture();
    } else {
      clearPendingPromptRestore();
    }
    queueTerminalWrite(`\r\n\x1b[90m${message}\x1b[0m\r\n`, { scrollToBottom: true });
    flushTerminalWriteBufferNow();
    scheduleViewportSync({ scrollToBottom: true });
    emitStatus('closed', message);
  };

  const registerEventListeners = (): Promise<void> => {
    if (dataUnlisten && exitUnlisten) {
      return Promise.resolve();
    }
    if (eventListenerRegistration) {
      return eventListenerRegistration;
    }
    eventListenerRegistration = (async () => {
      const [nextDataUnlisten, nextExitUnlisten] = await Promise.all([
        listen<ITerminalDataEvent>('terminal:data', handleTerminalDataEvent),
        listen<ITerminalExitEvent>('terminal:exit', handleTerminalExitEvent),
      ]);
      dataUnlisten = nextDataUnlisten;
      exitUnlisten = nextExitUnlisten;
    })().finally(() => {
      eventListenerRegistration = null;
    });
    return eventListenerRegistration;
  };

  const attachTerminalToHost = (): void => {
    const terminal = terminalRef.value;
    const host = hostRef.value;
    if (!terminal || !host) {
      return;
    }
    if (!terminal.element) {
      terminal.open(host);
    } else if (terminal.element.parentElement !== host) {
      host.replaceChildren(terminal.element);
    }
    previousHostSize = {
      width: Math.round(host.clientWidth),
      height: Math.round(host.clientHeight),
    };
    bindResizeObserver();
    ensurePreferredRenderer();
    syncTerminalSurfaceTone();
    scheduleLayoutSync({ settle: true });
    scheduleViewportSync({ clearTextureAtlas: true, refresh: true, scrollToBottom: true });
  };

  const createTerminal = (): void => {
    if (!hostRef.value) {
      return;
    }

    if (!terminalRef.value) {
      const terminal = new Terminal({
        allowTransparency: false,
        convertEol: true,
        cursorBlink: false,
        cursorStyle: 'bar',
        drawBoldTextInBrightColors: true,
        fontFamily:
          "Berkeley Mono, JetBrains Mono, 'SFMono-Regular', Consolas, 'Courier New', monospace",
        fontSize: 13,
        letterSpacing: 0,
        lineHeight: 1.38,
        rows: DEFAULT_ROWS,
        cols: DEFAULT_COLS,
        scrollOnUserInput: true,
        scrollback: TERMINAL_SCROLLBACK_LIMIT,
        scrollSensitivity: 1,
        fastScrollSensitivity: 1,
        smoothScrollDuration: 0,
        theme: createTerminalTheme(theme.value),
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminalRef.value = terminal;
      fitAddonRef.value = fitAddon;
      previousTerminalSize = {
        cols: terminal.cols,
        rows: terminal.rows,
      };

      terminal.onData((data) => {
        if (!session.value) {
          return;
        }
        if (isPrintableTerminalInput(data) || data === '\r' || data === '\n') {
          isAutoFollowEnabled = true;
        }
        void tauriService.writeTerminalInput({ sessionId, data }).catch((error) => {
          emitStatus('error', resolveErrorMessage(error, '终端输入发送失败。'));
        });
      });
      terminal.onScroll(() => {
        if (isProgrammaticScrollSync) {
          return;
        }
        const current = terminalRef.value;
        if (!current) {
          return;
        }
        isAutoFollowEnabled = isViewportNearBottom(current);
        if (isAutoFollowEnabled) {
          clearScrollRecoveryTimeout();
          return;
        }
        scheduleScrollRecovery();
      });
      terminal.onResize(({ cols, rows }) => {
        if (!didTerminalSizeChange(cols, rows)) {
          return;
        }

        scheduleViewportSync({ scrollToBottom: true });

        if (!session.value) {
          return;
        }

        void tauriService.resizeTerminalSession({ sessionId, cols, rows }).catch(() => {
          // 终端在关闭或窗口隐藏时可能触发瞬时 resize，这里忽略即可。
        });
      });
    }

    attachTerminalToHost();
  };

  const retry = async (): Promise<void> => {
    terminalRef.value?.reset();
    resetTerminalRunCapture();
    isAutoFollowEnabled = true;
    await ensureSession();
  };

  onMounted(async () => {
    createTerminal();
    bindRenderRecoveryListeners();
    await registerEventListeners();
    await ensureSession();
  });

  watch(
    () => theme.value,
    (nextTheme) => {
      const terminal = terminalRef.value;
      if (!terminal) {
        return;
      }
      terminal.options.theme = createTerminalTheme(nextTheme);
      syncTerminalSurfaceTone();
      scheduleViewportSync({ clearTextureAtlas: true, refresh: true });
    },
  );

  watch(
    () => visible.value,
    async (nextVisible) => {
      if (!nextVisible) {
        return;
      }
      await nextTick();
      createTerminal();
      ensurePreferredRenderer();
      syncTerminalSurfaceTone();
      scheduleLayoutSync({ settle: true });
      scheduleViewportSync({ clearTextureAtlas: true, refresh: true, scrollToBottom: true });
      focusTerminal();
    },
  );

  watch(
    () => editorStore.pendingTerminalRunId,
    (nextRunId) => {
      if (!nextRunId) {
        return;
      }
      if (activeRunId && activeRunId !== nextRunId) {
        emitRunComplete(buildRunCompletePayload(activeRunId, -1, capturedRunOutput));
      }
      clearTrackedRunState();
      expectedRunId = nextRunId;
      activeRunId = null;
      capturedRunOutput = '';
      terminalStreamBuffer = '';
      isAutoFollowEnabled = true;
      shouldFitBeforeNextVisibleWrite = true;
      replaySuppressedRunIds.delete(nextRunId);
      scheduleRunStartMarkerTimeout(nextRunId);
      scheduleLayoutSync();
      scheduleViewportSync({ scrollToBottom: true });
    },
    { flush: 'sync' },
  );

  watch(
    () => editorStore.terminalReplayOutput,
    (nextReplayRequest) => {
      if (!nextReplayRequest) {
        return;
      }
      replaySuppressedRunIds.add(nextReplayRequest.runId);
      if (expectedRunId !== nextReplayRequest.runId && activeRunId !== nextReplayRequest.runId) {
        expectedRunId = nextReplayRequest.runId;
        activeRunId = null;
        capturedRunOutput = '';
        terminalStreamBuffer = '';
        scheduleRunStartMarkerTimeout(nextReplayRequest.runId);
      }
      if (nextReplayRequest.content) {
        shouldFitBeforeNextVisibleWrite = true;
        queueTerminalWrite(nextReplayRequest.content, { scrollToBottom: true });
        flushTerminalWriteBufferNow({
          afterWrite: () => {
            if (nextReplayRequest.restorePrompt) {
              beginPromptRestore(nextReplayRequest.runId);
            }
            scheduleViewportSync({ scrollToBottom: true });
          },
          forceLayout: true,
        });
      } else if (nextReplayRequest.restorePrompt) {
        beginPromptRestore(nextReplayRequest.runId);
      }
      editorStore.queueTerminalReplayOutput(null);
    },
  );

  onBeforeUnmount(() => {
    sharedVisibleRef = null;
    sharedStatusListener = null;
    sharedOutputListener = null;
    sharedRunCompleteListener = null;

    resizeObserver?.disconnect();
    resizeObserver = null;
    windowResizeCleanup?.();
    windowFocusCleanup?.();
    visibilityChangeCleanup?.();
    fontLoadingCleanup?.();

    dataUnlisten?.();
    exitUnlisten?.();
    dataUnlisten = null;
    exitUnlisten = null;

    clearLayoutFrame();
    clearLayoutSettleTimeout();
    clearViewportFrame();
    clearProgrammaticScrollReleaseFrame();
    clearTerminalWriteFrame();
    clearTerminalWriteTimeout();
    clearScrollRecoveryTimeout();
    clearRunStartMarkerTimeout();
    clearPromptRestoreTimeout();

    resetTerminalRunCapture();
    bufferedTerminalWrite = '';
    pendingTerminalWriteCallbacks.length = 0;
    isTerminalWriteInFlight = false;
    pendingScrollToBottomAfterWrite = false;
    shouldFitBeforeNextVisibleWrite = false;
    previousHostSize = { width: 0, height: 0 };

    disposeWebglRenderer();
  });

  return {
    hostRef,
    status,
    statusMessage,
    retry,
    focusTerminal,
  };
};