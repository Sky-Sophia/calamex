import { describe, expect, it } from 'vitest';
import { TERMINAL_RUN_LOG_CODES, TERMINAL_RUN_LOG_TITLES } from '@/utils/terminal-run';
import { buildStructuredRunReport } from './structured-run-report';

describe('structured-run-report', () => {
  it('按 lastRunResult.runId 只聚合当前运行的日志', () => {
    const report = buildStructuredRunReport({
      terminalOutput: '',
      runLogs: [
        {
          id: 'run-1-start',
          level: 'info',
          title: TERMINAL_RUN_LOG_TITLES.start,
          detail: 'run 1',
          createdAt: '2026-04-22T10:00:00.000Z',
          scope: 'run',
          runId: 'run-1',
          code: TERMINAL_RUN_LOG_CODES.start,
        },
        {
          id: 'run-1-failed',
          level: 'error',
          title: TERMINAL_RUN_LOG_TITLES.failed,
          detail: 'exit 1',
          createdAt: '2026-04-22T10:00:02.000Z',
          scope: 'run',
          runId: 'run-1',
          code: TERMINAL_RUN_LOG_CODES.failed,
        },
        {
          id: 'run-2-start',
          level: 'info',
          title: TERMINAL_RUN_LOG_TITLES.start,
          detail: 'run 2',
          createdAt: '2026-04-22T10:01:00.000Z',
          scope: 'run',
          runId: 'run-2',
          code: TERMINAL_RUN_LOG_CODES.start,
        },
        {
          id: 'run-2-dispatched',
          level: 'success',
          title: TERMINAL_RUN_LOG_TITLES.dispatched,
          detail: 'bash /tmp/run-2.sh',
          createdAt: '2026-04-22T10:01:01.000Z',
          scope: 'run',
          runId: 'run-2',
          code: TERMINAL_RUN_LOG_CODES.dispatched,
        },
        {
          id: 'run-2-completed',
          level: 'success',
          title: TERMINAL_RUN_LOG_TITLES.completed,
          detail: '执行器：WSL2，退出码：0，耗时：1200ms。',
          createdAt: '2026-04-22T10:01:02.200Z',
          scope: 'run',
          runId: 'run-2',
          code: TERMINAL_RUN_LOG_CODES.completed,
        },
      ],
      lastRunResult: {
        runId: 'run-2',
        success: true,
        stdout: 'done',
        stderr: '',
        combinedOutput: 'done',
        exitCode: 0,
        executor: 'wsl',
        executorLabel: 'WSL2',
        durationMs: 1200,
        startedAt: '2026-04-22T10:01:00.000Z',
        finishedAt: '2026-04-22T10:01:02.200Z',
        commandLine: 'bash /tmp/run-2.sh',
        logPath: null,
        usedTempFile: false,
      },
      isRunning: false,
      executor: 'wsl',
      documentName: 'deploy.sh',
      documentPath: '/workspace/deploy.sh',
      workspaceRootPath: '/workspace',
    });

    expect(report.timeline.map((item) => item.title)).toEqual([
      TERMINAL_RUN_LOG_TITLES.start,
      TERMINAL_RUN_LOG_TITLES.dispatched,
      TERMINAL_RUN_LOG_TITLES.completed,
    ]);
    expect(report.summary.tone).toBe('success');
  });

  it('没有 lastRunResult 时回退到最新 runId 的日志组', () => {
    const report = buildStructuredRunReport({
      terminalOutput: '',
      runLogs: [
        {
          id: 'run-1-start',
          level: 'info',
          title: TERMINAL_RUN_LOG_TITLES.start,
          detail: 'run 1',
          createdAt: '2026-04-22T10:00:00.000Z',
          scope: 'run',
          runId: 'run-1',
          code: TERMINAL_RUN_LOG_CODES.start,
        },
        {
          id: 'run-2-start',
          level: 'info',
          title: TERMINAL_RUN_LOG_TITLES.start,
          detail: 'run 2',
          createdAt: '2026-04-22T10:01:00.000Z',
          scope: 'run',
          runId: 'run-2',
          code: TERMINAL_RUN_LOG_CODES.start,
        },
        {
          id: 'run-2-dispatched',
          level: 'success',
          title: TERMINAL_RUN_LOG_TITLES.dispatched,
          detail: 'bash /tmp/run-2.sh',
          createdAt: '2026-04-22T10:01:01.000Z',
          scope: 'run',
          runId: 'run-2',
          code: TERMINAL_RUN_LOG_CODES.dispatched,
        },
      ],
      lastRunResult: null,
      isRunning: true,
      executor: 'wsl',
      documentName: 'deploy.sh',
      documentPath: '/workspace/deploy.sh',
      workspaceRootPath: '/workspace',
    });

    expect(report.timeline.some((item) => item.description === 'run 1')).toBe(false);
    expect(report.timeline.some((item) => item.description === 'run 2')).toBe(true);
    expect(report.summary.tone).toBe('running');
  });
});
