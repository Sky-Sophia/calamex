import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  Agent,
  FunctionTool,
  Model,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from '@strands-agents/sdk';

import { ACONTEXT_ENVELOPE_START } from '../context/context-envelope.js';
import {
  ACONTEXT_STATE_KEY,
  parseOfficialAcontextState,
} from '../context/default-state.js';
import {
  createOfficialAcontextConversationManager,
  createOfficialAcontextInitialAppState,
  createOfficialAcontextInvocationState,
  registerOfficialAcontextHooks,
} from '../context/official-acontext-hook.js';
import {
  createAcontextSessionResources,
  createManualCheckpoint,
  listAcontextCheckpointIds,
  registerRollbackCheckpointHooks,
} from './checkpoint-service.js';
import { shouldCreateMessageIntervalCheckpoint } from './checkpoint-policy.js';
import {
  deleteAcontextSession,
  restoreAcontextCheckpoint,
  restoreLatestAcontextSession,
} from './rollback-service.js';
import { InMemorySideEffectLedger } from './side-effect-ledger.js';
import type { IRollbackConfig } from './rollback-config.js';

type TMockTurn =
  | {
    kind: 'text';
    text: string;
  }
  | {
    kind: 'toolUse';
    name: string;
    toolUseId: string;
    input: JSONValue;
  };

interface ICapturedModelCall {
  messages: Message[];
  systemPrompt: string;
}

class RollbackTestModel extends Model<BaseModelConfig> {
  readonly calls: ICapturedModelCall[] = [];
  private config: BaseModelConfig = {
    modelId: 'rollback-test-model',
  };
  private turnIndex = 0;

  constructor(private readonly turns: TMockTurn[]) {
    super();
  }

  override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = {
      ...this.config,
      ...modelConfig,
    };
  }

  override getConfig(): BaseModelConfig {
    return this.config;
  }

  override async countTokens(): Promise<number> {
    return 128;
  }

  override async *stream(
    messages: Message[],
    options: StreamOptions = {},
  ): AsyncIterable<ModelStreamEvent> {
    this.calls.push({
      messages: [...messages],
      systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : '',
    });

    const turn = this.turns.length === 1
      ? this.turns[0]
      : this.turns[this.turnIndex];

    if (!turn) {
      throw new Error('测试模型没有可用 turn。');
    }

    if (this.turns.length > 1) {
      this.turnIndex += 1;
    }

    if (turn.kind === 'toolUse') {
      yield* this.streamToolUseTurn(turn);
      return;
    }

    yield* this.streamTextTurn(turn.text);
  }

  private async *streamTextTurn(text: string): AsyncIterable<ModelStreamEvent> {
    yield {
      type: 'modelMessageStartEvent',
      role: 'assistant',
    };
    yield {
      type: 'modelContentBlockStartEvent',
    };
    yield {
      type: 'modelContentBlockDeltaEvent',
      delta: {
        type: 'textDelta',
        text,
      },
    };
    yield {
      type: 'modelContentBlockStopEvent',
    };
    yield {
      type: 'modelMessageStopEvent',
      stopReason: 'endTurn',
    };
  }

  private async *streamToolUseTurn(turn: Extract<TMockTurn, { kind: 'toolUse' }>): AsyncIterable<ModelStreamEvent> {
    yield {
      type: 'modelMessageStartEvent',
      role: 'assistant',
    };
    yield {
      type: 'modelContentBlockStartEvent',
      start: {
        type: 'toolUseStart',
        name: turn.name,
        toolUseId: turn.toolUseId,
      },
    };
    yield {
      type: 'modelContentBlockDeltaEvent',
      delta: {
        type: 'toolUseInputDelta',
        input: JSON.stringify(turn.input),
      },
    };
    yield {
      type: 'modelContentBlockStopEvent',
    };
    yield {
      type: 'modelMessageStopEvent',
      stopReason: 'toolUse',
    };
  }
}

const textFromMessage = (message: Message): string =>
  message.content
    .map((block) => block.type === 'textBlock' ? block.text : '')
    .join('\n');

const countEnvelopePartitions = (systemPrompt: string): number =>
  systemPrompt.match(new RegExp(ACONTEXT_ENVELOPE_START, 'gu'))?.length ?? 0;

const withTempSessionDir = async <T>(run: (sessionDir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'acontext-rollback-'));

  try {
    return await run(dir);
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }
};

const createRollbackTestAgent = (params: {
  sessionId: string;
  agentId: string;
  sessionDir: string;
  model: RollbackTestModel;
  goal: string;
  currentUserMessage: string;
  rollbackConfig?: Partial<IRollbackConfig>;
  tools?: FunctionTool[];
  sideEffectLedger?: InMemorySideEffectLedger;
}) => {
  const rollbackConfig: Partial<IRollbackConfig> = {
    sessionDir: params.sessionDir,
    autoCheckpointEveryMessages: 999,
    ...(params.rollbackConfig ?? {}),
  };
  const { storage, sessionManager } = createAcontextSessionResources({
    sessionId: params.sessionId,
    config: rollbackConfig,
  });
  const baseSystemPrompt = [
    '身份：你是 rollback 测试 Agent。',
    `goal: ${params.goal}`,
  ].join('\n');
  const agent = new Agent({
    id: params.agentId,
    model: params.model,
    systemPrompt: baseSystemPrompt,
    tools: params.tools ?? [],
    appState: createOfficialAcontextInitialAppState(params.goal),
    conversationManager: createOfficialAcontextConversationManager('agent'),
    sessionManager,
    printer: false,
    toolExecutor: 'sequential',
  });

  registerOfficialAcontextHooks(agent, {
    baseSystemPrompt,
    sessionId: params.sessionId,
    mode: 'agent',
    taskGoal: params.goal,
    currentUserMessage: params.currentUserMessage,
    now: () => '2026-05-02T00:00:00.000Z',
  });

  if (params.sideEffectLedger) {
    registerRollbackCheckpointHooks({
      agent,
      sessionId: params.sessionId,
      storage,
      sessionManager,
      config: rollbackConfig,
      sideEffectLedger: params.sideEffectLedger,
      now: () => '2026-05-02T00:00:00.000Z',
    });
  }

  return {
    agent,
    storage,
    sessionManager,
  };
};

describe('Acontext rollback checkpoint policy', () => {
  it('creates checkpoints only on positive message interval boundaries', () => {
    assert.equal(shouldCreateMessageIntervalCheckpoint(0, 8), false);
    assert.equal(shouldCreateMessageIntervalCheckpoint(7, 8), false);
    assert.equal(shouldCreateMessageIntervalCheckpoint(8, 8), true);
    assert.equal(shouldCreateMessageIntervalCheckpoint(16, 8), true);
    assert.equal(shouldCreateMessageIntervalCheckpoint(16, 0), false);
  });
});

describe('Acontext rollback SessionManager integration', () => {
  it('creates automatic immutable checkpoints through snapshotTrigger', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'auto-checkpoint-session';
      const agentId = 'rollback-agent';
      const { agent, storage } = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: new RollbackTestModel([{ kind: 'text', text: '第一轮完成。' }]),
        goal: '验证自动 checkpoint',
        currentUserMessage: '继续。',
        rollbackConfig: {
          autoCheckpointEveryMessages: 2,
        },
      });

      await agent.invoke('继续。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证自动 checkpoint',
          currentUserMessage: '继续。',
        }),
      });

      const ids = await listAcontextCheckpointIds({
        storage,
        sessionId,
        agentId,
      });

      assert.equal(ids.length, 1);
      assert.equal(typeof ids[0], 'string');
    });
  });

  it('creates manual checkpoints and lists only snapshot ids', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'manual-checkpoint-session';
      const agentId = 'rollback-agent';
      const { agent, storage, sessionManager } = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: new RollbackTestModel([{ kind: 'text', text: '第一轮完成。' }]),
        goal: '验证手动 checkpoint',
        currentUserMessage: '必须保留第一轮。',
      });

      await agent.invoke('必须保留第一轮。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证手动 checkpoint',
          currentUserMessage: '必须保留第一轮。',
        }),
      });
      await createManualCheckpoint({
        sessionManager,
        agent,
        reason: 'manual_user_request',
      });

      const ids = await listAcontextCheckpointIds({
        storage,
        sessionId,
        agentId,
      });

      assert.equal(ids.length, 1);
      assert.deepEqual(ids, [ids[0]]);
      assert.equal(typeof ids[0], 'string');
    });
  });

  it('restores latest snapshot explicitly', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'latest-restore-session';
      const agentId = 'rollback-agent';
      const firstResources = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: new RollbackTestModel([{ kind: 'text', text: '已保存 latest。' }]),
        goal: '验证 latest 恢复',
        currentUserMessage: '必须只恢复 latest。',
      });

      await firstResources.agent.invoke('必须只恢复 latest。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 latest 恢复',
          currentUserMessage: '必须只恢复 latest。',
        }),
      });

      const result = await restoreLatestAcontextSession({
        sessionId,
        agentId,
        createAgent: () => createRollbackTestAgent({
          sessionId,
          agentId,
          sessionDir,
          model: new RollbackTestModel([{ kind: 'text', text: '不会调用。' }]),
          goal: '验证 latest 恢复',
          currentUserMessage: '恢复 latest。',
        }),
      });

      assert.equal(result.ok, true);
      assert.equal(result.restoredLatest, true);
    });
  });

  it('restores an immutable checkpoint and promotes it to latest for the next Agent', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'checkpoint-promote-session';
      const agentId = 'rollback-agent';
      const firstModel = new RollbackTestModel([
        { kind: 'text', text: '第一轮完成。' },
        { kind: 'text', text: '第二轮完成。' },
      ]);
      const firstResources = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: firstModel,
        goal: '验证 checkpoint 提升 latest',
        currentUserMessage: '必须保留第一轮。',
      });

      await firstResources.agent.invoke('必须保留第一轮。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 checkpoint 提升 latest',
          currentUserMessage: '必须保留第一轮。',
        }),
      });
      await createManualCheckpoint({
        sessionManager: firstResources.sessionManager,
        agent: firstResources.agent,
        reason: 'manual_user_request',
      });

      const ids = await listAcontextCheckpointIds({
        storage: firstResources.storage,
        sessionId,
        agentId,
      });
      const snapshotId = ids[ids.length - 1];

      assert.ok(snapshotId);

      await firstResources.agent.invoke('决定加入第二轮污染。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 checkpoint 提升 latest',
          currentUserMessage: '决定加入第二轮污染。',
        }),
      });

      const restoreResult = await restoreAcontextCheckpoint({
        sessionId,
        agentId,
        snapshotId,
        createAgent: () => createRollbackTestAgent({
          sessionId,
          agentId,
          sessionDir,
          model: new RollbackTestModel([{ kind: 'text', text: '不会调用。' }]),
          goal: '验证 checkpoint 提升 latest',
          currentUserMessage: '恢复 checkpoint。',
        }),
      });

      assert.equal(restoreResult.ok, true);
      assert.equal(restoreResult.restoredLatest, false);

      const nextModel = new RollbackTestModel([{ kind: 'text', text: '回滚后继续。' }]);
      const nextResources = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: nextModel,
        goal: '验证 checkpoint 提升 latest',
        currentUserMessage: '回滚后继续。',
      });

      await nextResources.agent.invoke('回滚后继续。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 checkpoint 提升 latest',
          currentUserMessage: '回滚后继续。',
        }),
      });

      const firstCall = nextModel.calls[0];
      const restoredState = parseOfficialAcontextState(
        nextResources.agent.appState.get(ACONTEXT_STATE_KEY),
      );

      assert.ok(firstCall);
      assert.ok(
        firstCall.messages.some((message) =>
          message.role === 'user' && textFromMessage(message).includes('必须保留第一轮。')),
      );
      assert.equal(
        firstCall.messages.some((message) =>
          message.role === 'user' && textFromMessage(message).includes('第二轮污染')),
        false,
      );
      assert.equal(countEnvelopePartitions(firstCall.systemPrompt), 1);
      assert.equal(restoredState.context.decisions.length, 0);
    });
  });

  it('returns a clear failure when the snapshot does not exist', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'missing-snapshot-session';
      const agentId = 'rollback-agent';
      const result = await restoreAcontextCheckpoint({
        sessionId,
        agentId,
        snapshotId: '018f0000-0000-7000-8000-000000000000',
        createAgent: () => createRollbackTestAgent({
          sessionId,
          agentId,
          sessionDir,
          model: new RollbackTestModel([{ kind: 'text', text: '不会调用。' }]),
          goal: '验证缺失 snapshot',
          currentUserMessage: '恢复不存在的 snapshot。',
        }),
      });

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /Snapshot not found/u);
    });
  });

  it('keeps delete session disabled unless config allows it', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const { sessionManager } = createRollbackTestAgent({
        sessionId: 'delete-disabled-session',
        agentId: 'rollback-agent',
        sessionDir,
        model: new RollbackTestModel([{ kind: 'text', text: '不会调用。' }]),
        goal: '验证删除保护',
        currentUserMessage: '删除保护。',
      });

      await assert.rejects(
        deleteAcontextSession({
          sessionManager,
          allowDeleteSession: false,
        }),
        /Session deletion is disabled/u,
      );
    });
  });
});

describe('Acontext rollback side-effect ledger', () => {
  it('creates a checkpoint before configured real tool names and only records side effects', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'risky-tool-session';
      const agentId = 'rollback-agent';
      const ledger = new InMemorySideEffectLedger();
      const tool = new FunctionTool({
        name: 'observed_actual_tool',
        description: '真实观测到的测试工具名。',
        callback: () => '工具已执行。',
      });
      const resources = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: new RollbackTestModel([
          {
            kind: 'toolUse',
            name: 'observed_actual_tool',
            toolUseId: 'tool-use-1',
            input: {},
          },
          {
            kind: 'text',
            text: '工具调用完成。',
          },
        ]),
        goal: '验证高风险工具 checkpoint',
        currentUserMessage: '调用高风险工具。',
        tools: [tool],
        rollbackConfig: {
          riskyToolNames: ['observed_actual_tool'],
        },
        sideEffectLedger: ledger,
      });

      await resources.agent.invoke('调用高风险工具。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证高风险工具 checkpoint',
          currentUserMessage: '调用高风险工具。',
        }),
      });

      const ids = await listAcontextCheckpointIds({
        storage: resources.storage,
        sessionId,
        agentId,
      });
      const entries = ledger.listBySession({
        sessionId,
        agentId,
      });

      assert.equal(ids.length, 1);
      assert.equal(entries.some((entry) => entry.status === 'planned'), true);
      assert.equal(entries.some((entry) => entry.status === 'executed'), true);
      assert.equal(entries.every((entry) => entry.status !== 'compensated'), true);
      assert.equal(entries.every((entry) => entry.undoAvailable === false), true);
    });
  });

  it('warns about external side effects instead of marking them rolled back', async () => {
    await withTempSessionDir(async (sessionDir) => {
      const sessionId = 'side-effect-warning-session';
      const agentId = 'rollback-agent';
      const ledger = new InMemorySideEffectLedger();
      const firstResources = createRollbackTestAgent({
        sessionId,
        agentId,
        sessionDir,
        model: new RollbackTestModel([{ kind: 'text', text: '第一轮完成。' }]),
        goal: '验证副作用提示',
        currentUserMessage: '必须创建 checkpoint。',
      });

      await firstResources.agent.invoke('必须创建 checkpoint。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证副作用提示',
          currentUserMessage: '必须创建 checkpoint。',
        }),
      });
      await createManualCheckpoint({
        sessionManager: firstResources.sessionManager,
        agent: firstResources.agent,
        reason: 'manual_user_request',
      });

      const ids = await listAcontextCheckpointIds({
        storage: firstResources.storage,
        sessionId,
        agentId,
      });
      const snapshotId = ids[ids.length - 1];

      assert.ok(snapshotId);

      ledger.record({
        sessionId,
        agentId,
        toolName: 'observed_external_tool',
        checkpointId: snapshotId,
        riskLevel: 'high',
        status: 'executed',
        undoAvailable: false,
        createdAt: '2026-05-02T00:00:01.000Z',
      });

      const result = await restoreAcontextCheckpoint({
        sessionId,
        agentId,
        snapshotId,
        sideEffectLedger: ledger,
        createAgent: () => createRollbackTestAgent({
          sessionId,
          agentId,
          sessionDir,
          model: new RollbackTestModel([{ kind: 'text', text: '不会调用。' }]),
          goal: '验证副作用提示',
          currentUserMessage: '恢复 checkpoint。',
        }),
      });

      assert.equal(result.ok, true);
      assert.match(result.message ?? '', /不会自动撤销外部工具副作用/u);
      assert.equal(result.externalSideEffects?.[0]?.status, 'executed');
      assert.equal(result.externalSideEffects?.[0]?.undoAvailable, false);
    });
  });
});
