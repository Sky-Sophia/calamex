import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GitDiffViewer from '@/components/editor/GitDiffViewer.vue';
import { createDefaultAppSettings } from '@/types/settings';
import type { IGitDiffPreviewPayload } from '@/types/git';
import type { IEditorSettings } from '@/types/settings';

const mergeViewMock = vi.hoisted(() => {
  const configs: unknown[] = [];
  const view = {
    a: { requestMeasure: vi.fn() },
    b: { requestMeasure: vi.fn() },
    destroy: vi.fn(),
  };

  return {
    configs,
    destroy: view.destroy,
    requestMeasureA: view.a.requestMeasure,
    requestMeasureB: view.b.requestMeasure,
  };
});

vi.mock('@codemirror/merge', () => ({
  MergeView: class {
    a = { requestMeasure: mergeViewMock.requestMeasureA };
    b = { requestMeasure: mergeViewMock.requestMeasureB };

    constructor(config: unknown) {
      mergeViewMock.configs.push(config);
    }

    destroy() {
      mergeViewMock.destroy();
    }
  },
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

const getFirstMergeViewConfig = (): Record<string, unknown> => {
  const config = mergeViewMock.configs[0];
  if (!isRecord(config)) {
    throw new Error('MergeView config 未被创建');
  }
  return config;
};

describe('GitDiffViewer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mergeViewMock.configs.splice(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('Git Diff 使用 CodeMirror MergeView 并保留只读双栏与折叠未变更配置', async () => {
    const wrapper = mount(GitDiffViewer, {
      props: {
        editorSettings: createEditorSettings(),
        preview: createPreview(),
        theme: 'light',
      },
    });

    await flushPromises();

    const config = getFirstMergeViewConfig();
    expect(mergeViewMock.configs).toHaveLength(1);
    expect(config.gutter).toBe(true);
    expect(config.highlightChanges).toBe(true);
    expect(config.revertControls).toBeUndefined();
    expect(config.collapseUnchanged).toEqual({ margin: 3, minSize: 8 });
    expect(config.diffConfig).toEqual({ scanLimit: 1_000, timeout: 500 });

    wrapper.unmount();
    expect(mergeViewMock.destroy).toHaveBeenCalled();
  });
});
