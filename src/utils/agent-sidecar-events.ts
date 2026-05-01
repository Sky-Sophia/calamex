import { AI_AGENT_TOOL_NAMES, type TAiAgentToolName } from '@/types/ai-tools';

import type {
  IAgentPlan,
  IAgentPlanStep,
  IAgentSidecarResponsePayload,
  TAgentUiEvent,
  TJsonValue,
} from '@/types/agent-sidecar';
import type {
  IAiTaskPlanStep,
  IAiToolConfirmationRequest,
  IAiToolCall,
  TAiAgentPlanStepKind,
  TAiAgentPlanStepStatus,
} from '@/types/ai';

export interface IAgentSidecarPlanProjection {
  goal: string;
  steps: IAiTaskPlanStep[];
  toolCalls: IAiToolCall[];
  assistantContent: string;
  errorMessage: string | null;
}

export interface IAgentSidecarExecuteProjection {
  toolCalls: IAiToolCall[];
  assistantContent: string;
  errorMessage: string | null;
  pendingConfirmation: IAiToolConfirmationRequest | null;
}

const AI_AGENT_TOOL_NAME_SET = new Set<string>(AI_AGENT_TOOL_NAMES);

const SIDECAR_TOOL_TO_AI_TOOL: Readonly<Record<string, TAiAgentToolName>> = {
  list_project_files: 'get_project_tree',
  read_project_file: 'read_file',
  search_project_files: 'search_text',
  write_file: 'auto_apply_patch',
  delete_file: 'run_command',
  run_shell_command: 'run_command',
  install_package: 'run_command',
  git_commit: 'create_commit',
};

const isAiAgentToolName = (value: string): value is TAiAgentToolName =>
  AI_AGENT_TOOL_NAME_SET.has(value);

export const mapSidecarToolNameToAiToolName = (toolName: string): TAiAgentToolName => {
  if (isAiAgentToolName(toolName)) {
    return toolName;
  }

  return SIDECAR_TOOL_TO_AI_TOOL[toolName] ?? 'get_project_tree';
};

const normalizeStatus = (status: IAgentPlanStep['status']): TAiAgentPlanStepStatus => status;

const inferStepKind = (tools: readonly string[]): TAiAgentPlanStepKind => {
  if (tools.some((tool) =>
    tool === 'search_project_files' ||
    tool === 'search_files' ||
    tool === 'search_text' ||
    tool === 'search_symbols'
  )) {
    return 'search';
  }

  if (tools.some((tool) =>
    tool === 'write_file' ||
    tool === 'delete_file' ||
    tool === 'propose_patch' ||
    tool === 'auto_apply_patch'
  )) {
    return 'edit';
  }

  if (tools.some((tool) =>
    tool === 'run_shell_command' ||
    tool === 'install_package' ||
    tool === 'run_command' ||
    tool === 'run_test'
  )) {
    return 'verify';
  }

  if (tools.some((tool) =>
    tool === 'git_commit' ||
    tool === 'create_commit' ||
    tool === 'stage_file'
  )) {
    return 'summarize';
  }

  return 'inspect';
};

export const mapSidecarPlanToTaskSteps = (plan: IAgentPlan): IAiTaskPlanStep[] =>
  plan.steps.map((step, index) => ({
    id: step.id,
    index,
    title: step.title,
    goal: step.goal,
    kind: inferStepKind(step.tools),
    status: normalizeStatus(step.status),
    expectedOutput: step.expectedOutput,
    tools: step.tools.map(mapSidecarToolNameToAiToolName),
    requiresUserApproval: step.requiresApproval,
    riskLevel: step.riskLevel,
    ...(step.requiresApproval
      ? { rollbackStrategy: '执行前由后端生成快照，失败或用户不满意时可按任务回滚。' }
      : {}),
  }));

const stringifyJsonValue = (value: TJsonValue): string => JSON.stringify(value);

const clipSummary = (value: string, limit = 96): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(normalized);

  if (characters.length <= limit) {
    return normalized;
  }

  return `${characters.slice(0, limit).join('')}...`;
};

const getRecordValue = (
  value: TJsonValue,
  key: string,
): TJsonValue | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value[key];
};

const getStringField = (value: TJsonValue, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const candidate = getRecordValue(value, key);
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const summarizeJsonValue = (value: TJsonValue): string => {
  if (typeof value === 'string') {
    return clipSummary(value);
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const firstText = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return firstText ? clipSummary(firstText) : clipSummary(stringifyJsonValue(value));
  }

  const priority = getStringField(value, [
    'path',
    'file',
    'filePath',
    'relativePath',
    'query',
    'pattern',
    'command',
    'url',
    'summary',
    'reason',
    'root',
  ]);

  return priority ?? clipSummary(stringifyJsonValue(value));
};

const createToolCallId = (event: TAgentUiEvent, index: number): string => {
  if (event.type === 'approval_required') {
    return `sidecar-approval:${event.request.id}`;
  }

  if (event.type === 'tool_start' || event.type === 'tool_result') {
    return `sidecar-tool:${index}:${event.toolName}`;
  }

  return `sidecar-event:${index}:${event.type}`;
};

export const mapSidecarEventsToToolCalls = (events: readonly TAgentUiEvent[]): IAiToolCall[] => {
  const toolCalls: IAiToolCall[] = [];

  for (const [index, event] of events.entries()) {
    if (event.type === 'tool_start') {
      toolCalls.push({
        id: createToolCallId(event, index),
        name: event.toolName,
        status: 'running',
        summary: summarizeJsonValue(event.input),
        targetPreview: summarizeJsonValue(event.input),
      });
      continue;
    }

    if (event.type === 'tool_result') {
      let existingIndex = -1;
      for (let itemIndex = toolCalls.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const toolCall = toolCalls[itemIndex];
        if (toolCall?.name === event.toolName && toolCall.status === 'running') {
          existingIndex = itemIndex;
          break;
        }
      }
      const summary = summarizeJsonValue(event.output);

      if (existingIndex >= 0) {
        const existing = toolCalls[existingIndex];
        if (existing) {
          toolCalls[existingIndex] = {
            ...existing,
            status: 'succeeded',
            summary,
            targetPreview: existing.targetPreview ?? summary,
          };
        }
        continue;
      }

      toolCalls.push({
        id: createToolCallId(event, index),
        name: event.toolName,
        status: 'succeeded',
        summary,
        targetPreview: summary,
      });
      continue;
    }

    if (event.type === 'approval_required') {
      toolCalls.push({
        id: createToolCallId(event, index),
        name: event.request.toolName,
        status: 'pending',
        summary: `等待审批：${event.request.summary}`,
        targetPreview: event.request.summary,
      });
    }
  }

  return toolCalls;
};

const extractPlan = (events: readonly TAgentUiEvent[]): IAgentPlan | null =>
  events.find((event): event is Extract<TAgentUiEvent, { type: 'plan_ready' }> =>
    event.type === 'plan_ready'
  )?.plan ?? null;

const extractErrorMessage = (events: readonly TAgentUiEvent[]): string | null =>
  events.find((event): event is Extract<TAgentUiEvent, { type: 'error' }> =>
    event.type === 'error'
  )?.message ?? null;

const extractDoneResult = (events: readonly TAgentUiEvent[]): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'done') {
      return event.result.trim() || null;
    }
  }

  return null;
};

const extractLatestMessageDelta = (events: readonly TAgentUiEvent[]): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'message_delta') {
      return event.text.trim() || null;
    }
  }

  return null;
};

const buildAssistantContent = (
  goal: string,
  plan: IAgentPlan | null,
  doneResult: string | null,
): string => {
  if (doneResult) {
    return doneResult;
  }

  if (!plan) {
    return 'Plan 模式没有收到有效计划。';
  }

  return [
    `已生成计划：${goal}`,
    '',
    ...plan.steps.map((step, index) => `${index + 1}. ${step.title}`),
  ].join('\n');
};

export const projectSidecarPlanResponse = (
  response: IAgentSidecarResponsePayload,
  fallbackGoal: string,
): IAgentSidecarPlanProjection => {
  const plan = extractPlan(response.events);
  const errorMessage = extractErrorMessage(response.events);
  const goal = plan?.goal ?? fallbackGoal;

  return {
    goal,
    steps: plan ? mapSidecarPlanToTaskSteps(plan) : [],
    toolCalls: mapSidecarEventsToToolCalls(response.events),
    assistantContent: buildAssistantContent(goal, plan, extractDoneResult(response.events)),
    errorMessage: errorMessage ?? (plan ? null : 'sidecar 未返回 plan_ready 事件，计划没有生成。'),
  };
};

const TOOL_CONFIRMATION_OPTIONS: IAiToolConfirmationRequest['options'] = [
  { id: 'allow-once', label: '允许一次', tone: 'primary' },
  { id: 'skip', label: '跳过' },
  { id: 'stop', label: '停止', tone: 'danger' },
];

const mapSidecarApprovalToToolConfirmation = (
  event: Extract<TAgentUiEvent, { type: 'approval_required' }>,
  sessionId: string,
): IAiToolConfirmationRequest => ({
  id: event.request.id,
  runId: `sidecar:${sessionId}`,
  stepId: `sidecar:${event.request.id}`,
  toolName: mapSidecarToolNameToAiToolName(event.request.toolName),
  question: event.request.question,
  summary: event.request.summary,
  riskLevel: event.request.riskLevel,
  impact: event.request.summary,
  reversible: event.request.reversible,
  createdAt: event.request.createdAt,
  options: TOOL_CONFIRMATION_OPTIONS,
});

const extractPendingConfirmation = (
  response: IAgentSidecarResponsePayload,
): IAiToolConfirmationRequest | null => {
  const approval = response.events.find((event): event is Extract<TAgentUiEvent, { type: 'approval_required' }> =>
    event.type === 'approval_required'
  );

  return approval ? mapSidecarApprovalToToolConfirmation(approval, response.sessionId) : null;
};

export const projectSidecarExecuteResponse = (
  response: IAgentSidecarResponsePayload,
): IAgentSidecarExecuteProjection => {
  const errorMessage = extractErrorMessage(response.events);
  const doneResult = extractDoneResult(response.events);
  const latestDelta = extractLatestMessageDelta(response.events);
  const assistantContent = errorMessage
    ? `Agent 执行失败：${errorMessage}`
    : doneResult ?? response.result?.trim() ?? latestDelta ?? 'Agent 已完成。';

  return {
    toolCalls: mapSidecarEventsToToolCalls(response.events),
    assistantContent,
    errorMessage,
    pendingConfirmation: extractPendingConfirmation(response),
  };
};
