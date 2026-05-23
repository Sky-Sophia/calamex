<template>
  <div
    class="shell-editor-surface codemirror-editor-surface relative h-full min-h-0 w-full bg-(--editor-bg)"
    @contextmenu.prevent="handleContainerContextMenu"
  >
    <div ref="containerRef" class="h-full min-h-0 w-full bg-(--editor-bg)" />
    <section v-if="aiActionResult || isAiActionRunning || aiActionError" class="ai-code-action-card">
      <div class="ai-code-action-head">
        <span>{{ isAiActionRunning ? 'AI 正在分析…' : 'AI Code Action' }}</span>
        <button type="button" aria-label="关闭 AI 结果" @click="clearAiActionResult">×</button>
      </div>
      <p v-if="aiActionError" class="is-error">{{ aiActionError }}</p>
      <template v-else-if="aiActionResult">
        <p>{{ aiActionResult.explanation }}</p>
        <ul v-if="aiActionResult.followUpQuestions.length">
          <li v-for="question in aiActionResult.followUpQuestions" :key="question">
            {{ question }}
          </li>
        </ul>
        <p v-if="aiActionResult.testSuggestion" class="ai-code-action-note">
          {{ aiActionResult.testSuggestion }}
        </p>
      </template>
    </section>
    <EditorContextMenu
      :open="contextMenuState.open"
      :x="contextMenuState.x"
      :y="contextMenuState.y"
      :groups="contextMenuGroups"
      :theme="props.theme"
      :submenu-direction="submenuDirection"
      @select="handleContextMenuItemSelect"
    />
  </div>
</template>

<script setup lang="ts">
import type { IEditorContextMenuItem } from '@/components/editor/editor-context-menu.types';
import EditorContextMenu from '@/components/editor/EditorContextMenu.vue';
import { buildCodeMirrorSettingsExtensions } from '@/services/editor/codemirror-config';
import { createCodeMirrorInlineCompletionController } from '@/services/editor/codemirror-inline-completion';
import { resolveCodeMirrorLanguageExtension } from '@/services/editor/codemirror-language';
import { aiService } from '@/services/ipc/ai.service';
import { useEditorStore } from '@/store/editor';
import type { IAiCodeActionRequest, IAiCodeActionResult } from '@/types/ai';
import type { TThemeMode } from '@/types/app';
import type { IAnalyzeScriptPayload, IEditorSelectionSummary, TScriptDiagnosticSeverity } from '@/types/editor';
import type { IEditorSettings } from '@/types/settings';
import { tryReadClipboardText, writeClipboardText } from '@/utils/clipboard';
import { resolveLanguageForPath } from '@/utils/editor-language';
import {
  SHELL_WINDOW_RESIZE_END_EVENT,
  SHELL_WINDOW_RESIZE_SETTLED_EVENT,
  SHELL_WINDOW_RESIZE_START_EVENT,
} from '@/utils/window-resize-events';
import { acceptCompletion, autocompletion, completeAnyWord, snippet } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { githubLight } from '@fsegurai/codemirror-theme-github-light';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  toggleLineComment,
  undo,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
} from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, gotoLine, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension, type SelectionRange } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  scrollPastEnd,
  type ViewUpdate,
} from '@codemirror/view';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface IEditorExpose {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
  revealPosition: (line: number, column: number) => void;
  layoutEditor: () => void;
  runAiCodeAction: (kind: IAiCodeActionRequest['kind']) => Promise<void>;
}

const VIEW_STATE_SAVE_DEBOUNCE_MS = 500;
const MENU_WIDTH = 224;
const SUBMENU_SAFE_WIDTH = 224;
const VIEWPORT_PADDING = 12;
const MENU_ROOT_SELECTOR = '.linear-context-menu-root';
const MENU_TRIGGER_SELECTOR = '.linear-context-menu-trigger';
const createEmptyAnalysis = (): IAnalyzeScriptPayload => ({
  available: true,
  message: null,
  dialect: 'bash',
  diagnostics: [],
});

const props = withDefaults(
  defineProps<{
    documentPath?: string | null;
    documentName?: string;
    modelValue?: string;
    theme?: TThemeMode;
    analysis?: IAnalyzeScriptPayload;
    editorSettings: IEditorSettings;
    canRun?: boolean;
  }>(),
  {
    documentPath: null,
    documentName: '',
    modelValue: '',
    theme: 'dark',
    analysis: undefined,
    canRun: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'cursor-position-change': [line: number, column: number];
  'selection-change': [selection: IEditorSelectionSummary | null];
  'format-request': [];
  'command-palette-request': [];
  'run-request': [];
  'open-terminal-request': [];
}>();

const containerRef = ref<HTMLElement | null>(null);
const analysisState = computed(() => props.analysis ?? createEmptyAnalysis());
const aiActionResult = ref<IAiCodeActionResult | null>(null);
const aiActionError = ref('');
const isAiActionRunning = ref(false);
const contextMenuState = ref({ open: false, x: 0, y: 0 });
const contextMenuGroups = ref<ReturnType<typeof buildMenuGroups>>([]);
const submenuDirection = ref<'left' | 'right'>('right');
const editorStore = useEditorStore();

let editorView: EditorView | null = null;
let resizeObserver: ResizeObserver | null = null;
let editorLayoutFrameId: number | null = null;
let viewStateSaveTimerId: number | null = null;
let suppressModelValueEmit = false;
let previousContainerSize = { width: 0, height: 0 };
let isShellWindowResizing = false;
let pendingEditorLayoutAfterWindowResize = false;
const languageCompartment = new Compartment();
const settingsCompartment = new Compartment();
const completionCompartment = new Compartment();
const inlineCompletionController = createCodeMirrorInlineCompletionController({
  getFilePath: () => props.documentPath,
  getLanguage: () => getCurrentLanguage(),
});

const buildCompletionExtension = (editorSettings: IEditorSettings, language: string): Extension =>
  editorSettings.commandCompletion
    ? autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: editorSettings.suggestionDelay,
      override: language === 'shell'
        ? [async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
          const { createShellCodeMirrorCompletionSource } = await import('@/utils/shell-completion');
          return createShellCodeMirrorCompletionSource()(completionContext);
        }]
        : [completeAnyWord],
      maxRenderedOptions: 80,
    })
    : [];

const getCurrentLanguage = (): string =>
  resolveLanguageForPath(props.documentPath, props.documentName);

const lineColumnToOffset = (view: EditorView, line: number, column: number): number => {
  const lineInfo = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
  return Math.min(lineInfo.to, lineInfo.from + Math.max(0, column - 1));
};

const selectionRangeToText = (view: EditorView, range: SelectionRange): string =>
  view.state.doc.sliceString(range.from, range.to);

const resolveSelectedText = (): string => {
  const view = editorView;
  if (!view) {
    return '';
  }

  const selectedRanges = view.state.selection.ranges.filter((range) => !range.empty);
  if (selectedRanges.length > 0) {
    return selectedRanges.map((range) => selectionRangeToText(view, range)).join('\n');
  }

  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  return line.text;
};

const resolveSelectionSummary = (): IEditorSelectionSummary | null => {
  const view = editorView;
  const range = view?.state.selection.main;
  if (!view || !range || range.empty) {
    return null;
  }

  const selectedText = selectionRangeToText(view, range);
  if (!selectedText.trim()) {
    return null;
  }

  const chars = [...selectedText];
  return {
    text: chars.length > 4_000 ? `${chars.slice(0, 4_000).join('')}\n[已截断]` : selectedText,
    startLine: view.state.doc.lineAt(range.from).number,
    endLine: view.state.doc.lineAt(range.to).number,
  };
};

const emitCursorPosition = (view: EditorView): void => {
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  emit('cursor-position-change', line.number, position - line.from + 1);
};

const emitSelectionSummary = (): void => {
  emit('selection-change', resolveSelectionSummary());
};

const clearAiActionResult = (): void => {
  aiActionResult.value = null;
  aiActionError.value = '';
  isAiActionRunning.value = false;
};

const runAiCodeAction = async (
  kind: IAiCodeActionRequest['kind'],
  selection: string,
): Promise<void> => {
  if (isAiActionRunning.value) {
    return;
  }

  isAiActionRunning.value = true;
  aiActionError.value = '';
  aiActionResult.value = null;

  try {
    aiActionResult.value = await aiService.codeAction({
      kind,
      filePath: props.documentPath ?? null,
      language: getCurrentLanguage(),
      selection,
      diagnostics: analysisState.value.diagnostics.map((item) => `${item.code}: ${item.message}`),
    });
  } catch (error) {
    aiActionError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isAiActionRunning.value = false;
  }
};

const runAiCodeActionFromEditor = async (
  kind: IAiCodeActionRequest['kind'],
): Promise<void> => {
  const selection = resolveSelectedText();
  await runAiCodeAction(kind, selection);
};

const clearViewStateSaveTimer = (): void => {
  if (viewStateSaveTimerId !== null) {
    window.clearTimeout(viewStateSaveTimerId);
    viewStateSaveTimerId = null;
  }
};

const persistViewState = (path: string | null | undefined): void => {
  const view = editorView;
  if (!view || !path) {
    return;
  }

  editorStore.saveEditorViewState(path, {
    anchor: view.state.selection.main.anchor,
    head: view.state.selection.main.head,
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
  });
};

const scheduleViewStatePersist = (): void => {
  clearViewStateSaveTimer();
  viewStateSaveTimerId = window.setTimeout(() => {
    viewStateSaveTimerId = null;
    persistViewState(props.documentPath);
  }, VIEW_STATE_SAVE_DEBOUNCE_MS);
};

const readNumberField = (value: Record<string, unknown>, key: string): number | null => {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
};

const restoreViewStateForPath = (path: string | null | undefined): void => {
  const view = editorView;
  if (!view || !path) {
    return;
  }

  const savedState = editorStore.getEditorViewState(path);
  if (!savedState) {
    return;
  }

  const anchor = readNumberField(savedState, 'anchor');
  const head = readNumberField(savedState, 'head') ?? anchor;
  if (anchor !== null) {
    const maxPosition = view.state.doc.length;
    const selection = EditorSelection.single(
      Math.min(Math.max(0, anchor), maxPosition),
      Math.min(Math.max(0, head ?? anchor), maxPosition),
    );
    view.dispatch({
      selection,
      effects: EditorView.scrollIntoView(selection.main.head, { y: 'center' }),
    });
  }

  const scrollTop = readNumberField(savedState, 'scrollTop');
  const scrollLeft = readNumberField(savedState, 'scrollLeft');
  if (scrollTop !== null || scrollLeft !== null) {
    requestAnimationFrame(() => {
      if (!editorView) {
        return;
      }
      editorView.scrollDOM.scrollTop = scrollTop ?? editorView.scrollDOM.scrollTop;
      editorView.scrollDOM.scrollLeft = scrollLeft ?? editorView.scrollDOM.scrollLeft;
    });
  }
};

const toDiagnosticSeverity = (level: TScriptDiagnosticSeverity): Diagnostic['severity'] => {
  switch (level) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'style':
      return 'hint';
    default:
      return 'info';
  }
};

const syncDiagnostics = (): void => {
  const view = editorView;
  if (!view) {
    return;
  }

  const diagnostics = analysisState.value.available
    ? analysisState.value.diagnostics.map((item): Diagnostic => {
      const from = lineColumnToOffset(view, item.line, item.column);
      const to = Math.max(from + 1, lineColumnToOffset(view, item.endLine, item.endColumn));
      return {
        from,
        to: Math.min(to, view.state.doc.length),
        severity: toDiagnosticSeverity(item.level),
        source: item.code,
        message: `${item.code} · ${item.message}`,
      };
    })
    : [];

  view.dispatch(setDiagnostics(view.state, diagnostics));
};

const layoutEditor = (): void => {
  editorView?.requestMeasure();
};

const scheduleEditorLayout = (): void => {
  if (isShellWindowResizing) {
    pendingEditorLayoutAfterWindowResize = true;
    return;
  }

  if (editorLayoutFrameId !== null) {
    return;
  }

  editorLayoutFrameId = window.requestAnimationFrame(() => {
    editorLayoutFrameId = null;
    layoutEditor();
  });
};

const updatePreviousContainerSize = (): void => {
  if (!containerRef.value) {
    return;
  }

  previousContainerSize = {
    width: Math.round(containerRef.value.clientWidth),
    height: Math.round(containerRef.value.clientHeight),
  };
};

const handleShellWindowResizeStart = (): void => {
  isShellWindowResizing = true;
  pendingEditorLayoutAfterWindowResize = false;

  if (editorLayoutFrameId !== null) {
    window.cancelAnimationFrame(editorLayoutFrameId);
    editorLayoutFrameId = null;
  }
};

const handleShellWindowResizeEnd = (): void => {
  const shouldRelayout = pendingEditorLayoutAfterWindowResize || editorView !== null;
  pendingEditorLayoutAfterWindowResize = false;
  pendingEditorLayoutAfterWindowResize = shouldRelayout;
};

const handleShellWindowResizeSettled = (): void => {
  isShellWindowResizing = false;
  updatePreviousContainerSize();
  const shouldRelayout = pendingEditorLayoutAfterWindowResize || editorView !== null;
  pendingEditorLayoutAfterWindowResize = false;
  if (shouldRelayout) {
    scheduleEditorLayout();
  }
};

const closeContextMenu = (): void => {
  contextMenuState.value.open = false;
  contextMenuGroups.value = [];
};

const clampMenuPosition = (clientX: number, clientY: number) => ({
  x: Math.min(clientX, Math.max(VIEWPORT_PADDING, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING)),
  y: Math.min(clientY, Math.max(VIEWPORT_PADDING, window.innerHeight - 320 - VIEWPORT_PADDING)),
});

const buildMenuGroups = (): Array<{ key: string; items: IEditorContextMenuItem[] }> => {
  const hasDocument = Boolean(editorView);
  const selectedText = resolveSelectedText().trim();
  const canRunAiAction = hasDocument && selectedText.length > 0;

  return [
    {
      key: 'run-actions',
      items: [
        {
          key: 'open-terminal',
          label: '打开终端',
          icon: 'terminal',
          action: 'open-terminal',
          disabled: false,
        },
        {
          key: 'run-current-script',
          label: '运行当前脚本',
          icon: 'play',
          action: 'run-current-script',
          disabled: !props.canRun,
        },
      ],
    },
    {
      key: 'history-actions',
      items: [
        { key: 'undo', label: '撤销', icon: 'undo', action: 'undo', disabled: !hasDocument },
        { key: 'redo', label: '恢复撤销', icon: 'redo', action: 'redo', disabled: !hasDocument },
      ],
    },
    {
      key: 'code-actions',
      items: [
        {
          key: 'format-tools',
          label: '格式与注释',
          icon: 'format',
          disabled: !hasDocument,
          children: [
            {
              key: 'format-with-shfmt',
              label: '使用 shfmt 格式化',
              icon: 'format',
              action: 'format-with-shfmt',
              disabled: !hasDocument,
            },
            {
              key: 'toggle-comment-line',
              label: '切换行注释',
              icon: 'comment',
              action: 'toggle-comment-line',
              disabled: !hasDocument,
            },
          ],
        },
        {
          key: 'find-tools',
          label: '查找与跳转',
          icon: 'search',
          disabled: !hasDocument,
          children: [
            { key: 'find', label: '查找', icon: 'search', action: 'find', disabled: !hasDocument },
            { key: 'goto-line', label: '转到行 / 列', icon: 'goto', action: 'goto-line', disabled: !hasDocument },
          ],
        },
      ],
    },
    {
      key: 'edit-actions',
      items: [
        { key: 'cut', label: '剪切', icon: 'cut', action: 'cut', disabled: !hasDocument },
        { key: 'copy', label: '复制', icon: 'copy', action: 'copy', disabled: !hasDocument },
        { key: 'paste', label: '粘贴', icon: 'paste', action: 'paste', disabled: !hasDocument },
        { key: 'select-all', label: '全选', icon: 'select-all', action: 'select-all', disabled: !hasDocument },
      ],
    },
    {
      key: 'ai-actions',
      items: [
        {
          key: 'ai-explain-selection',
          label: 'AI 解释选区',
          icon: 'search',
          action: 'ai-explain-selection',
          disabled: !canRunAiAction,
        },
        {
          key: 'ai-fix-diagnostic',
          label: 'AI 修复诊断',
          icon: 'wrench',
          action: 'ai-fix-diagnostic',
          disabled: !canRunAiAction,
        },
        {
          key: 'ai-generate-tests',
          label: 'AI 生成测试',
          icon: 'flask',
          action: 'ai-generate-tests',
          disabled: !canRunAiAction,
        },
      ],
    },
  ];
};

const openContextMenu = (event: MouseEvent): void => {
  if (!editorView) {
    return;
  }

  const nextPosition = clampMenuPosition(event.clientX, event.clientY);
  contextMenuGroups.value = buildMenuGroups();
  contextMenuState.value = { open: true, x: nextPosition.x, y: nextPosition.y };
  submenuDirection.value =
    nextPosition.x + MENU_WIDTH + SUBMENU_SAFE_WIDTH + VIEWPORT_PADDING > window.innerWidth
      ? 'left'
      : 'right';
};

const handleContainerContextMenu = (event: MouseEvent): void => {
  editorView?.focus();
  openContextMenu(event);
};

const isTargetInsideMenu = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.closest(MENU_ROOT_SELECTOR) !== null || target.closest(MENU_TRIGGER_SELECTOR) !== null);

const handleWindowPointerDown = (event: PointerEvent): void => {
  if (!contextMenuState.value.open || isTargetInsideMenu(event.target)) {
    return;
  }

  closeContextMenu();
};

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (contextMenuState.value.open && event.key === 'Escape') {
    closeContextMenu();
  }
};

const handleWindowResize = (): void => {
  if (contextMenuState.value.open) {
    closeContextMenu();
  }
};

const copyEditorSelection = async (): Promise<void> => {
  const text = resolveSelectedText();
  if (text.trim()) {
    await writeClipboardText(text);
  }
};

const cutEditorSelection = async (): Promise<void> => {
  const view = editorView;
  if (!view) {
    return;
  }

  const ranges = view.state.selection.ranges;
  const selectedText = ranges.filter((range) => !range.empty)
    .map((range) => selectionRangeToText(view, range))
    .join('\n');
  if (!selectedText) {
    return;
  }

  await writeClipboardText(selectedText);
  view.dispatch({
    changes: ranges.map((range) => ({ from: range.from, to: range.to, insert: '' })),
  });
};

const pasteIntoEditor = async (): Promise<void> => {
  const view = editorView;
  if (!view) {
    return;
  }

  const clipboardText = await tryReadClipboardText();
  if (clipboardText === null) {
    return;
  }

  view.dispatch(view.state.replaceSelection(clipboardText));
  view.focus();
};

const handleContextMenuItemSelect = async (item: IEditorContextMenuItem): Promise<void> => {
  const view = editorView;
  closeContextMenu();
  if (!view || !item.action) {
    return;
  }

  view.focus();

  switch (item.action) {
    case 'ai-explain-selection':
      await runAiCodeAction('explain_selection', resolveSelectedText());
      return;
    case 'ai-fix-diagnostic':
      await runAiCodeAction('fix_diagnostic', resolveSelectedText());
      return;
    case 'ai-generate-tests':
      await runAiCodeAction('generate_tests', resolveSelectedText());
      return;
    case 'undo':
      undo(view);
      return;
    case 'redo':
      redo(view);
      return;
    case 'format-with-shfmt':
      emit('format-request');
      return;
    case 'toggle-comment-line':
      toggleLineComment(view);
      return;
    case 'find':
      openSearchPanel(view);
      return;
    case 'goto-line':
      gotoLine(view);
      return;
    case 'quick-command':
      emit('command-palette-request');
      return;
    case 'run-current-script':
      emit('run-request');
      return;
    case 'open-terminal':
      emit('open-terminal-request');
      return;
    case 'cut':
      await cutEditorSelection();
      return;
    case 'copy':
      await copyEditorSelection();
      return;
    case 'paste':
      await pasteIntoEditor();
      return;
    case 'select-all':
      selectAll(view);
      return;
    default:
      return;
  }
};

const handleEditorUpdate = (update: ViewUpdate): void => {
  if (update.docChanged && !suppressModelValueEmit) {
    closeContextMenu();
    emit('update:modelValue', update.state.doc.toString());
  }

  if (update.selectionSet || update.docChanged) {
    emitCursorPosition(update.view);
    emitSelectionSummary();
    scheduleViewStatePersist();
    inlineCompletionController.handleUpdate(update);
  }

  if (update.viewportChanged) {
    closeContextMenu();
    scheduleViewStatePersist();
  }
};

const createBaseExtensions = (language: string): Extension[] => [
  highlightSpecialChars(),
  githubLight,
  history(),
  drawSelection(),
  dropCursor(),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightSelectionMatches(),
  search({ top: true }),
  lintGutter(),
  scrollPastEnd(),
  ...inlineCompletionController.extensions,
  keymap.of([
    indentWithTab,
    { key: 'Alt-Shift-f', run: () => { emit('format-request'); return true; } },
    { key: 'Mod-Enter', run: () => { emit('run-request'); return true; } },
    { key: 'Ctrl-Space', run: acceptCompletion },
    ...defaultKeymap,
    ...historyKeymap,
    ...searchKeymap,
  ]),
  languageCompartment.of(resolveCodeMirrorLanguageExtension(language)),
  settingsCompartment.of(buildCodeMirrorSettingsExtensions(props.editorSettings)),
  completionCompartment.of(buildCompletionExtension(props.editorSettings, language)),
  EditorView.updateListener.of(handleEditorUpdate),
];

const createEditor = (): void => {
  if (!containerRef.value || editorView) {
    return;
  }

  const language = getCurrentLanguage();
  editorView = new EditorView({
    parent: containerRef.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: createBaseExtensions(language),
    }),
  });

  emitCursorPosition(editorView);
  syncDiagnostics();
  restoreViewStateForPath(props.documentPath);
  requestAnimationFrame(() => scheduleEditorLayout());
};

const reconfigureLanguage = (): void => {
  const view = editorView;
  if (!view) {
    return;
  }

  const language = getCurrentLanguage();
  inlineCompletionController.clear();
  view.dispatch({
    effects: [
      languageCompartment.reconfigure(resolveCodeMirrorLanguageExtension(language)),
      completionCompartment.reconfigure(buildCompletionExtension(props.editorSettings, language)),
    ],
  });
};

const reconfigureSettings = (): void => {
  const view = editorView;
  if (!view) {
    return;
  }

  view.dispatch({
    effects: [
      settingsCompartment.reconfigure(buildCodeMirrorSettingsExtensions(props.editorSettings)),
      completionCompartment.reconfigure(buildCompletionExtension(props.editorSettings, getCurrentLanguage())),
    ],
  });
  scheduleEditorLayout();
};

watch(
  () => [props.documentPath, props.documentName] as const,
  ([nextPath], [previousPath]) => {
    if (previousPath) {
      persistViewState(previousPath);
    }

    reconfigureLanguage();
    restoreViewStateForPath(nextPath);
  },
  { flush: 'sync' },
);

watch(
  () => props.modelValue,
  (value) => {
    const view = editorView;
    if (!view || view.state.doc.toString() === value) {
      return;
    }

    suppressModelValueEmit = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    suppressModelValueEmit = false;
  },
);

watch(
  () => props.analysis,
  () => syncDiagnostics(),
  { deep: true },
);

watch(
  () => props.editorSettings,
  () => reconfigureSettings(),
  { deep: true },
);

onMounted(() => {
  createEditor();
  window.addEventListener(SHELL_WINDOW_RESIZE_START_EVENT, handleShellWindowResizeStart);
  window.addEventListener(SHELL_WINDOW_RESIZE_END_EVENT, handleShellWindowResizeEnd);
  window.addEventListener(SHELL_WINDOW_RESIZE_SETTLED_EVENT, handleShellWindowResizeSettled);
  window.addEventListener('pointerdown', handleWindowPointerDown, true);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('blur', handleWindowResize);

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    updatePreviousContainerSize();
    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.value) {
        return;
      }

      const nextWidth = Math.round(containerRef.value.clientWidth);
      const nextHeight = Math.round(containerRef.value.clientHeight);

      if (previousContainerSize.width === nextWidth && previousContainerSize.height === nextHeight) {
        return;
      }

      previousContainerSize = { width: nextWidth, height: nextHeight };
      scheduleEditorLayout();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener(SHELL_WINDOW_RESIZE_START_EVENT, handleShellWindowResizeStart);
  window.removeEventListener(SHELL_WINDOW_RESIZE_END_EVENT, handleShellWindowResizeEnd);
  window.removeEventListener(SHELL_WINDOW_RESIZE_SETTLED_EVENT, handleShellWindowResizeSettled);
  window.removeEventListener('pointerdown', handleWindowPointerDown, true);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('blur', handleWindowResize);

  persistViewState(props.documentPath);
  clearViewStateSaveTimer();
  inlineCompletionController.destroy();
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (editorLayoutFrameId !== null) {
    window.cancelAnimationFrame(editorLayoutFrameId);
    editorLayoutFrameId = null;
  }

  closeContextMenu();
  editorView?.destroy();
  editorView = null;
});

const focusEditor = (): void => {
  editorView?.focus();
};

const insertSnippet = (snippetText: string): void => {
  const view = editorView;
  if (!view) {
    return;
  }

  const range = view.state.selection.main;
  snippet(snippetText)(view, null, range.from, range.to);
  view.focus();
};

const revealPosition = (line: number, column: number): void => {
  const view = editorView;
  if (!view) {
    return;
  }

  const position = lineColumnToOffset(view, line, column);
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  });
  view.focus();
};

defineExpose<IEditorExpose>({
  focusEditor,
  insertSnippet,
  revealPosition,
  layoutEditor,
  runAiCodeAction: runAiCodeActionFromEditor,
});
</script>

<style scoped src="./CodeMirrorScriptEditor.css"></style>
