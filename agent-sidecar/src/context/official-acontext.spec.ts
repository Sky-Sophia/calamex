import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  Agent,
  FunctionTool,
  Model,
  TextBlock,
  ToolResultBlock,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from '@strands-agents/sdk';

import { createSafeStrandsSessionId } from '../config/settings.js';
import {
  ACONTEXT_ENVELOPE_END,
  ACONTEXT_ENVELOPE_START,
  buildOfficialAcontextEnvelope,
  injectOrReplaceContextEnvelope,
} from './context-envelope.js';
import {
  ACONTEXT_STATE_KEY,
  applyExplicitStateFromUserMessage,
  createDefaultOfficialAcontextState,
  officialAcontextStateToJson,
  parseOfficialAcontextState,
} from './default-state.js';
import {
  createOfficialAcontextConversationManager,
  createOfficialAcontextInitialAppState,
  createOfficialAcontextInvocationState,
  createOfficialAcontextSessionManager,
  registerOfficialAcontextHooks,
  summarizeToolResultBlock,
} from './official-acontext-hook.js';

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

class CapturingModel extends Model<BaseModelConfig> {
  readonly calls: ICapturedModelCall[] = [];
  private config: BaseModelConfig = {
    modelId: 'capturing-model',
  };
  private turnIndex = 0;

  constructor(
    private readonly turns: TMockTurn[],
    private readonly tokenCount: number | Error = 128,
  ) {
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
    if (this.tokenCount instanceof Error) {
      throw this.tokenCount;
    }

    return this.tokenCount;
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

const withTempSessionDir = async <T>(run: () => Promise<T>): Promise<T> => {
  const previousDir = process.env.AGENT_SIDECAR_SESSION_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'acontext-session-'));

  process.env.AGENT_SIDECAR_SESSION_DIR = dir;

  try {
    return await run();
  } finally {
    if (previousDir === undefined) {
      delete process.env.AGENT_SIDECAR_SESSION_DIR;
    } else {
      process.env.AGENT_SIDECAR_SESSION_DIR = previousDir;
    }

    await rm(dir, {
      recursive: true,
      force: true,
    });
  }
};

const createAcontextTestAgent = (params: {
  model: CapturingModel;
  sessionId: string;
  goal: string;
  currentUserMessage: string;
  mode?: 'ask' | 'agent';
  tools?: FunctionTool[];
}): Agent => {
  const mode = params.mode ?? 'agent';
  const baseSystemPrompt = [
    '身份：你是测试 Agent。',
    `goal: ${params.goal}`,
  ].join('\n');
  const agent = new Agent({
    model: params.model,
    systemPrompt: baseSystemPrompt,
    tools: params.tools ?? [],
    appState: createOfficialAcontextInitialAppState(params.goal),
    conversationManager: createOfficialAcontextConversationManager(mode),
    sessionManager: createOfficialAcontextSessionManager(params.sessionId),
    printer: false,
    toolExecutor: 'sequential',
  });

  registerOfficialAcontextHooks(agent, {
    baseSystemPrompt,
    sessionId: params.sessionId,
    mode,
    taskGoal: params.goal,
    currentUserMessage: params.currentUserMessage,
    now: () => '2026-05-02T00:00:00.000Z',
  });

  return agent;
};

describe('Official Acontext state extraction', () => {
  it('only records explicit user statements into session state', () => {
    const state = createDefaultOfficialAcontextState('2026-05-02T00:00:00.000Z', '实现 Acontext');
    const nextState = applyExplicitStateFromUserMessage(
      state,
      [
        '必须只用 Strands 官方能力。',
        '决定采用 Context Envelope 显式注入。',
        '用户可能喜欢很长的方案。',
      ].join('\n'),
      '2026-05-02T00:00:01.000Z',
    );

    assert.equal(nextState.context.constraints.length, 1);
    assert.equal(nextState.context.decisions.length, 1);
    assert.equal(nextState.context.importantFacts.length, 0);
    assert.match(nextState.context.constraints[0]?.content ?? '', /Strands 官方能力/u);
    assert.doesNotMatch(
      JSON.stringify(officialAcontextStateToJson(nextState)),
      /喜欢很长的方案/u,
    );
  });

  it('deduplicates repeated explicit constraints by normalized content', () => {
    const state = createDefaultOfficialAcontextState('2026-05-02T00:00:00.000Z', '实现 Acontext');
    const firstState = applyExplicitStateFromUserMessage(
      state,
      '必须只用官方能力。',
      '2026-05-02T00:00:01.000Z',
    );
    const secondState = applyExplicitStateFromUserMessage(
      firstState,
      '必须只用官方能力。',
      '2026-05-02T00:00:02.000Z',
    );

    assert.equal(secondState.context.constraints.length, 1);
    assert.equal(
      secondState.context.constraints[0]?.updatedAt,
      '2026-05-02T00:00:02.000Z',
    );
  });
});

describe('Official Acontext envelope', () => {
  it('injects bounded session context with source markers', () => {
    const state = createDefaultOfficialAcontextState('2026-05-02T00:00:00.000Z', '实现 Acontext');
    const nextState = applyExplicitStateFromUserMessage(
      state,
      '必须只用 Strands 官方能力。\n决定采用 AgentState + Context Envelope。',
      '2026-05-02T00:00:01.000Z',
    );
    const envelope = buildOfficialAcontextEnvelope(
      {
        [ACONTEXT_STATE_KEY]: officialAcontextStateToJson(nextState),
      }[ACONTEXT_STATE_KEY],
      {
        maxEnvelopeChars: 1200,
        maxSessionSummaryChars: 100,
        maxRecentFocusChars: 100,
        maxToolSummaryChars: 100,
        maxConstraints: 1,
        maxDecisions: 1,
        maxImportantFacts: 1,
        maxOpenQuestions: 1,
        maxToolSummaries: 1,
      },
    );

    assert.doesNotMatch(envelope, /<ACONTEXT_ENVELOPE>/u);
    assert.match(envelope, /source=user, confidence=explicit/u);
    assert.match(envelope, /AgentState \+ Context Envelope/u);
    assert.match(envelope, /AgentState 只是存储/u);
  });

  it('injects and replaces the unique Acontext envelope idempotently', () => {
    const firstPrompt = injectOrReplaceContextEnvelope(
      '原始 system prompt\n<SESSION_CONTEXT>普通文档片段</SESSION_CONTEXT>',
      'first body',
    );
    const secondPrompt = injectOrReplaceContextEnvelope(firstPrompt, 'second body');
    const duplicatedPrompt = [
      secondPrompt,
      ACONTEXT_ENVELOPE_START,
      'stale body',
      ACONTEXT_ENVELOPE_END,
    ].join('\n');
    const cleanedPrompt = injectOrReplaceContextEnvelope(duplicatedPrompt, 'final body');

    assert.match(cleanedPrompt, /原始 system prompt/u);
    assert.match(cleanedPrompt, /<SESSION_CONTEXT>普通文档片段<\/SESSION_CONTEXT>/u);
    assert.match(cleanedPrompt, /final body/u);
    assert.doesNotMatch(cleanedPrompt, /first body|second body|stale body/u);
    assert.equal(
      cleanedPrompt.match(new RegExp(ACONTEXT_ENVELOPE_START, 'gu'))?.length ?? 0,
      1,
    );
    assert.equal(
      cleanedPrompt.match(new RegExp(ACONTEXT_ENVELOPE_END, 'gu'))?.length ?? 0,
      1,
    );
  });
});

describe('Official Acontext Strands runtime integration', () => {
  it('injects Context Envelope before the current invocation reaches the model', async () => {
    await withTempSessionDir(async () => {
      const model = new CapturingModel([
        {
          kind: 'text',
          text: '已处理。',
        },
      ], 256);
      const agent = createAcontextTestAgent({
        model,
        sessionId: 'runtime-envelope-session',
        goal: '验证上下文注入',
        currentUserMessage: '必须只用 Strands 官方能力。',
      });

      await agent.invoke('必须只用 Strands 官方能力。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId: 'runtime-envelope-session',
          mode: 'agent',
          taskGoal: '验证上下文注入',
          currentUserMessage: '必须只用 Strands 官方能力。',
        }),
      });

      const firstCall = model.calls[0];
      const state = parseOfficialAcontextState(agent.appState.get(ACONTEXT_STATE_KEY));

      assert.ok(firstCall);
      assert.match(firstCall.systemPrompt, /<ACONTEXT_ENVELOPE>/u);
      assert.match(firstCall.systemPrompt, /必须只用 Strands 官方能力/u);
      assert.match(firstCall.systemPrompt, /AgentState 只是存储/u);
      assert.equal(state.compression.lastProjectedInputTokens, 256);
      assert.equal(state.compression.tokenEstimateAvailable, true);
    });
  });

  it('restores messages and appState across Agent instances with the same session', async () => {
    await withTempSessionDir(async () => {
      const sessionId = 'runtime-restore-session';
      const firstModel = new CapturingModel([
        {
          kind: 'text',
          text: '第一轮完成。',
        },
      ]);
      const firstAgent = createAcontextTestAgent({
        model: firstModel,
        sessionId,
        goal: '验证 session 恢复',
        currentUserMessage: '必须只记录用户明确声明。',
      });

      await firstAgent.invoke('必须只记录用户明确声明。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 session 恢复',
          currentUserMessage: '必须只记录用户明确声明。',
        }),
      });

      const secondModel = new CapturingModel([
        {
          kind: 'text',
          text: '第二轮完成。',
        },
      ]);
      const secondAgent = createAcontextTestAgent({
        model: secondModel,
        sessionId,
        goal: '验证 session 恢复',
        currentUserMessage: '继续。',
      });

      await secondAgent.invoke('继续。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证 session 恢复',
          currentUserMessage: '继续。',
        }),
      });

      const secondCall = secondModel.calls[0];

      assert.ok(secondCall);
      assert.ok(secondCall.messages.length >= 3);
      assert.ok(
        secondCall.messages.some((message) =>
          message.role === 'user' && textFromMessage(message).includes('必须只记录用户明确声明。')),
      );
      assert.match(secondCall.systemPrompt, /必须只记录用户明确声明/u);
    });
  });

  it('records tool summaries without pretending to govern raw message history', async () => {
    await withTempSessionDir(async () => {
      const sessionId = 'runtime-tool-summary-session';
      const longToolResult = `工具原始结果：${'长内容'.repeat(900)}`;
      const tool = new FunctionTool({
        name: 'long_result_tool',
        description: '返回长工具结果。',
        callback: () => longToolResult,
      });
      const model = new CapturingModel([
        {
          kind: 'toolUse',
          name: 'long_result_tool',
          toolUseId: 'tool-use-1',
          input: {},
        },
        {
          kind: 'text',
          text: '工具已处理。',
        },
      ]);
      const agent = createAcontextTestAgent({
        model,
        sessionId,
        goal: '验证工具摘要',
        currentUserMessage: '调用工具。',
        tools: [tool],
      });

      await agent.invoke('调用工具。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId,
          mode: 'agent',
          taskGoal: '验证工具摘要',
          currentUserMessage: '调用工具。',
        }),
      });

      const state = parseOfficialAcontextState(agent.appState.get(ACONTEXT_STATE_KEY));
      const rawToolResultText = agent.messages
        .flatMap((message) => message.content)
        .filter((block) => block.type === 'toolResultBlock')
        .flatMap((block) => block.content)
        .map((content) => content.type === 'textBlock' ? content.text : '')
        .join('\n');

      assert.equal(state.toolContext.toolSummaries.length, 1);
      assert.equal(state.toolContext.toolSummaries[0]?.tool, 'long_result_tool');
      assert.equal(state.toolContext.largeResultCount, 1);
      assert.ok((state.toolContext.toolSummaries[0]?.summary.length ?? 0) < longToolResult.length);
      assert.equal(rawToolResultText, longToolResult);
    });
  });

  it('keeps token monitoring non-fatal when projected token estimation fails', async () => {
    await withTempSessionDir(async () => {
      const model = new CapturingModel([
        {
          kind: 'text',
          text: '已处理。',
        },
      ], new Error('token count unavailable'));
      const agent = createAcontextTestAgent({
        model,
        sessionId: 'runtime-token-none-session',
        goal: '验证 token 估算失败',
        currentUserMessage: '继续。',
      });

      await agent.invoke('继续。', {
        invocationState: createOfficialAcontextInvocationState({
          sessionId: 'runtime-token-none-session',
          mode: 'agent',
          taskGoal: '验证 token 估算失败',
          currentUserMessage: '继续。',
        }),
      });

      const state = parseOfficialAcontextState(agent.appState.get(ACONTEXT_STATE_KEY));

      assert.equal(state.compression.lastProjectedInputTokens, null);
      assert.equal(state.compression.tokenEstimateAvailable, false);
      assert.equal(model.calls.length, 1);
    });
  });
});

describe('Official Acontext runtime helpers', () => {
  it('creates stable Strands-safe session identifiers from multilingual input', () => {
    const sessionId = createSafeStrandsSessionId('用户 Session/ABC');

    assert.match(sessionId, /^[a-z0-9_-]+$/u);
    assert.equal(sessionId, createSafeStrandsSessionId('用户 Session/ABC'));
  });

  it('summarizes tool results without mutating the original result block', () => {
    const result = new ToolResultBlock({
      toolUseId: 'tool-1',
      status: 'success',
      content: [new TextBlock('x'.repeat(32))],
    });
    const summary = summarizeToolResultBlock(result, 10);

    assert.equal(summary, 'xxxxxxxxxx...');
    assert.equal(result.content[0]?.type, 'textBlock');
    assert.equal(result.content[0]?.type === 'textBlock' ? result.content[0].text.length : 0, 32);
  });
});
