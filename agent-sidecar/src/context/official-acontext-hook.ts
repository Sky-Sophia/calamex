import {
  AfterInvocationEvent,
  AfterToolCallEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  MessageAddedEvent,
  ModelMessageEvent,
  SlidingWindowConversationManager,
  SummarizingConversationManager,
  type Agent,
  type ContentBlock,
  type JSONValue,
  type LocalAgent,
  type Message,
  type ToolResultBlock,
  type ToolResultContent,
} from '@strands-agents/sdk';

import { ACONTEXT_SUMMARIZATION_PROMPT } from '../config/prompts.js';
import { createAcontextSessionResources } from '../rollback/checkpoint-service.js';
import type { AgentStreamEventBus } from '../streaming/stream-event-bus.js';
import {
  ACONTEXT_ENVELOPE_START,
  buildOfficialAcontextEnvelope,
  injectOrReplaceContextEnvelope,
} from './context-envelope.js';
import {
  ACONTEXT_STATE_KEY,
  applyExplicitStateFromUserMessage,
  createDefaultOfficialAcontextState,
  getOfficialAcontextPhaseForMode,
  officialAcontextStateToJson,
  parseOfficialAcontextState,
  type IOfficialAcontextState,
  type TOfficialAcontextMessageKind,
  type TOfficialAcontextMode,
} from './default-state.js';

export interface IOfficialAcontextHookConfig {
  baseSystemPrompt: string;
  sessionId: string;
  mode: TOfficialAcontextMode;
  taskGoal: string;
  currentUserMessage: string;
  now?: () => string;
  streamBus?: AgentStreamEventBus;
}

export interface IOfficialAcontextInvocationState extends Record<string, unknown> {
  sessionId: string;
  taskId: string;
  taskGoal: string;
  mode: TOfficialAcontextMode;
  currentUserMessage: string;
}

export interface ICreateOfficialAcontextInvocationStateConfig {
  sessionId: string;
  taskGoal: string;
  mode: TOfficialAcontextMode;
  currentUserMessage: string;
}

const MAX_TOOL_SUMMARY_CHARS = 2000;
const MAX_TOOL_SUMMARY_COUNT = 5;

const getNow = (config: IOfficialAcontextHookConfig): string =>
  config.now ? config.now() : new Date().toISOString();

const readAcontextState = (
  agent: LocalAgent,
  now: string,
): IOfficialAcontextState =>
  parseOfficialAcontextState(agent.appState.get(ACONTEXT_STATE_KEY), now);

const writeAcontextState = (
  agent: LocalAgent,
  state: IOfficialAcontextState,
): void => {
  agent.appState.set(ACONTEXT_STATE_KEY, officialAcontextStateToJson(state));
};

const createToolSummaryId = (toolName: string, createdAt: string): string =>
  `${toolName.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/gu, '_')}_${createdAt.replace(/[^0-9]/gu, '')}`;

const truncateCodePointSafe = (content: string, maxChars: number): string => {
  const normalized = content.normalize('NFC');
  const codePoints = Array.from(normalized);

  if (codePoints.length <= maxChars) {
    return normalized;
  }

  return `${codePoints.slice(0, maxChars).join('')}...`;
};

const safeJsonStringify = (value: JSONValue): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toolResultContentToText = (content: ToolResultContent): string => {
  if (content.type === 'textBlock') {
    return content.text;
  }

  if (content.type === 'jsonBlock') {
    return safeJsonStringify(content.json);
  }

  return `[${content.type}]`;
};

export const summarizeToolResultBlock = (
  result: ToolResultBlock,
  maxChars = MAX_TOOL_SUMMARY_CHARS,
): string => {
  const text = result.content
    .map(toolResultContentToText)
    .join('\n')
    .trim();
  const normalizedText = text.length > 0
    ? text
    : `工具返回状态：${result.status}`;

  return truncateCodePointSafe(normalizedText, maxChars);
};

const hasToolResultBlock = (message: Message): boolean =>
  message.content.some((block) => block.type === 'toolResultBlock');

const hasToolUseBlock = (message: Message): boolean =>
  message.content.some((block) => block.type === 'toolUseBlock');

const classifyMessageKind = (message: Message): TOfficialAcontextMessageKind => {
  if (hasToolResultBlock(message)) {
    return 'tool_result';
  }

  if (hasToolUseBlock(message)) {
    return 'tool_use';
  }

  if (message.role === 'user' || message.role === 'assistant') {
    return message.role;
  }

  return 'unknown';
};

const blockToVisibleText = (block: ContentBlock): string => {
  if (block.type === 'textBlock') {
    return block.text;
  }

  if (block.type === 'reasoningBlock') {
    return block.text ?? '';
  }

  return '';
};

const messageToRecentFocus = (message: Message): string =>
  truncateCodePointSafe(
    message.content
      .map(blockToVisibleText)
      .join('\n')
      .trim(),
    600,
  );

export const createOfficialAcontextInitialAppState = (
  goal: string,
): Record<string, JSONValue> => ({
  [ACONTEXT_STATE_KEY]: officialAcontextStateToJson(
    createDefaultOfficialAcontextState(new Date().toISOString(), goal),
  ),
});

export const createOfficialAcontextInvocationState = (
  config: ICreateOfficialAcontextInvocationStateConfig,
): IOfficialAcontextInvocationState => ({
  ...config,
  taskId: config.sessionId,
});

export const createOfficialAcontextSessionManager = (
  sessionId: string,
) => createAcontextSessionResources({
  sessionId,
}).sessionManager;

export const createOfficialAcontextConversationManager = (
  mode: TOfficialAcontextMode,
): SlidingWindowConversationManager | SummarizingConversationManager => {
  if (mode === 'ask') {
    return new SlidingWindowConversationManager({
      windowSize: 40,
      shouldTruncateResults: true,
    });
  }

  return new SummarizingConversationManager({
    summaryRatio: 0.3,
    preserveRecentMessages: 10,
    summarizationSystemPrompt: ACONTEXT_SUMMARIZATION_PROMPT,
  });
};

const handleBeforeInvocation = (
  event: BeforeInvocationEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);

  state.currentTask.taskId = config.sessionId;
  state.currentTask.goal = config.taskGoal;
  state.currentTask.phase = getOfficialAcontextPhaseForMode(config.mode);
  state.currentTask.status = 'active';
  state.currentTask.createdAt = state.currentTask.createdAt ?? now;
  state.currentTask.updatedAt = now;

  const nextState = applyExplicitStateFromUserMessage(
    state,
    config.currentUserMessage,
    now,
  );

  writeAcontextState(event.agent, nextState);

  const envelope = buildOfficialAcontextEnvelope(
    event.agent.appState.get(ACONTEXT_STATE_KEY),
  );
  const sourcePrompt = typeof event.agent.systemPrompt === 'string'
    ? event.agent.systemPrompt
    : config.baseSystemPrompt;
  const didReplace = sourcePrompt.includes(ACONTEXT_ENVELOPE_START);

  event.agent.systemPrompt = injectOrReplaceContextEnvelope(
    sourcePrompt,
    envelope,
  );

  config.streamBus?.emitDraft({
    type: didReplace ? 'acontext.envelope.replaced' : 'acontext.envelope.injected',
    visibility: 'debug',
    level: 'debug',
    envelopeCharCount: Array.from(envelope).length,
    systemPromptCharCount: Array.from(event.agent.systemPrompt).length,
    injectedAt: 'beforeInvocation',
  });
};

const handleBeforeModelCall = (
  event: BeforeModelCallEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);
  const projectedInputTokens = event.projectedInputTokens;

  state.compression.lastProjectedInputTokens =
    typeof projectedInputTokens === 'number' ? projectedInputTokens : null;
  state.compression.tokenEstimateAvailable = typeof projectedInputTokens === 'number';
  state.compression.lastCheckedAt = now;

  writeAcontextState(event.agent, state);

  const envelope = buildOfficialAcontextEnvelope(
    event.agent.appState.get(ACONTEXT_STATE_KEY),
  );
  const sourcePrompt = typeof event.agent.systemPrompt === 'string'
    ? event.agent.systemPrompt
    : config.baseSystemPrompt;
  const didReplace = sourcePrompt.includes(ACONTEXT_ENVELOPE_START);

  event.agent.systemPrompt = injectOrReplaceContextEnvelope(
    sourcePrompt,
    envelope,
  );

  config.streamBus?.emitDraft({
    type: 'acontext.token.checked',
    visibility: 'debug',
    level: 'debug',
    projectedInputTokensAvailable: typeof projectedInputTokens === 'number',
    ...(typeof projectedInputTokens === 'number'
      ? { projectedInputTokens }
      : {}),
  });
  config.streamBus?.emitDraft({
    type: didReplace ? 'acontext.envelope.replaced' : 'acontext.envelope.injected',
    visibility: 'debug',
    level: 'debug',
    envelopeCharCount: Array.from(envelope).length,
    systemPromptCharCount: Array.from(event.agent.systemPrompt).length,
    injectedAt: 'beforeModelCall',
  });
};

const handleMessageAdded = (
  event: MessageAddedEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);
  const kind = classifyMessageKind(event.message);

  state.messageStats.totalMessagesSeen += 1;
  state.messageStats.lastMessageAt = now;
  state.messageStats.byKind[kind] += 1;

  if (kind === 'assistant') {
    const recentFocus = messageToRecentFocus(event.message);

    if (recentFocus) {
      state.context.recentFocus = recentFocus;
    }
  }

  writeAcontextState(event.agent, state);
};

const handleAfterToolCall = (
  event: AfterToolCallEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);
  const summary = summarizeToolResultBlock(event.result);
  const isLargeResult = Array.from(summary).length >= MAX_TOOL_SUMMARY_CHARS;
  const toolName = event.toolUse.name || 'unknown_tool';
  const status = event.result.status;

  if (isLargeResult) {
    state.toolContext.largeResultCount += 1;
  }

  state.toolContext.toolSummaries = [
    ...state.toolContext.toolSummaries,
    {
      id: createToolSummaryId(toolName, now),
      tool: toolName,
      status,
      summary,
      createdAt: now,
    },
  ].slice(-MAX_TOOL_SUMMARY_COUNT);

  if (status === 'error' || event.error) {
    state.toolContext.lastToolErrors = [
      ...state.toolContext.lastToolErrors,
      {
        id: createToolSummaryId(`${toolName}_error`, now),
        tool: toolName,
        message: event.error?.message ?? summary,
        createdAt: now,
      },
    ].slice(-MAX_TOOL_SUMMARY_COUNT);
  }

  writeAcontextState(event.agent, state);

  config.streamBus?.emitDraft({
    type: 'acontext.tool_summary.recorded',
    visibility: 'debug',
    level: status === 'error' || event.error ? 'warn' : 'debug',
    toolName,
    summaryCharCount: Array.from(summary).length,
    largeResult: isLargeResult,
  });
};

const handleModelMessage = (
  event: ModelMessageEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);

  state.currentTask.lastStopReason = event.stopReason;
  state.currentTask.updatedAt = now;

  writeAcontextState(event.agent, state);
};

const handleAfterInvocation = (
  event: AfterInvocationEvent,
  config: IOfficialAcontextHookConfig,
): void => {
  const now = getNow(config);
  const state = readAcontextState(event.agent, now);

  state.currentTask.phase = 'turn-finished';
  state.currentTask.updatedAt = now;

  writeAcontextState(event.agent, state);
};

export const registerOfficialAcontextHooks = (
  agent: Agent,
  config: IOfficialAcontextHookConfig,
): (() => void) => {
  const cleanups = [
    agent.addHook(BeforeInvocationEvent, (event) => handleBeforeInvocation(event, config)),
    agent.addHook(BeforeModelCallEvent, (event) => handleBeforeModelCall(event, config)),
    agent.addHook(MessageAddedEvent, (event) => handleMessageAdded(event, config)),
    agent.addHook(AfterToolCallEvent, (event) => handleAfterToolCall(event, config)),
    agent.addHook(ModelMessageEvent, (event) => handleModelMessage(event, config)),
    agent.addHook(AfterInvocationEvent, (event) => handleAfterInvocation(event, config)),
  ];

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
};
