import {
  Agent,
  type AgentResult,
  type AgentStreamEvent,
  type MessageData,
} from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/models/openai';

import { createDeepSeekModelConfigFromEnv } from '../models/deepseek-model.js';
import type { TAgentSidecarResponse, TAgentUiEvent, TJsonValue } from '../schemas/events.js';
import { agentPlanSchema, type TAgentPlan } from '../schemas/plan.js';
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

const buildSystemPrompt = (input: IStrandsEngineInput): string => {
  const systemMessages = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
  const workspace = input.workspaceRootPath
    ? `workspaceRoot: ${input.workspaceRootPath}`
    : '';

  return [
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
  prelude: TAgentUiEvent[] = [],
): TAgentSidecarResponse => ({
  sessionId,
  events: [
    ...prelude,
    {
      type: 'error',
      message,
    },
  ],
  result: null,
});

const appendSdkTimelineEvent = (
  event: AgentStreamEvent,
  events: TAgentUiEvent[],
): void => {
  if (event.type === 'beforeToolCallEvent') {
    events.push({
      type: 'tool_start',
      toolName: event.toolUse.name,
      input: event.toolUse.input,
    });
    return;
  }

  if (event.type === 'afterToolCallEvent') {
    events.push({
      type: 'tool_result',
      toolName: event.toolUse.name,
      output: toJsonValue(event.result.toJSON()),
    });
  }
};

const runAgentStream = async (
  agent: Agent,
  prompt: string,
  events: TAgentUiEvent[],
  mode: TAgentMode,
): Promise<AgentResult> => {
  const stream = mode === 'plan'
    ? agent.stream(prompt, { structuredOutputSchema: agentPlanSchema })
    : agent.stream(prompt);

  while (true) {
    const next = await stream.next();
    if (next.done) {
      return next.value;
    }

    appendSdkTimelineEvent(next.value, events);
  }
};

const parsePlanFromStructuredOutput = (result: AgentResult): TAgentPlan | null => {
  const parsed = agentPlanSchema.safeParse(result.structuredOutput);
  return parsed.success ? parsed.data : null;
};

export class StrandsEngine {
  async chat(input: IStrandsEngineInput): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'ask');
  }

  async plan(input: IStrandsEngineInput): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'plan');
  }

  async execute(input: IStrandsEngineInput): Promise<TAgentSidecarResponse> {
    return this.runWithStrands(input, 'agent');
  }

  async resolveApproval(input: IApprovalResolutionInput): Promise<TAgentSidecarResponse> {
    const sessionId = createSessionId('approval');

    return {
      sessionId,
      events: [
        {
          type: 'tool_result',
          toolName: 'approval',
          output: {
            requestId: input.requestId,
            decision: input.decision,
          },
        },
        {
          type: 'done',
          result: '审批结果已记录，等待下一次 Agent 执行继续消费。',
        },
      ],
      result: '审批结果已记录，等待下一次 Agent 执行继续消费。',
    };
  }

  private async runWithStrands(
    input: IStrandsEngineInput,
    fallbackMode: TAgentMode,
  ): Promise<TAgentSidecarResponse> {
    const sessionId = input.sessionId ?? createSessionId('agent');
    const mode = input.mode || fallbackMode;
    const prelude: TAgentUiEvent[] = [
      {
        type: 'message_delta',
        text: mode === 'plan'
          ? '正在交给 Strands 生成计划...'
          : '正在交给 Strands Agent 执行...',
      },
    ];
    const modelConfig = createDeepSeekModelConfigFromEnv();

    if (!modelConfig) {
      return createErrorResponse(
        sessionId,
        'DeepSeek 未配置：请在 Node sidecar 环境设置 DEEPSEEK_API_KEY。',
        prelude,
      );
    }

    const mcpBundle = createMcpClientBundle();

    try {
      const events = [...prelude];

      for (const error of mcpBundle.errors) {
        events.push({
          type: 'message_delta',
          text: `MCP 配置无效，已跳过：${error}`,
        });
      }

      const model = new OpenAIModel({
        api: 'chat',
        modelId: modelConfig.model,
        apiKey: modelConfig.apiKey,
        clientConfig: {
          baseURL: modelConfig.baseUrl,
        },
      });
      const agent = new Agent({
        model,
        messages: buildHistoryMessages({ ...input, mode }),
        systemPrompt: buildSystemPrompt({ ...input, mode }),
        tools: mcpBundle.clients,
        printer: false,
        toolExecutor: 'sequential',
      });

      const agentResult = await runAgentStream(
        agent,
        buildUserPrompt({ ...input, mode }),
        events,
        mode,
      );
      const result = agentResult.toString();

      if (mode === 'plan') {
        const plan = parsePlanFromStructuredOutput(agentResult);

        if (!plan) {
          return createErrorResponse(
            sessionId,
            'Strands structured output 没有返回有效 AgentPlan，计划未生成。',
            events,
          );
        }

        const doneResult = `已生成计划：${plan.steps.length} 个待办事项。`;

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

      return {
        sessionId,
        events: [
          ...events,
          {
            type: 'message_delta',
            text: result,
          },
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
        prelude,
      );
    } finally {
      await mcpBundle.disconnectAll();
    }
  }
}
