import { createHash, randomUUID } from 'node:crypto';

import { createClient, type Client, type Row } from '@libsql/client';

import {
    agentPlanSchema,
    type TAgentPlanRecord,
} from '../schemas/plan.js';
import {
    agentPlanWorkflowEventRecordSchema,
    agentPlanWorkflowEventSchema,
    agentPlanWorkflowRecordSchema,
    agentPlanWorkflowStateSchema,
    type TAgentPlanWorkflowEvent,
    type TAgentPlanWorkflowEventRecord,
    type TAgentPlanWorkflowRecord,
    type TAgentPlanWorkflowState,
    type TAgentPlanWorkflowStatus,
    type TAgentPlanWorkflowSuspendReason,
    type TAgentPlanDelta,
    type TAgentPlanValidationReport,
} from '../schemas/plan-workflow.js';
import type { JSONValue } from '../types/json-value.js';
import { resolveMastraStorageUrl } from './mastra-memory.js';

const WORKFLOW_RUN_TABLE = 'agent_plan_workflow_runs';
const WORKFLOW_EVENT_TABLE = 'agent_plan_workflow_events';

const WORKFLOW_RUN_SELECT_FIELDS = [
    'workflow_run_id',
    'plan_id',
    'plan_version',
    'thread_id',
    'status',
    'phase',
    'current_step_id',
    'execution_cursor',
    'approved_plan_hash',
    'last_heartbeat_at',
    'parent_run_id',
    'replan_of_version',
    'suspend_reason',
    'suspend_token',
    'mastra_run_id',
    'created_at',
    'updated_at',
    'suspended_at',
    'resumed_at',
    'finished_at',
    'error_message',
    'state_json',
].join(', ');

const WORKFLOW_EVENT_SELECT_FIELDS = [
    'event_id',
    'workflow_run_id',
    'plan_id',
    'plan_version',
    'seq',
    'created_at',
    'event_json',
].join(', ');

export interface IPlanWorkflowVersionInput {
    planId: string;
    version: number;
}

export interface ICreatePlanWorkflowInput {
    record: TAgentPlanRecord;
    parentRunId?: string | undefined;
    replanOfVersion?: number | undefined;
}

export interface IStartPlanWorkflowStepInput extends IPlanWorkflowVersionInput {
    stepId: string;
    mastraRunId?: string | undefined;
}

export interface ICompletePlanWorkflowStepInput extends IPlanWorkflowVersionInput {
    stepId: string;
    resultRef?: string | undefined;
}

export interface IFailPlanWorkflowStepInput extends IPlanWorkflowVersionInput {
    stepId: string;
    error: string;
    retryable: boolean;
}

export interface IHeartbeatPlanWorkflowInput extends IPlanWorkflowVersionInput {
    stepId?: string | undefined;
    phase: 'before_tool' | 'after_tool' | 'step_start' | 'step_end';
}

export interface ISuspendPlanWorkflowInput extends IPlanWorkflowVersionInput {
    reason: TAgentPlanWorkflowSuspendReason;
    payload?: JSONValue | undefined;
    expiresAt?: string | undefined;
    allowedFields?: string[] | undefined;
}

export interface IFinishPlanWorkflowInput extends IPlanWorkflowVersionInput {
    status: Extract<TAgentPlanWorkflowStatus, 'completed' | 'failed' | 'rejected' | 'cancelled'>;
    errorMessage?: string | undefined;
}

export interface IReportPlanValidatorInput extends IPlanWorkflowVersionInput {
    report: TAgentPlanValidationReport;
}

export interface IIssuePlanReplanInput extends IPlanWorkflowVersionInput {
    toVersion: number;
    delta: TAgentPlanDelta;
    deltaRef?: string | undefined;
}

export interface IAgentPlanWorkflowStore {
    createForPlan(input: ICreatePlanWorkflowInput): Promise<TAgentPlanWorkflowRecord>;
    getWorkflow(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowRecord>;
    listEvents(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowEventRecord[]>;
    approvePlan(record: TAgentPlanRecord, approvedBy?: string | undefined): Promise<TAgentPlanWorkflowRecord>;
    rejectPlan(record: TAgentPlanRecord, reason?: string | undefined): Promise<TAgentPlanWorkflowRecord>;
    startStep(input: IStartPlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord>;
    completeStep(input: ICompletePlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord>;
    failStep(input: IFailPlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord>;
    heartbeat(input: IHeartbeatPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord>;
    suspend(input: ISuspendPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord>;
    reportValidator(input: IReportPlanValidatorInput): Promise<TAgentPlanWorkflowRecord>;
    issueReplan(input: IIssuePlanReplanInput): Promise<TAgentPlanWorkflowRecord>;
    finishPlan(input: IFinishPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord>;
}

const toNonEmptyString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const rowString = (row: Row, key: string): string => {
    const value = row[key];

    if (typeof value !== 'string') {
        throw new Error(`计划 workflow 字段 ${key} 不是字符串。`);
    }

    return value;
};

const rowNullableString = (row: Row, key: string): string | null => {
    const value = row[key];

    if (value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new Error(`计划 workflow 字段 ${key} 不是字符串或 null。`);
    }

    return value;
};

const rowPositiveInteger = (row: Row, key: string): number => {
    const value = row[key];

    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }

    if (typeof value === 'bigint' && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(value);
    }

    throw new Error(`计划 workflow 字段 ${key} 不是正整数。`);
};

const rowNonNegativeInteger = (row: Row, key: string): number => {
    const value = row[key];

    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(value);
    }

    throw new Error(`计划 workflow 字段 ${key} 不是非负整数。`);
};

const parseJsonValue = (value: string): unknown => JSON.parse(value) as unknown;

const toRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;

const normalizeWorkflowStateInput = (value: unknown): unknown => {
    const record = toRecord(value);
    const validator = toRecord(record?.validator);

    if (!record || !validator || 'needsReplan' in validator) {
        return value;
    }

    return {
        ...record,
        validator: {
            ...validator,
            needsReplan: false,
        },
    };
};

const parseWorkflowState = (value: string): TAgentPlanWorkflowState =>
    agentPlanWorkflowStateSchema.parse(normalizeWorkflowStateInput(parseJsonValue(value)));

const serializeWorkflowState = (state: TAgentPlanWorkflowState): string =>
    JSON.stringify(agentPlanWorkflowStateSchema.parse(state));

const parseWorkflowEvent = (value: string): TAgentPlanWorkflowEvent =>
    agentPlanWorkflowEventSchema.parse(parseJsonValue(value));

const serializeWorkflowEvent = (event: TAgentPlanWorkflowEvent): string =>
    JSON.stringify(agentPlanWorkflowEventSchema.parse(event));

const hashApprovedPlan = (record: TAgentPlanRecord): string => createHash('sha256')
    .update(JSON.stringify(agentPlanSchema.parse(record.plan)))
    .digest('hex');

const createStepIdempotencyKey = (input: IPlanWorkflowVersionInput & { stepId: string }): string =>
    `${input.planId}:v${input.version}:step:${input.stepId}`;

const createSuspendToken = (input: IPlanWorkflowVersionInput & { reason: TAgentPlanWorkflowSuspendReason }): string =>
    `${input.planId}:v${input.version}:suspend:${input.reason}:${randomUUID()}`;

const toWorkflowRecord = (row: Row): TAgentPlanWorkflowRecord =>
    agentPlanWorkflowRecordSchema.parse({
        workflowRunId: rowString(row, 'workflow_run_id'),
        planId: rowString(row, 'plan_id'),
        planVersion: rowPositiveInteger(row, 'plan_version'),
        threadId: rowString(row, 'thread_id'),
        status: rowString(row, 'status'),
        phase: rowString(row, 'phase'),
        currentStepId: rowNullableString(row, 'current_step_id'),
        mastraRunId: rowNullableString(row, 'mastra_run_id'),
        createdAt: rowString(row, 'created_at'),
        updatedAt: rowString(row, 'updated_at'),
        suspendedAt: rowNullableString(row, 'suspended_at'),
        resumedAt: rowNullableString(row, 'resumed_at'),
        finishedAt: rowNullableString(row, 'finished_at'),
        errorMessage: rowNullableString(row, 'error_message'),
        state: parseWorkflowState(rowString(row, 'state_json')),
    });

const toWorkflowEventRecord = (row: Row): TAgentPlanWorkflowEventRecord =>
    agentPlanWorkflowEventRecordSchema.parse({
        eventId: rowString(row, 'event_id'),
        workflowRunId: rowString(row, 'workflow_run_id'),
        planId: rowString(row, 'plan_id'),
        planVersion: rowPositiveInteger(row, 'plan_version'),
        seq: rowNonNegativeInteger(row, 'seq'),
        createdAt: rowString(row, 'created_at'),
        event: parseWorkflowEvent(rowString(row, 'event_json')),
    });

const createInitialState = (
    record: TAgentPlanRecord,
    planHash: string,
    parentRunId: string | null,
    replanOfVersion: number | null,
): TAgentPlanWorkflowState => {
    const stepIds = record.plan.steps.map((step) => step.id);
    const stepIdempotencyKeys = Object.fromEntries(
        stepIds.map((stepId) => [stepId, createStepIdempotencyKey({
            planId: record.planId,
            version: record.version,
            stepId,
        })]),
    );

    return agentPlanWorkflowStateSchema.parse({
        planId: record.planId,
        planVersion: record.version,
        threadId: record.threadId,
        stepIds,
        stepIdempotencyKeys,
        executionCursor: 0,
        approvedPlanHash: planHash,
        currentStepId: null,
        completedStepIds: [],
        failedStepIds: [],
        lastHeartbeatAt: null,
        parentRunId,
        replanOfVersion,
        suspend: {
            reason: null,
            token: null,
            payload: null,
            expiresAt: null,
            resumeContract: null,
        },
        approval: {
            required: true,
            approved: false,
            rejected: false,
            reason: null,
        },
        validator: {
            status: 'pending',
            summary: null,
            needsReplan: false,
        },
    });
};

const defaultResumeContract = {
    allowedFields: ['decision', 'approvedBy', 'reason'],
};

class WorkflowProjection {
    status: TAgentPlanWorkflowStatus = 'waiting_approval';

    phase: TAgentPlanWorkflowRecord['phase'] = 'approval_gate';

    currentStepId: string | null = null;

    mastraRunId: string | null = null;

    suspendedAt: string | null = null;

    resumedAt: string | null = null;

    finishedAt: string | null = null;

    errorMessage: string | null = null;

    state: TAgentPlanWorkflowState;

    constructor(initialState: TAgentPlanWorkflowState) {
        this.state = initialState;
    }
}

const projectWorkflow = (
    initialState: TAgentPlanWorkflowState,
    events: TAgentPlanWorkflowEventRecord[],
): WorkflowProjection => {
    const projection = new WorkflowProjection(initialState);

    for (const eventRecord of events) {
        const { event } = eventRecord;

        switch (event.type) {
            case 'PlanGenerated':
                projection.status = 'waiting_approval';
                projection.phase = 'approval_gate';
                projection.state.approvedPlanHash = event.planHash;
                projection.state.stepIds = event.stepIds;
                break;
            case 'PlanApproved':
                projection.status = 'approved';
                projection.phase = 'execute_plan';
                projection.state.approval.approved = true;
                projection.state.approvedPlanHash = event.approvedHash;
                break;
            case 'StepStarted':
                projection.status = 'executing';
                projection.phase = 'execute_plan';
                projection.currentStepId = event.stepId;
                projection.mastraRunId = event.mastraRunId;
                projection.state.currentStepId = event.stepId;
                projection.state.stepIdempotencyKeys[event.stepId] = event.idempotencyKey;
                projection.state.lastHeartbeatAt = eventRecord.createdAt;
                break;
            case 'StepCompleted': {
                projection.state.completedStepIds = [
                    ...new Set([...projection.state.completedStepIds, event.stepId]),
                ];
                projection.state.failedStepIds = projection.state.failedStepIds.filter((stepId) => stepId !== event.stepId);
                projection.state.executionCursor = projection.state.stepIds.reduce((cursor, stepId, index) =>
                    projection.state.completedStepIds.includes(stepId) ? Math.max(cursor, index + 1) : cursor, 0);
                projection.state.lastHeartbeatAt = eventRecord.createdAt;

                if (projection.currentStepId === event.stepId) {
                    projection.currentStepId = null;
                    projection.state.currentStepId = null;
                }

                if (projection.state.executionCursor >= projection.state.stepIds.length) {
                    projection.phase = 'validate_result';
                }
                break;
            }
            case 'StepFailed':
                projection.status = 'failed';
                projection.phase = 'execute_plan';
                projection.errorMessage = event.error;
                projection.state.failedStepIds = [
                    ...new Set([...projection.state.failedStepIds, event.stepId]),
                ];
                projection.state.lastHeartbeatAt = eventRecord.createdAt;
                break;
            case 'ValidatorReported':
                projection.phase = 'validate_result';
                projection.state.validator.status = event.report.status;
                projection.state.validator.summary = event.report.summary;
                projection.state.validator.needsReplan = event.report.needsReplan;
                break;
            case 'ReplanIssued':
                projection.phase = 'replan';
                projection.state.replanOfVersion = event.fromVersion;
                break;
            case 'Suspended':
                projection.status = event.reason === 'plan_approval' ? 'waiting_approval' : projection.status;
                projection.phase = event.reason === 'validator_needs_replan' ? 'replan' : projection.phase;
                projection.suspendedAt = eventRecord.createdAt;
                projection.state.suspend = {
                    reason: event.reason,
                    token: event.token,
                    payload: event.payload,
                    expiresAt: event.expiresAt,
                    resumeContract: event.resumeContract,
                };
                break;
            case 'Resumed':
                projection.resumedAt = eventRecord.createdAt;
                projection.state.suspend = {
                    reason: null,
                    token: null,
                    payload: null,
                    expiresAt: null,
                    resumeContract: null,
                };
                break;
            case 'Heartbeat':
                projection.state.lastHeartbeatAt = eventRecord.createdAt;
                break;
            case 'PlanFinished':
                projection.status = event.status;
                projection.phase = 'finish';
                projection.finishedAt = eventRecord.createdAt;
                projection.errorMessage = event.errorMessage;
                projection.state.approval.rejected = event.status === 'rejected';
                break;
        }
    }

    return projection;
};

export class LibsqlAgentPlanWorkflowStore implements IAgentPlanWorkflowStore {
    private readonly client: Client;

    private readonly now: () => string;

    private initialized: Promise<void> | null = null;

    constructor(options: { client?: Client; url?: string; now?: () => string } = {}) {
        this.client = options.client ?? createClient({ url: options.url ?? resolveMastraStorageUrl() });
        this.now = options.now ?? (() => new Date().toISOString());
    }

    async createForPlan(input: ICreatePlanWorkflowInput): Promise<TAgentPlanWorkflowRecord> {
        await this.ensureInitialized();
        const existing = await this.getWorkflowOrNull({
            planId: input.record.planId,
            version: input.record.version,
        });

        if (existing) {
            return existing;
        }

        const workflowRunId = randomUUID();
        const createdAt = this.now();
        const planHash = hashApprovedPlan(input.record);
        const initialState = createInitialState(
            input.record,
            planHash,
            toNonEmptyString(input.parentRunId),
            input.replanOfVersion ?? null,
        );
        const suspendToken = createSuspendToken({
            planId: input.record.planId,
            version: input.record.version,
            reason: 'plan_approval',
        });
        const transaction = await this.client.transaction('write');

        try {
            await transaction.execute({
                sql: `
                    INSERT INTO ${WORKFLOW_RUN_TABLE} (
                        workflow_run_id,
                        plan_id,
                        plan_version,
                        thread_id,
                        status,
                        phase,
                        current_step_id,
                        execution_cursor,
                        approved_plan_hash,
                        last_heartbeat_at,
                        parent_run_id,
                        replan_of_version,
                        suspend_reason,
                        suspend_token,
                        mastra_run_id,
                        created_at,
                        updated_at,
                        suspended_at,
                        resumed_at,
                        finished_at,
                        error_message,
                        state_json
                    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, ?)
                `,
                args: [
                    workflowRunId,
                    input.record.planId,
                    input.record.version,
                    input.record.threadId,
                    'waiting_approval',
                    'approval_gate',
                    planHash,
                    initialState.parentRunId,
                    initialState.replanOfVersion,
                    createdAt,
                    createdAt,
                    serializeWorkflowState(initialState),
                ],
            });
            await this.appendEventWithTransaction(transaction, workflowRunId, input.record.planId, input.record.version, 0, createdAt, {
                type: 'PlanGenerated',
                planId: input.record.planId,
                version: input.record.version,
                threadId: input.record.threadId,
                planHash,
                stepIds: initialState.stepIds,
            });
            await this.appendEventWithTransaction(transaction, workflowRunId, input.record.planId, input.record.version, 1, createdAt, {
                type: 'Suspended',
                reason: 'plan_approval',
                token: suspendToken,
                payload: {
                    planId: input.record.planId,
                    version: input.record.version,
                },
                expiresAt: null,
                resumeContract: defaultResumeContract,
            });
            await transaction.commit();
        } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
        } finally {
            transaction.close();
        }

        return await this.reproject({
            planId: input.record.planId,
            version: input.record.version,
        });
    }

    async getWorkflow(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowRecord> {
        const record = await this.getWorkflowOrNull(input);

        if (record) {
            return record;
        }

        throw new Error(`未找到计划 workflow ${input.planId}@v${input.version}。`);
    }

    async listEvents(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowEventRecord[]> {
        await this.ensureInitialized();
        const result = await this.client.execute({
            sql: `
                SELECT ${WORKFLOW_EVENT_SELECT_FIELDS}
                FROM ${WORKFLOW_EVENT_TABLE}
                WHERE plan_id = ? AND plan_version = ?
                ORDER BY seq ASC
            `,
            args: [input.planId, input.version],
        });

        return result.rows.map(toWorkflowEventRecord);
    }

    async approvePlan(record: TAgentPlanRecord, approvedBy?: string | undefined): Promise<TAgentPlanWorkflowRecord> {
        await this.createForPlan({ record });
        const workflow = await this.getWorkflow({
            planId: record.planId,
            version: record.version,
        });
        const approvedHash = hashApprovedPlan(record);

        if (workflow.state.approvedPlanHash !== approvedHash) {
            throw new Error(`批准计划哈希不一致：${record.planId}@v${record.version}。`);
        }

        if (workflow.status === 'approved' || workflow.status === 'executing' || workflow.status === 'completed') {
            return workflow;
        }

        await this.appendEvents({
            planId: record.planId,
            version: record.version,
        }, [
            {
                type: 'PlanApproved',
                version: record.version,
                approvedHash,
                approvedBy: toNonEmptyString(approvedBy),
            },
            ...(workflow.state.suspend.token
                ? [{
                    type: 'Resumed' as const,
                    token: workflow.state.suspend.token,
                }]
                : []),
        ]);

        return await this.reproject({
            planId: record.planId,
            version: record.version,
        });
    }

    async rejectPlan(record: TAgentPlanRecord, reason?: string | undefined): Promise<TAgentPlanWorkflowRecord> {
        await this.createForPlan({ record });

        return await this.finishPlan({
            planId: record.planId,
            version: record.version,
            status: 'rejected',
            errorMessage: reason,
        });
    }

    async startStep(input: IStartPlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord> {
        const workflow = await this.getWorkflow(input);
        const idempotencyKey = workflow.state.stepIdempotencyKeys[input.stepId]
            ?? createStepIdempotencyKey(input);

        if (workflow.state.completedStepIds.includes(input.stepId)) {
            return workflow;
        }

        await this.appendEvents(input, [
            {
                type: 'StepStarted',
                stepId: input.stepId,
                idempotencyKey,
                mastraRunId: toNonEmptyString(input.mastraRunId),
                toolCall: null,
            },
            {
                type: 'Heartbeat',
                stepId: input.stepId,
                phase: 'step_start',
            },
        ]);

        return await this.reproject(input);
    }

    async completeStep(input: ICompletePlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord> {
        const workflow = await this.getWorkflow(input);
        const idempotencyKey = workflow.state.stepIdempotencyKeys[input.stepId]
            ?? createStepIdempotencyKey(input);

        if (workflow.state.completedStepIds.includes(input.stepId)) {
            return workflow;
        }

        await this.appendEvents(input, [
            {
                type: 'StepCompleted',
                stepId: input.stepId,
                idempotencyKey,
                resultRef: toNonEmptyString(input.resultRef),
            },
            {
                type: 'Heartbeat',
                stepId: input.stepId,
                phase: 'step_end',
            },
        ]);

        return await this.reproject(input);
    }

    async failStep(input: IFailPlanWorkflowStepInput): Promise<TAgentPlanWorkflowRecord> {
        const workflow = await this.getWorkflow(input);
        const idempotencyKey = workflow.state.stepIdempotencyKeys[input.stepId]
            ?? createStepIdempotencyKey(input);

        await this.appendEvents(input, [{
            type: 'StepFailed',
            stepId: input.stepId,
            idempotencyKey,
            error: input.error,
            retryable: input.retryable,
        }]);

        return await this.reproject(input);
    }

    async heartbeat(input: IHeartbeatPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord> {
        await this.appendEvents(input, [{
            type: 'Heartbeat',
            stepId: toNonEmptyString(input.stepId),
            phase: input.phase,
        }]);

        return await this.reproject(input);
    }

    async suspend(input: ISuspendPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord> {
        await this.appendEvents(input, [{
            type: 'Suspended',
            reason: input.reason,
            token: createSuspendToken(input),
            payload: input.payload ?? null,
            expiresAt: toNonEmptyString(input.expiresAt),
            resumeContract: {
                allowedFields: input.allowedFields ?? defaultResumeContract.allowedFields,
            },
        }]);

        return await this.reproject(input);
    }

    async reportValidator(input: IReportPlanValidatorInput): Promise<TAgentPlanWorkflowRecord> {
        const events: TAgentPlanWorkflowEvent[] = [{
            type: 'ValidatorReported',
            report: input.report,
        }];

        if (input.report.needsReplan) {
            events.push({
                type: 'Suspended',
                reason: 'validator_needs_replan',
                token: createSuspendToken({
                    planId: input.planId,
                    version: input.version,
                    reason: 'validator_needs_replan',
                }),
                payload: {
                    report: input.report,
                },
                expiresAt: null,
                resumeContract: {
                    allowedFields: ['decision', 'replanInstruction'],
                },
            });
        }

        await this.appendEvents(input, events);

        return await this.reproject(input);
    }

    async issueReplan(input: IIssuePlanReplanInput): Promise<TAgentPlanWorkflowRecord> {
        await this.appendEvents(input, [{
            type: 'ReplanIssued',
            fromVersion: input.version,
            toVersion: input.toVersion,
            deltaRef: toNonEmptyString(input.deltaRef),
            delta: input.delta,
        }]);

        return await this.reproject(input);
    }

    async finishPlan(input: IFinishPlanWorkflowInput): Promise<TAgentPlanWorkflowRecord> {
        const workflow = await this.getWorkflow(input);

        if (workflow.status === input.status) {
            return workflow;
        }

        await this.appendEvents(input, [{
            type: 'PlanFinished',
            status: input.status,
            errorMessage: toNonEmptyString(input.errorMessage),
        }]);

        return await this.reproject(input);
    }

    private async ensureInitialized(): Promise<void> {
        this.initialized ??= this.client.executeMultiple(`
            CREATE TABLE IF NOT EXISTS ${WORKFLOW_RUN_TABLE} (
                workflow_run_id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                plan_version INTEGER NOT NULL,
                thread_id TEXT NOT NULL,
                status TEXT NOT NULL,
                phase TEXT NOT NULL,
                current_step_id TEXT,
                execution_cursor INTEGER NOT NULL DEFAULT 0,
                approved_plan_hash TEXT NOT NULL,
                last_heartbeat_at TEXT,
                parent_run_id TEXT,
                replan_of_version INTEGER,
                suspend_reason TEXT,
                suspend_token TEXT,
                mastra_run_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                suspended_at TEXT,
                resumed_at TEXT,
                finished_at TEXT,
                error_message TEXT,
                state_json TEXT NOT NULL,
                UNIQUE (plan_id, plan_version)
            );
            CREATE TABLE IF NOT EXISTS ${WORKFLOW_EVENT_TABLE} (
                event_id TEXT PRIMARY KEY,
                workflow_run_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                plan_version INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                type TEXT NOT NULL,
                event_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (workflow_run_id, seq)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_plan_workflow_events_plan
                ON ${WORKFLOW_EVENT_TABLE} (plan_id, plan_version, seq);
            CREATE INDEX IF NOT EXISTS idx_agent_plan_workflow_runs_plan
                ON ${WORKFLOW_RUN_TABLE} (plan_id, plan_version);
            CREATE INDEX IF NOT EXISTS idx_agent_plan_workflow_runs_status_heartbeat
                ON ${WORKFLOW_RUN_TABLE} (status, last_heartbeat_at);
        `);

        await this.initialized;
    }

    private async getWorkflowOrNull(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowRecord | null> {
        await this.ensureInitialized();
        const result = await this.client.execute({
            sql: `
                SELECT ${WORKFLOW_RUN_SELECT_FIELDS}
                FROM ${WORKFLOW_RUN_TABLE}
                WHERE plan_id = ? AND plan_version = ?
                LIMIT 1
            `,
            args: [input.planId, input.version],
        });
        const row = result.rows[0];

        return row ? toWorkflowRecord(row) : null;
    }

    private async appendEvents(
        input: IPlanWorkflowVersionInput,
        events: TAgentPlanWorkflowEvent[],
    ): Promise<void> {
        const workflow = await this.getWorkflow(input);
        const existingEvents = await this.listEvents(input);
        let nextSeq = existingEvents.length;
        const createdAt = this.now();
        const transaction = await this.client.transaction('write');

        try {
            for (const event of events) {
                await this.appendEventWithTransaction(
                    transaction,
                    workflow.workflowRunId,
                    input.planId,
                    input.version,
                    nextSeq,
                    createdAt,
                    event,
                );
                nextSeq += 1;
            }
            await transaction.commit();
        } catch (error) {
            await transaction.rollback().catch(() => undefined);
            throw error;
        } finally {
            transaction.close();
        }
    }

    private async appendEventWithTransaction(
        transaction: Awaited<ReturnType<Client['transaction']>>,
        workflowRunId: string,
        planId: string,
        planVersion: number,
        seq: number,
        createdAt: string,
        event: TAgentPlanWorkflowEvent,
    ): Promise<void> {
        const parsedEvent = agentPlanWorkflowEventSchema.parse(event);
        await transaction.execute({
            sql: `
                INSERT INTO ${WORKFLOW_EVENT_TABLE} (
                    event_id,
                    workflow_run_id,
                    plan_id,
                    plan_version,
                    seq,
                    type,
                    event_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                randomUUID(),
                workflowRunId,
                planId,
                planVersion,
                seq,
                parsedEvent.type,
                serializeWorkflowEvent(parsedEvent),
                createdAt,
            ],
        });
    }

    private async reproject(input: IPlanWorkflowVersionInput): Promise<TAgentPlanWorkflowRecord> {
        const workflow = await this.getWorkflow(input);
        const events = await this.listEvents(input);
        const initialState = workflow.state;
        const projection = projectWorkflow(initialState, events);
        const updatedAt = this.now();

        await this.client.execute({
            sql: `
                UPDATE ${WORKFLOW_RUN_TABLE}
                SET
                    status = ?,
                    phase = ?,
                    current_step_id = ?,
                    execution_cursor = ?,
                    approved_plan_hash = ?,
                    last_heartbeat_at = ?,
                    parent_run_id = ?,
                    replan_of_version = ?,
                    suspend_reason = ?,
                    suspend_token = ?,
                    mastra_run_id = ?,
                    updated_at = ?,
                    suspended_at = ?,
                    resumed_at = ?,
                    finished_at = ?,
                    error_message = ?,
                    state_json = ?
                WHERE workflow_run_id = ?
            `,
            args: [
                projection.status,
                projection.phase,
                projection.currentStepId,
                projection.state.executionCursor,
                projection.state.approvedPlanHash,
                projection.state.lastHeartbeatAt,
                projection.state.parentRunId,
                projection.state.replanOfVersion,
                projection.state.suspend.reason,
                projection.state.suspend.token,
                projection.mastraRunId,
                updatedAt,
                projection.suspendedAt,
                projection.resumedAt,
                projection.finishedAt,
                projection.errorMessage,
                serializeWorkflowState(projection.state),
                workflow.workflowRunId,
            ],
        });

        return await this.getWorkflow(input);
    }
}

export const createAgentPlanWorkflowStore = (
    options: { url?: string; now?: () => string } = {},
): IAgentPlanWorkflowStore => new LibsqlAgentPlanWorkflowStore(options);
