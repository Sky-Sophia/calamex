<template>
  <div class="shell-editor-surface relative h-full min-h-0 w-full bg-(--editor-bg)">
    <div ref="containerRef" class="h-full min-h-0 w-full bg-(--editor-bg)" />
  </div>
</template>

<script setup lang="ts">
import type { TThemeMode } from '@/types/app';
import type { IAnalyzeScriptPayload, TScriptDiagnosticSeverity } from '@/types/editor';
import { applyMonacoTheme, monaco } from '@/utils/monaco';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface IEditorExpose {
  focusEditor: () => void;
  insertSnippet: (snippet: string) => void;
  revealPosition: (line: number, column: number) => void;
}

const createEmptyAnalysis = (): IAnalyzeScriptPayload => ({
  available: true,
  message: null,
  dialect: 'bash',
  diagnostics: [],
});

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    theme?: TThemeMode;
    analysis?: IAnalyzeScriptPayload;
  }>(),
  {
    modelValue: '',
    theme: 'dark',
    analysis: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'cursor-position-change': [line: number, column: number];
  'format-request': [];
}>();

const containerRef = ref<HTMLElement | null>(null);
const analysisState = computed(() => props.analysis ?? createEmptyAnalysis());

let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;
let suppressModelValueEmit = false;
let resizeObserver: ResizeObserver | null = null;
let editorLayoutFrameId: number | null = null;
let shellCompletionRegistrationTimerId: number | null = null;
let shellCompletionRegistrationPromise: Promise<void> | null = null;
let previousContainerSize = { width: 0, height: 0 };

const toMarkerSeverity = (level: TScriptDiagnosticSeverity): monaco.MarkerSeverity => {
  switch (level) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'style':
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
};

const syncMarkers = (): void => {
  const model = editorInstance?.getModel();
  if (!model) {
    return;
  }

  const markers = analysisState.value.available
    ? analysisState.value.diagnostics.map((item) => ({
        startLineNumber: item.line,
        endLineNumber: item.endLine,
        startColumn: item.column,
        endColumn: Math.max(item.column + 1, item.endColumn),
        severity: toMarkerSeverity(item.level),
        message: `${item.code} · ${item.message}`,
        source: 'ShellCheck',
        code: item.code,
      }))
    : [];

  monaco.editor.setModelMarkers(model, 'shellcheck', markers);
};

const layoutEditor = (): void => {
  editorInstance?.layout();
};

const scheduleEditorLayout = (): void => {
  if (editorLayoutFrameId !== null) {
    return;
  }

  editorLayoutFrameId = window.requestAnimationFrame(() => {
    editorLayoutFrameId = null;
    layoutEditor();
  });
};

const setTheme = (theme: TThemeMode): void => {
  applyMonacoTheme(theme);
};

const ensureShellCompletionProvider = async (): Promise<void> => {
  if (!shellCompletionRegistrationPromise) {
    shellCompletionRegistrationPromise = import('@/utils/shell-completion')
      .then(({ registerShellCompletionProvider }) => {
        registerShellCompletionProvider(monaco);
      })
      .catch((error) => {
        shellCompletionRegistrationPromise = null;
        console.error('Shell completion provider preload failed', error);
      });
  }

  await shellCompletionRegistrationPromise;
};

const scheduleShellCompletionRegistration = (): void => {
  if (shellCompletionRegistrationTimerId !== null) {
    return;
  }

  shellCompletionRegistrationTimerId = window.setTimeout(() => {
    shellCompletionRegistrationTimerId = null;
    void ensureShellCompletionProvider();
  }, 0);
};

const createEditor = (): void => {
  if (!containerRef.value) {
    return;
  }

  setTheme(props.theme);

  editorInstance = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: 'shell',
    automaticLayout: false,
    minimap: { enabled: false },
    lineNumbers: 'on',
    lineDecorationsWidth: 16,
    lineNumbersMinChars: 3,
    fontSize: 13,
    fontWeight: '400',
    fontFamily: "Berkeley Mono, JetBrains Mono, Consolas, 'Courier New', monospace",
    padding: {
      top: 18,
      bottom: 24,
    },
    roundedSelection: false,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    insertSpaces: true,
    guides: {
      indentation: true,
    },
    renderWhitespace: 'selection',
    quickSuggestions: {
      other: true,
      comments: false,
      strings: true,
    },
    suggestOnTriggerCharacters: true,
    autoIndent: 'advanced',
    folding: true,
    foldingStrategy: 'auto',
    smoothScrolling: false,
    cursorBlinking: 'smooth',
    overviewRulerBorder: false,
    glyphMargin: true,
    renderValidationDecorations: 'on',
    fixedOverflowWidgets: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
  });

  editorInstance.addAction({
    id: 'sh-editor.format-with-shfmt',
    label: '使用 shfmt 格式化',
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 1.5,
    run: async () => {
      emit('format-request');
    },
  });

  editorInstance.onDidChangeModelContent(() => {
    if (!editorInstance || suppressModelValueEmit) {
      return;
    }

    emit('update:modelValue', editorInstance.getValue());
  });

  editorInstance.onDidChangeCursorPosition((event) => {
    emit('cursor-position-change', event.position.lineNumber, event.position.column);
  });

  const initialPosition = editorInstance.getPosition();
  if (initialPosition) {
    emit('cursor-position-change', initialPosition.lineNumber, initialPosition.column);
  }

  syncMarkers();
  scheduleShellCompletionRegistration();

  requestAnimationFrame(() => {
    scheduleEditorLayout();
    requestAnimationFrame(() => {
      scheduleEditorLayout();
    });
  });
};

watch(
  () => props.modelValue,
  (value) => {
    if (!editorInstance) {
      return;
    }

    if (editorInstance.getValue() !== value) {
      suppressModelValueEmit = true;
      editorInstance.setValue(value);
      suppressModelValueEmit = false;
    }
  },
);

watch(
  () => props.theme,
  (value) => {
    setTheme(value);
  },
);

watch(
  () => props.analysis,
  () => {
    syncMarkers();
  },
  { deep: true },
);

onMounted(() => {
  createEditor();

  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    previousContainerSize = {
      width: Math.round(containerRef.value.clientWidth),
      height: Math.round(containerRef.value.clientHeight),
    };

    resizeObserver = new ResizeObserver(() => {
      if (!containerRef.value) {
        return;
      }

      const nextWidth = Math.round(containerRef.value.clientWidth);
      const nextHeight = Math.round(containerRef.value.clientHeight);

      if (
        previousContainerSize.width === nextWidth &&
        previousContainerSize.height === nextHeight
      ) {
        return;
      }

      previousContainerSize = {
        width: nextWidth,
        height: nextHeight,
      };
      scheduleEditorLayout();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  const model = editorInstance?.getModel();
  if (model) {
    monaco.editor.setModelMarkers(model, 'shellcheck', []);
  }

  resizeObserver?.disconnect();
  resizeObserver = null;

  if (editorLayoutFrameId !== null) {
    window.cancelAnimationFrame(editorLayoutFrameId);
    editorLayoutFrameId = null;
  }

  if (shellCompletionRegistrationTimerId !== null) {
    window.clearTimeout(shellCompletionRegistrationTimerId);
    shellCompletionRegistrationTimerId = null;
  }

  editorInstance?.dispose();
  editorInstance = null;
});

const focusEditor = (): void => {
  editorInstance?.focus();
};

const insertSnippet = (snippet: string): void => {
  if (!editorInstance) {
    return;
  }

  const selection = editorInstance.getSelection();
  if (!selection) {
    return;
  }

  editorInstance.executeEdits('insert-snippet', [
    {
      range: selection,
      text: snippet,
      forceMoveMarkers: true,
    },
  ]);
  editorInstance.focus();
};

const revealPosition = (line: number, column: number): void => {
  if (!editorInstance) {
    return;
  }

  const position = {
    lineNumber: Math.max(1, line),
    column: Math.max(1, column),
  };

  editorInstance.revealPositionInCenter(position);
  editorInstance.setPosition(position);
  editorInstance.focus();
};

defineExpose<IEditorExpose>({
  focusEditor,
  insertSnippet,
  revealPosition,
});
</script>
