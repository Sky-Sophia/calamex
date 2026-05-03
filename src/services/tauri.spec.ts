import { AppError } from '@/types/app-error';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineIpc, tauriService } from './tauri';
import { zTauriVoid } from './tauri.contracts';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: typeof invoke;
    };
  }
}

describe('defineIpc', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
    window.__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__TAURI_INTERNALS__;
  });

  it('成功路径：返回经过 schema 校验的结果', async () => {
    invokeMock.mockResolvedValue({ ok: true, value: 'done' });

    const call = defineIpc({
      name: 'demo_success',
      guardHint: '演示成功',
      inSchema: z.object({ value: z.string() }),
      outSchema: z.object({ ok: z.boolean(), value: z.string() }),
      mapArgs: (payload) => ({ payload }),
    });

    await expect(call({ value: 'input' })).resolves.toEqual({ ok: true, value: 'done' });
    expect(invokeMock).toHaveBeenCalledWith('demo_success', {
      payload: { value: 'input' },
    });
  });

  it('入参校验失败时不调用 invoke', async () => {
    const call = defineIpc({
      name: 'demo_input_validation',
      guardHint: '演示入参校验',
      inSchema: z.object({ count: z.number().int().min(1) }),
      outSchema: z.object({ ok: z.boolean() }),
    });

    await expect(call({ count: 0 })).rejects.toMatchObject({
      code: 'ipc.input-validation',
      scope: 'validation',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('出参校验失败时归一化为契约错误', async () => {
    invokeMock.mockResolvedValue({ ok: 'bad' });

    const call = defineIpc({
      name: 'demo_output_validation',
      guardHint: '演示出参校验',
      inSchema: z.void(),
      outSchema: z.object({ ok: z.boolean() }),
    });

    await expect(call(undefined)).rejects.toMatchObject({
      code: 'ipc.contract-violation',
      scope: 'validation',
    });
  });

  it('超时时归一化为 ipc.timeout', async () => {
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    const call = defineIpc({
      name: 'demo_timeout',
      guardHint: '演示超时',
      inSchema: z.void(),
      outSchema: z.void(),
      timeoutMs: 10,
    });

    await expect(call(undefined)).rejects.toMatchObject({
      code: 'ipc.timeout',
      scope: 'ipc',
    });
  });

  it('取消时归一化为 ipc.canceled', async () => {
    const controller = new AbortController();
    controller.abort();

    const call = defineIpc({
      name: 'demo_cancel',
      guardHint: '演示取消',
      inSchema: z.void(),
      outSchema: z.void(),
    });

    await expect(call(undefined, { signal: controller.signal })).rejects.toMatchObject({
      code: 'ipc.canceled',
      scope: 'ipc',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('Rust 抛错时按 errorMap 归一化', async () => {
    invokeMock.mockRejectedValue(new Error('file not found: sample.sh'));

    const call = defineIpc({
      name: 'demo_error_map',
      guardHint: '演示错误映射',
      inSchema: z.void(),
      outSchema: z.void(),
      errorMap: {
        'not found': {
          code: 'fs.not-found',
          message: '目标文件不存在。',
        },
      },
    });

    await expect(call(undefined)).rejects.toMatchObject({
      code: 'fs.not-found',
      scope: 'ipc',
      message: '目标文件不存在。',
    });
  });

  it('无返回值命令兼容 Tauri 的 null 响应', async () => {
    invokeMock.mockResolvedValue(null);

    const call = defineIpc({
      name: 'demo_void_null',
      guardHint: '演示无返回值响应',
      inSchema: z.object({ sessionId: z.string(), data: z.string() }),
      outSchema: zTauriVoid,
    });

    await expect(call({ sessionId: 'term-1', data: 'ls\n' })).resolves.toBeUndefined();
  });

  it('无返回值命令兼容 undefined 响应', async () => {
    invokeMock.mockResolvedValue(undefined);

    const call = defineIpc({
      name: 'demo_void_undefined',
      guardHint: '演示无返回值响应',
      inSchema: z.object({ sessionId: z.string(), data: z.string() }),
      outSchema: zTauriVoid,
    });

    await expect(call({ sessionId: 'term-1', data: 'pwd\n' })).resolves.toBeUndefined();
  });
});

describe('tauriService', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
    window.__TAURI_INTERNALS__ = {
      invoke: invokeMock,
    };
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.__TAURI_INTERNALS__;
  });

  it('loadScript 通过 defineIpc 驱动扁平参数命令', async () => {
    invokeMock.mockResolvedValue({
      path: 'D:/demo.sh',
      name: 'demo.sh',
      content: 'echo test',
      encoding: 'utf-8',
      lineCount: 1,
      charCount: 9,
    });

    await expect(tauriService.loadScript('D:/demo.sh')).resolves.toMatchObject({
      path: 'D:/demo.sh',
      name: 'demo.sh',
    });
    expect(invokeMock).toHaveBeenCalledWith('load_script', { path: 'D:/demo.sh' });
  });

  it('归一化后的错误保持为 AppError', async () => {
    invokeMock.mockRejectedValue(new Error('boom'));

    let caughtError: unknown;
    try {
      await tauriService.detectEnvironment();
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AppError);
  });

  it('agentSidecarResolveApproval 复用 sidecar 长任务超时预算', async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(() => new Promise(() => undefined));

    try {
      const promise = tauriService.agentSidecarResolveApproval({
        requestId: 'approval-request-1',
        decision: 'allow-once',
      });

      let settled = false;
      void promise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(30_001);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(149_998);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).rejects.toMatchObject({
        code: 'ipc.timeout',
        scope: 'ipc',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('aiPlanTask accepts Rust plan payload with null optional fields', async () => {
    invokeMock.mockResolvedValue({
      steps: [
        {
          id: 'plan-step-1',
          index: 0,
          title: '收集现有上下文与影响面',
          goal: '读取当前文件、诊断与项目搜索结果',
          kind: 'inspect',
          status: 'pending',
          expectedOutput: '产出受影响文件、相关符号与边界说明',
          tools: ['search_text', 'read_current_file', 'get_diagnostics'],
          toolInputs: null,
          references: null,
          isActive: null,
          requiresUserApproval: false,
          riskLevel: 'low',
          rollbackStrategy: '只读步骤无需回滚',
        },
        {
          id: 'plan-step-2',
          index: 1,
          title: '输出结果摘要',
          goal: '基于已收集上下文回答用户',
          kind: 'summarize',
          status: 'pending',
          expectedOutput: '输出简要结论与必要后续建议',
          tools: ['get_diagnostics'],
          toolInputs: {
            webSearch: null,
            webFetch: null,
            proposePatch: null,
            autoApplyPatch: null,
            runCommand: null,
            stageFile: null,
            createCommit: null,
          },
          references: null,
          isActive: null,
          requiresUserApproval: false,
          riskLevel: 'low',
          rollbackStrategy: null,
        },
      ],
    });

    await expect(tauriService.aiPlanTask({
      goal: '你修改一下',
      context: [],
    })).resolves.toMatchObject({
      steps: [
        {
          id: 'plan-step-1',
          title: '收集现有上下文与影响面',
        },
        {
          id: 'plan-step-2',
          title: '输出结果摘要',
        },
      ],
    });
  });
});
