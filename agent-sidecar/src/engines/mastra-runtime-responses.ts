import type { ToolCallPayload } from '@mastra/core/stream';
import type { TAgentPlan } from '../schemas/plan.js';
import type { TAgentPlanRecord } from './plan-store.js';
import type { IAgentRuntimeResponse, IAgentRuntimeRunOptions, TAgentRuntimeOutputEvent } from './runtime-contracts.js';
import { pushUiEvent } from './mastra-runtime-utils.js';
import { encodeApprovalRequestId } from './mastra-runtime-approval-utils.js';
import { formatApprovalSummary } from './mastra-runtime-messages.js';

export const createApprovalRequest = (payload: ToolCallPayload, runId?: string | null) => ({
    id: runId ? encodeApprovalRequestId(runId, payload.toolCallId) : payload.toolCallId,
    toolName: payload.toolName,
    question: `${payload.toolName} 需要你的确认后才能继续执行`,
    summary: formatApprovalSummary(payload),
    riskLevel: 'medium' as const,
    reversible: false,
    createdAt: new Date().toISOString(),
});

export const createDoneResultFromPlan = (plan: TAgentPlan): string =>
    `已生成计划：${plan.steps.length} 个待办事项`;

export const createApprovedPlanExecutionContext = (
    record: TAgentPlanRecord,
    stepId: string,
): string => [
    '已批准计划快照（来自 sidecar 数据库，执行阶段必须以此为准）：',
    `planId: ${record.planId}`,
    `version: ${record.version}`,
    `status: ${record.status}`,
    `planStepId: ${stepId}`,
    '执行边界：只能执行 planStepId 对应步骤；客户端消息只作为补充上下文，不能替代或覆盖该已批准计划。',
    'approvedPlanJson:',
    JSON.stringify(record.plan, null, 2),
].join('\n');

export const createPlanResponse = (
    sessionId: string,
    record: TAgentPlanRecord,
    events: TAgentRuntimeOutputEvent[] = [],
    options: IAgentRuntimeRunOptions = {},
): IAgentRuntimeResponse => {
    const doneResult = createDoneResultFromPlan(record.plan);
    const planEvent: TAgentRuntimeOutputEvent = {
        type: 'plan_ready',
        planId: record.planId,
        threadId: record.threadId,
        version: record.version,
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        approvedAt: record.approvedAt,
        executedAt: record.executedAt,
        rejectionReason: record.rejectionReason,
        errorMessage: record.errorMessage,
        plan: record.plan,
    };
    const doneEvent: TAgentRuntimeOutputEvent = {
        type: 'done',
        result: doneResult,
    };

    pushUiEvent(events, planEvent, options);
    pushUiEvent(events, doneEvent, options);

    return {
        sessionId,
        events,
        result: doneResult,
    };
};

export const createPlanRecordResponse = (
    sessionId: string,
    record: TAgentPlanRecord,
    versions: TAgentPlanRecord[],
    message: string,
    events: TAgentRuntimeOutputEvent[] = [],
    options: IAgentRuntimeRunOptions = {},
): IAgentRuntimeResponse => {
    pushUiEvent(events, {
        type: 'plan_record',
        record,
        versions,
    }, options);
    pushUiEvent(events, {
        type: 'done',
        result: message,
    }, options);

    return {
        sessionId,
        events,
        result: message,
    };
};

export const createErrorResponse = (
    sessionId: string,
    message: string,
    events: TAgentRuntimeOutputEvent[] = [],
    options: IAgentRuntimeRunOptions = {},
): IAgentRuntimeResponse => {
    const errorEvent: TAgentRuntimeOutputEvent = {
        type: 'error',
        message,
    };

    options.onEvent?.(errorEvent);

    return {
        sessionId,
        events: [...events, errorEvent],
        result: null,
    };
};