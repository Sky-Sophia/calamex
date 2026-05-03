import { useEditorStore } from '@/store/editor';
import { TERMINAL_RUN_LOG_CODES, TERMINAL_RUN_LOG_TITLES } from '@/utils/terminal-run';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

describe('editor store session state', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('打开 30 个标签后 canOpenMoreTabs 为 false', () => {
    const store = useEditorStore();

    for (let index = 0; index < 30; index += 1) {
      store.openDocumentTab({
        path: `/tmp/${index}.sh`,
        name: `${index}.sh`,
        content: '#!/bin/bash\necho test',
        encoding: 'utf-8',
        lineCount: 2,
        charCount: 20,
      });
    }

    expect(store.documents.length).toBe(30);
    expect(store.canOpenMoreTabs).toBe(false);
  });

  it('存在运行日志或终端输出时 hasRunArtifacts 为 true', () => {
    const store = useEditorStore();

    expect(store.hasRunArtifacts).toBe(false);

    store.appendLog('info', TERMINAL_RUN_LOG_TITLES.start, 'run start', {
      scope: 'run',
      runId: 'run-1',
      code: TERMINAL_RUN_LOG_CODES.start,
    });

    expect(store.hasRunArtifacts).toBe(true);

    store.clearLogs();
    expect(store.hasRunArtifacts).toBe(false);

    store.setTerminalOutput('hello');
    expect(store.hasRunArtifacts).toBe(true);
  });

  it('appendLog 会清洗 Windows 扩展路径前缀，避免运行日志展示异常路径', () => {
    const store = useEditorStore();

    const entry = store.appendLog(
      'error',
      'shfmt 格式化失败',
      String.raw`\\?\D:\test\test.sh:782:39: reached EOF without closing quote '\''`,
    );

    expect(entry.detail).toBe(
      String.raw`D:\test\test.sh:782:39: reached EOF without closing quote '\''`,
    );
  });

  it('打开 Git Diff 预览会复用同一个只读标签且不写入会话标签', () => {
    const store = useEditorStore();

    store.openGitDiffDocument({
      id: 'git-diff:worktree:/tmp/repo:src/app.sh',
      repositoryRootPath: '/tmp/repo',
      path: '/tmp/repo/src/app.sh',
      relativePath: 'src/app.sh',
      title: 'src/app.sh · 工作区 Diff',
      mode: 'worktree',
      originalContent: 'echo 0\n',
      modifiedContent: 'echo 1\n',
      isEmpty: false,
    });
    store.openGitDiffDocument({
      id: 'git-diff:worktree:/tmp/repo:src/app.sh',
      repositoryRootPath: '/tmp/repo',
      path: '/tmp/repo/src/app.sh',
      relativePath: 'src/app.sh',
      title: 'src/app.sh · 工作区 Diff',
      mode: 'worktree',
      originalContent: 'echo 0\n',
      modifiedContent: 'echo 2\n',
      isEmpty: false,
    });

    expect(store.documents).toHaveLength(1);
    expect(store.document.kind).toBe('git-diff');
    expect(store.document.content).toContain('echo 2');
    expect(store.sessionSnapshot.openTabs).toEqual([]);
  });
});
