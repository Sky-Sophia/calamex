import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GitDiffViewer from '@/components/editor/GitDiffViewer.vue';
import { createDefaultAppSettings } from '@/types/settings';
import type { IGitDiffPreviewPayload } from '@/types/git';
import type { IEditorSettings } from '@/types/settings';

const monacoFacadeMock = vi.hoisted(() => {
  const createDiffEditorOptions: unknown[] = [];
  const diffEditor = {
    dispose: vi.fn(),
    layout: vi.fn(),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
  };

  return {
    applyMonacoTheme: vi.fn(),
    createDiffEditor: vi.fn((_host: HTMLElement, options: unknown) => {
      createDiffEditorOptions.push(options);
      return diffEditor;
    }),
    createDiffEditorOptions,
    createModel: vi.fn((content: string, language: string) => ({
      content,
      dispose: vi.fn(),
      language,
    })),
    diffEditor,
    resolveLanguageForPath: vi.fn(() => 'c'),
  };
});

vi.mock('@/utils/monaco', () => ({
  applyMonacoTheme: monacoFacadeMock.applyMonacoTheme,
  monaco: {
    editor: {
      createDiffEditor: monacoFacadeMock.createDiffEditor,
      createModel: monacoFacadeMock.createModel,
    },
  },
  resolveLanguageForPath: monacoFacadeMock.resolveLanguageForPath,
}));

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const createPreview = (): IGitDiffPreviewPayload => ({
  id: 'git-diff:worktree:D:/repo:demo.c',
  repositoryRootPath: 'D:/repo',
  path: 'D:/repo/demo.c',
  relativePath: 'demo.c',
  title: 'demo.c · 工作区 Diff',
  mode: 'worktree',
  originalContent: 'int main(void) {\n  return 0;\n}',
  modifiedContent: 'int main(void) {\n  printf("这是一行很长的中文内容，需要在视口边界自动换行");\n  return 0;\n}',
  isEmpty: false,
});

const createEditorSettings = (): IEditorSettings => createDefaultAppSettings().editor;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getFirstDiffEditorOptions = (): Record<string, unknown> => {
  const options = monacoFacadeMock.createDiffEditorOptions[0];
  if (!isRecord(options)) {
    throw new Error('DiffEditor options 未被创建');
  }
  return options;
};

describe('GitDiffViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    monacoFacadeMock.createDiffEditorOptions.splice(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('Git Diff 超长行按视口自动换行，行号仍按模型行渲染', async () => {
    const wrapper = mount(GitDiffViewer, {
      props: {
        editorSettings: createEditorSettings(),
        preview: createPreview(),
        theme: 'light',
      },
    });

    await flushPromises();

    const options = getFirstDiffEditorOptions();
    expect(options.diffWordWrap).toBe('on');
    expect(options.wordWrap).toBe('on');
    expect(options.wrappingIndent).toBe('same');
    expect(options.lineNumbers).toBe('on');

    wrapper.unmount();
  });
});
