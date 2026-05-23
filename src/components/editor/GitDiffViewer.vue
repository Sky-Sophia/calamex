<template>
  <section class="git-diff-viewer" aria-label="Git Diff Preview">
    <section v-if="preview.isEmpty" class="git-diff-viewer-empty">
      <strong>没有可显示的 Diff</strong>
      <p>当前文件在这个 Git 区域没有内容差异。</p>
    </section>

    <div v-else ref="diffHostRef" class="git-diff-viewer-surface" />
  </section>
</template>

<script setup lang="ts">
import { buildCodeMirrorSettingsExtensions } from '@/services/editor/codemirror-config';
import { resolveCodeMirrorLanguageExtension } from '@/services/editor/codemirror-language';
import type { TThemeMode } from '@/types/app';
import type { IGitDiffPreviewPayload } from '@/types/git';
import type { IEditorSettings } from '@/types/settings';
import { resolveLanguageForPath } from '@/utils/editor-language';
import { MergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { EditorView, highlightSpecialChars } from '@codemirror/view';
import { githubLight } from '@fsegurai/codemirror-theme-github-light';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  preview: IGitDiffPreviewPayload;
  theme: TThemeMode;
  editorSettings: IEditorSettings;
}>();

const diffHostRef = ref<HTMLElement | null>(null);

let mergeView: MergeView | null = null;
let resizeObserver: ResizeObserver | null = null;
let layoutFrameId: number | null = null;

const buildDiffEditorExtensions = (language: string): Extension[] => [
  highlightSpecialChars(),
  githubLight,
  resolveCodeMirrorLanguageExtension(language),
  buildCodeMirrorSettingsExtensions(props.editorSettings, {
    activeLine: false,
    autoClosingPairs: false,
    editable: false,
    foldGutter: false,
    readOnly: true,
  }),
  EditorView.contentAttributes.of({ 'aria-readonly': 'true' }),
];

const buildMergeView = (host: HTMLElement): MergeView => {
  const language = resolveLanguageForPath(props.preview.relativePath);
  const extensions = buildDiffEditorExtensions(language);

  return new MergeView({
    a: {
      doc: props.preview.originalContent,
      extensions,
    },
    b: {
      doc: props.preview.modifiedContent,
      extensions,
    },
    collapseUnchanged: {
      margin: 3,
      minSize: 8,
    },
    diffConfig: {
      scanLimit: 1_000,
      timeout: 500,
    },
    gutter: true,
    highlightChanges: true,
    parent: host,
    revertControls: undefined,
  });
};

const layoutDiffEditor = (): boolean => {
  const host = diffHostRef.value;
  if (!host || !mergeView) {
    return false;
  }

  if (host.clientWidth <= 0 || host.clientHeight <= 0) {
    return false;
  }

  mergeView.a.requestMeasure();
  mergeView.b.requestMeasure();
  return true;
};

const scheduleLayout = (): void => {
  if (layoutFrameId !== null) {
    window.cancelAnimationFrame(layoutFrameId);
  }

  layoutFrameId = window.requestAnimationFrame(() => {
    layoutFrameId = null;
    layoutDiffEditor();
  });
};

const disposeDiffEditor = (): void => {
  if (layoutFrameId !== null) {
    window.cancelAnimationFrame(layoutFrameId);
    layoutFrameId = null;
  }

  resizeObserver?.disconnect();
  resizeObserver = null;
  mergeView?.destroy();
  mergeView = null;
};

const mountDiffEditor = async (): Promise<void> => {
  const host = diffHostRef.value;
  if (!host || props.preview.isEmpty) {
    return;
  }

  mergeView = buildMergeView(host);
  await nextTick();
  scheduleLayout();

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleLayout());
    resizeObserver.observe(host);
  }
};

const remountDiffEditor = async (): Promise<void> => {
  disposeDiffEditor();
  await nextTick();
  await mountDiffEditor();
};

onMounted(() => {
  void mountDiffEditor();
});

onBeforeUnmount(() => {
  disposeDiffEditor();
});

watch(
  () => [
    props.preview.id,
    props.preview.originalContent,
    props.preview.modifiedContent,
    props.preview.isEmpty,
    props.theme,
    props.editorSettings,
  ],
  () => {
    void remountDiffEditor();
  },
  { deep: true },
);
</script>

<style scoped>
.git-diff-viewer {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  background: var(--editor-bg);
  color: var(--text-primary);
}

.git-diff-viewer-surface {
  min-height: 0;
  height: 100%;
  flex: 1 1 auto;
  overflow: hidden;
}

.git-diff-viewer-surface :deep(.cm-mergeView) {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  outline: none;
}

.git-diff-viewer-surface :deep(.cm-mergeViewEditors) {
  height: 100%;
  min-height: 0;
}

.git-diff-viewer-surface :deep(.cm-mergeViewEditor) {
  min-width: 0;
}

.git-diff-viewer-empty {
  display: grid;
  min-height: 0;
  flex: 1;
  place-content: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xl);
  text-align: center;
}

.git-diff-viewer-empty strong {
  font-size: var(--font-size-base);
  font-weight: 600;
}

.git-diff-viewer-empty p {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>
