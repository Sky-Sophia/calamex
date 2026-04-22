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
});
