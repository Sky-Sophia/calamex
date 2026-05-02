import {
  Agent,
  type AgentResult,
  type MessageData,
} from '@strands-agents/sdk';

import {
  createOfficialAcontextConversationManager,
  createOfficialAcontextInitialAppState,
  createOfficialAcontextInvocationState,
  registerOfficialAcontextHooks,
} from '../context/official-acontext-hook.js';
import { createDeepSeekModelConfigFromEnv } from '../models/deepseek-model.js';
import { OpenAiChatCompatModel } from '../models/openai-chat-compat-model.js';
import {
  createAcontextSessionResources,
  registerRollbackCheckpointHooks,
} from '../rollback/checkpoint-service.js';
import { InMemorySideEffectLedger } from '../rollback/side-effect-ledger.js';
import type { TAgentSidecarResponse, TAgentUiEvent, TJsonValue } from '../schemas/events.js';
import { agentPlanSchema, type TAgentPlan } from '../schemas/plan.js';
import { AgentStreamEventBus } from '../streaming/stream-event-bus.js';
import { runAgentStream } from '../streaming/stream-runner.js';
import { createMcpClientBundle } from '../tools/mcp.js';

export type TAgentMode = 'ask' | 'plan' | 'agent' | 'patch' | 'review';

export interface IAgentMessageInput {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface IAgentContextReferenceInput {
  id: string;
  kind: string;
  label: string;
  path: string | null;
  range: {
    startLine: number;
    endLine: number;
  } | null;
  contentPreview: string;
  redacted: boolean;
}

export interface IStrandsEngineInput {
  sessionId?: string;
  mode: TAgentMode;
  goal: string;
  messages: IAgentMessageInput[];
  workspaceRootPath?: string;
  context?: IAgentContextReferenceInput[];
}

export interface IApprovalResolutionInput {
  requestId: string;
  decision: string;
  sessionId?: string | undefined;
}

export interface IStrandsEngineRunOptions {
  onEvent?: (event: TAgentUiEvent) => void;
}

const createSessionId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const toJsonValue = (value: unknown): TJsonValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  const record = toRecord(value);
  if (!record) {
    return String(value);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, toJsonValue(item)]),
  );
};

const isStrandsMessageRole = (
  role: IAgentMessageInput['role'],
): role is MessageData['role'] => role === 'user' || role === 'assistant';

const toStrandsMessageData = (message: IAgentMessageInput): MessageData | null => {
  if (!isStrandsMessageRole(message.role)) {
    return null;
  }

  return {
    role: message.role,
    content: [
      {
        text: message.content,
      },
    ],
  };
};

const findLastUserMessageIndex = (messages: IAgentMessageInput[]): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }

  return -1;
};

const findLastUserMessageContent = (input: IStrandsEngineInput): string => {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const lastUserContent = lastUserMessageIndex >= 0
    ? input.messages[lastUserMessageIndex]?.content.trim()
    : '';

  return lastUserContent || input.goal;
};

const inferModelProviderLabel = (modelId: string): string => {
  const normalized = modelId.trim().toLowerCase();

  if (normalized.includes('deepseek')) {
    return 'DeepSeek';
  }

  if (normalized.startsWith('anthropic/') || normalized.includes('claude')) {
    return 'Anthropic';
  }

  if (normalized.startsWith('openai/') || normalized.startsWith('gpt-')) {
    return 'OpenAI';
  }

  if (normalized.startsWith('google/') || normalized.includes('gemini')) {
    return 'Google';
  }

  if (normalized.startsWith('qwen/') || normalized.includes('qwen')) {
    return '通义千问';
  }

  return '当前配置的 AI 服务平台';
};

const buildIdentityInstruction = (modelId: string): string => {
  const currentModel = modelId.trim() || '未指定';
  const provider = inferModelProviderLabel(currentModel);

  return `身份：你是Calamex桌面应用中的 AI 编程助手。当前模型：${currentModel}，平台：${provider}`;
};

const buildModeInstruction = (mode: TAgentMode): string => (mode === 'plan'
  ? [
    'Plan 模式要求：使用 Strands structured output 返回 AgentPlan，不要输出 Markdown 或额外解释。',
    'steps 必须依据用户的真实任务制定，2 到 6 步，避免“分析/实现/测试”这类模板标题。',
    '每个 step 必须包含 id、title、goal、status、tools、riskLevel、requiresApproval、expectedOutput。',
    '如果使用 MCP 工具读取上下文，请先读取真实信息再生成计划。',
    '读和搜索是 low risk；写文件、删除、命令、安装依赖和 Git 操作至少是 medium risk 且 requiresApproval=true。',
  ].join('\n')
  : [
    'Agent 模式要求：按需调用工具或直接回答，不要先生成计划。',
    '如果当前没有可用工具执行，请明确说明缺失的运行条件，不要伪造成成功。',
  ].join('\n'));

const buildContextInstruction = (context: IAgentContextReferenceInput[] = []): string => {
  if (!context.length) {
    return '';
  }

  return [
    'UI 已提供上下文，必要时请结合这些内容判断任务：',
    ...context.map((reference, index) => [
      `#${index + 1} ${reference.label}`,
      `类型：${reference.kind}`,
      `路径：${reference.path ?? '无'}`,
      reference.range
        ? `范围：${reference.range.startLine}-${reference.range.endLine}`
        : '范围：无',
      `已脱敏：${reference.redacted ? '是' : '否'}`,
      '内容：',
      reference.contentPreview,
    ].join('\n')),
  ].join('\n\n');
};

export const buildSystemPrompt = (
  input: IStrandsEngineInput,
  modelId = '未指定',
): string => {
  const systemMessages = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
  const workspace = input.workspaceRootPath
    ? `workspaceRoot: ${input.workspaceRootPath}`
    : '';

  return [
    buildIdentityInstruction(modelId),
    buildModeInstruction(input.mode),
    workspace,
    buildContextInstruction(input.context),
    `goal: ${input.goal}`,
    systemMessages.length > 0 ? `system messages:\n${systemMessages.join('\n')}` : '',
  ]
    .filter((line) => line.trim().length > 0)
    .join('\n');
};

const buildHistoryMessages = (input: IStrandsEngineInput): MessageData[] => {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const sourceMessages = lastUserMessageIndex >= 0
    ? input.messages.slice(0, lastUserMessageIndex)
    : input.messages;
  const messages: MessageData[] = [];

  for (const message of sourceMessages) {
    const strandsMessage = toStrandsMessageData(message);
    if (strandsMessage) {
      messages.push(strandsMessage);
    }
  }

  return messages;
};

const buildUserPrompt = (input: IStrandsEngineInput): string => {
  const lastUserMessageIndex = findLastUserMessageIndex(input.messages);
  const lastUserContent = lastUserMessageIndex >= 0
    ? input.messages[lastUserMessageIndex]?.content.trim()
    : '';
  const request = lastUserContent || input.goal;
  const toolContext = input.messages
    .filter((message) => message.role === 'tool')
    .map((message, index) => `tool ${index + 1}: ${message.content}`)
    .join('\n');
  const goal = request === input.goal ? '' : `目标：${input.goal}`;

  return [
    goal,
    request,
    toolContext ? `工具上下文：\n${toolContext}` : '',
  ]
    .filter((line) => line.trim().length > 0)
    .join('\n');
};

const createErrorResponse = (
  sessionId: string,
  message: string,
  events: TAgentUiEvent[] = [],
  options: IStrandsEngineRunOptions = {},
): TAgentSidecarResponse => {
  const errorEvent: TAgentUiEvent = {
    type: 'error',
    message,
  };

  options.onEvent?.(errorEvent);

  return {
    sessionId,
    events: [
      ...events,
      errorEvent,
    ],
    result: null,
  };
};

const pushUiEvent = (
  events: TAgentUiEvent[],
  event: TAgentUiEvent,
  options: IStrandsEngineRunOptions = {},
): void => {
  events.push(event);
  options.onEvent?.(event);
};

const parsePlanFromStructuredOutput = (result: AgentResult): TAgentPlan | null => {
  const parsed = agentPlanSchema.safeParse(result.structuredOutput);
  return parsed.success ? parsed.data : null;
};

export const extractVisibleAgentResultText = (result: AgentResult): string => {
  const textParts: string[] = [];

  for (const block of result.lastMessage.content) {
    if (block.type === 'textBlock') {
      if (block.text.trim().length > 0) {
        textParts.push(block.text);
      }
    }
  }

  return textParts.join('').trim();
};

export class StrandsEngine {
  async chat(
    input: IStrandsEngineInput,
    options: IStrandsEngineRunOptions = {},
  ): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'ask', options);
  }

  async plan(
    input: IStrandsEngineInput,
    options: IStrandsEngineRunOptions = {},
  ): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'plan', options);
  }

  async execute(
    input: IStrandsEngineInput,
    options: IStrandsEngineRunOptions = {},
  ): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'agent', options);
  }

  async resolveApproval(
    input: IApprovalResolutionInput,
    options: IStrandsEngineRunOptions = {},
  ): Promise<TAgentSidecarResponse> {
    const sessionId = input.sessionId ?? createSessionId('approval');
    const result = '审批结果已记录，等待下一次 Agent 执行继续消费。';
    const events: TAgentUiEvent[] = [];

    pushUiEvent(events, {
      type: 'tool_result',
      toolName: 'approval',
      output: {
        requestId: input.requestId,
        decision: input.decision,
      },
    }, options);
    pushUiEvent(events, {
      type: 'done',
      result,
    }, options);

    return {
      sessionId,
      events,
      result,
    };
  }

  private async runWithStrands(
    input: IStrandsEngineInput,
    fallbackMode: TAgentMode,
    options: IStrandsEngineRunOptions = {},
  ): Promise<TAgentSidecarResponse> {
    const sessionId = input.sessionId ?? createSessionId('agent');
    const mode = input.mode || fallbackMode;
    const events: TAgentUiEvent[] = [];
    const modelConfig = createDeepSeekModelConfigFromEnv();
    const normalizedInput: IStrandsEngineInput = {
      ...input,
      mode,
    };

    if (!modelConfig) {
      return createErrorResponse(
        sessionId,
        'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
        events,
        options,
      );
    }

    const mcpBundle = await createMcpClientBundle(input.workspaceRootPath
      ? { workspaceRootPath: input.workspaceRootPath }
      : {});

    try {
      const model = new OpenAiChatCompatModel({
        modelId: modelConfig.model,
        apiKey: modelConfig.apiKey,
        baseUrl: modelConfig.baseUrl,
      });
      const baseSystemPrompt = buildSystemPrompt(normalizedInput, modelConfig.model);
      const sessionResources = createAcontextSessionResources({ sessionId });
      const agent = new Agent({
        model,
        messages: buildHistoryMessages(normalizedInput),
        systemPrompt: baseSystemPrompt,
        tools: mcpBundle.tools,
        appState: createOfficialAcontextInitialAppState(normalizedInput.goal),
        conversationManager: createOfficialAcontextConversationManager(mode),
        sessionManager: sessionResources.sessionManager,
        printer: false,
        toolExecutor: 'sequential',
      });
      const streamBus = new AgentStreamEventBus({
        runId: createSessionId('run'),
        sessionId,
        agentId: agent.id,
      });
      const cleanupStreamBus = streamBus.onEvent((event) => {
        pushUiEvent(events, {
          type: 'agent_event',
          event,
        }, options);
      });
      const cleanupAcontextHooks = registerOfficialAcontextHooks(agent, {
        baseSystemPrompt,
        sessionId,
        mode,
        taskGoal: normalizedInput.goal,
        currentUserMessage: findLastUserMessageContent(normalizedInput),
        streamBus,
      });
      const cleanupRollbackHooks = registerRollbackCheckpointHooks({
        agent,
        sessionId,
        storage: sessionResources.storage,
        sessionManager: sessionResources.sessionManager,
        sideEffectLedger: new InMemorySideEffectLedger(),
        streamBus,
      });
      const invocationState = createOfficialAcontextInvocationState({
        sessionId,
        mode,
        taskGoal: normalizedInput.goal,
        currentUserMessage: findLastUserMessageContent(normalizedInput),
      });
      const streamOptions = mode === 'plan'
        ? { structuredOutputSchema: agentPlanSchema, invocationState }
        : { invocationState };

      const { agentResult, visibleText } = await (async () => {
        try {
          return await runAgentStream({
            agent,
            prompt: buildUserPrompt(normalizedInput),
            streamOptions,
            eventBus: streamBus,
            emitLegacyEvent: (event) => {
              if (event.type === 'message_delta') {
                options.onEvent?.(event);
                return;
              }

              pushUiEvent(events, event, options);
            },
            toJsonValue,
          });
        } finally {
          cleanupRollbackHooks();
          cleanupAcontextHooks();
          cleanupStreamBus();
        }
      })();
      const result = visibleText.trim().length > 0
        ? visibleText
        : extractVisibleAgentResultText(agentResult) || 'Agent 已完成。';

      if (mode === 'plan') {
        const plan = parsePlanFromStructuredOutput(agentResult);

        if (!plan) {
          return createErrorResponse(
            sessionId,
            'Strands structured output 没有返回有效 AgentPlan，计划未生成。',
            events,
            options,
          );
        }

        const doneResult = `已生成计划：${plan.steps.length} 个待办事项。`;

        options.onEvent?.({
          type: 'plan_ready',
          plan,
        });
        options.onEvent?.({
          type: 'done',
          result: doneResult,
        });

        return {
          sessionId,
          events: [
            ...events,
            {
              type: 'plan_ready',
              plan,
            },
            {
              type: 'done',
              result: doneResult,
            },
          ],
          result: doneResult,
        };
      }

      options.onEvent?.({
        type: 'done',
        result,
      });

      return {
        sessionId,
        events: [
          ...events,
          {
            type: 'done',
            result,
          },
        ],
        result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(
        sessionId,
        `Strands Agent 执行失败：${message}`,
        events,
        options,
      );
    } finally {
      await mcpBundle.disconnectAll();
    }
  }
}
