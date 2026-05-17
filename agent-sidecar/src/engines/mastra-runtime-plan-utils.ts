import { agentPlanDeltaSchema, agentPlanValidationReportSchema, type TAgentPlanDelta, type TAgentPlanStepPatch, type TAgentPlanValidationReport } from '../schemas/plan-workflow.js';
import { agentPlanGenerationSchema, agentPlanSchema, agentPlanStepSchema, type TAgentPlan, type TAgentPlanStep } from '../schemas/plan.js';
import { toNonEmptyString, toRecord } from './mastra-runtime-utils.js';

export const PLAN_WRAPPER_KEYS = ['plan', 'result', 'data'] as const;
export const unwrapGeneratedPlanCandidate = (value: unknown): unknown => {
    const record = toRecord(value);

    if (!record) {
        return value;
    }

    for (const key of PLAN_WRAPPER_KEYS) {
        if (toRecord(record[key])) {
            return record[key];
        }
    }

    return value;
};

export const toStringArray = (value: unknown): string[] | undefined => {
    if (value === null || value === undefined) {
        return undefined;
    }

    const singleValue = toNonEmptyString(value);
    if (singleValue) {
        return [singleValue];
    }

    if (!Array.isArray(value)) {
        return undefined;
    }

    const values = value
        .map((item) => toNonEmptyString(item))
        .filter((item): item is string => Boolean(item));

    return values.length > 0 ? values : undefined;
};

export const toBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') {
        return value;
    }

    const text = toNonEmptyString(value)?.toLowerCase();

    if (text === 'true' || text === 'yes' || text === '是') {
        return true;
    }

    if (text === 'false' || text === 'no' || text === '否') {
        return false;
    }

    return undefined;
};

export const normalizePlanStepStatus = (value: unknown): TAgentPlanStep['status'] => {
    const status = toNonEmptyString(value);
    switch (status) {
        case 'running':
        case 'done':
        case 'failed':
        case 'skipped':
        case 'cancelled':
            return status;
        default:
            return 'pending';
    }
};

export const normalizePlanStepRiskLevel = (value: unknown): TAgentPlanStep['riskLevel'] => {
    const riskLevel = toNonEmptyString(value);
    switch (riskLevel) {
        case 'low':
        case 'high':
            return riskLevel;
        default:
            return 'medium';
    }
};

export const normalizeGeneratedAgentPlanStep = (
    value: unknown,
    index: number,
): Record<string, unknown> | null => {
    const record = toRecord(value);

    if (!record) {
        return null;
    }

    const title = toNonEmptyString(record.title)
        ?? toNonEmptyString(record.goal)
        ?? toNonEmptyString(record.description)
        ?? `步骤 ${index + 1}`;
    const goal = toNonEmptyString(record.goal)
        ?? toNonEmptyString(record.description)
        ?? title;
    const riskLevel = normalizePlanStepRiskLevel(record.riskLevel);
    const tools = toStringArray(record.tools) ?? [];
    const files = toStringArray(record.files);
    const commands = toStringArray(record.commands);
    const risks = toStringArray(record.risks);
    const acceptanceCriteria = toStringArray(record.acceptanceCriteria);
    const expectedOutput = toNonEmptyString(record.expectedOutput)
        ?? acceptanceCriteria?.join('\n')
        ?? goal;

    return {
        ...record,
        id: toNonEmptyString(record.id) ?? `step-${index + 1}`,
        title,
        goal,
        status: normalizePlanStepStatus(record.status),
        tools,
        ...(files ? { files } : {}),
        ...(commands ? { commands } : {}),
        ...(risks ? { risks } : {}),
        ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
        riskLevel,
        requiresApproval: toBoolean(record.requiresApproval) ?? (
            riskLevel !== 'low'
        ),
        expectedOutput,
    };
};

export const normalizeGeneratedAgentPlan = (
    value: unknown,
    fallbackGoal: string,
): TAgentPlan | null => {
    const generationResult = agentPlanGenerationSchema.safeParse(value);

    if (!generationResult.success) {
        return null;
    }

    const candidateRecord = toRecord(unwrapGeneratedPlanCandidate(generationResult.data));

    if (!candidateRecord) {
        return null;
    }

    const steps = Array.isArray(candidateRecord.steps)
        ? candidateRecord.steps
            .map((step, index) => normalizeGeneratedAgentPlanStep(step, index))
            .filter((step): step is Record<string, unknown> => Boolean(step))
        : undefined;

    const parsedPlan = agentPlanSchema.safeParse({
        ...candidateRecord,
        goal: toNonEmptyString(candidateRecord.goal) ?? fallbackGoal,
        requiresApproval: toBoolean(candidateRecord.requiresApproval) ?? true,
        ...(steps ? { steps } : {}),
    });

    return parsedPlan.success ? parsedPlan.data : null;
};
export const parseValidationReport = (value: unknown): TAgentPlanValidationReport | null => {
    const parsedReport = agentPlanValidationReportSchema.safeParse(value);
    return parsedReport.success ? parsedReport.data : null;
};

export const parsePlanDelta = (value: unknown): TAgentPlanDelta | null => {
    const parsedDelta = agentPlanDeltaSchema.safeParse(value);
    return parsedDelta.success ? parsedDelta.data : null;
};

export const applyStepPatch = (
    step: TAgentPlanStep,
    patch: TAgentPlanStepPatch,
): TAgentPlanStep => {
    const definedPatch: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
            definedPatch[key] = value;
        }
    }

    return agentPlanStepSchema.parse({
        ...step,
        ...definedPatch,
        status: 'pending',
    });
};

export const applyAgentPlanDelta = (
    plan: TAgentPlan,
    delta: TAgentPlanDelta,
): TAgentPlan | null => {
    const removedIds = new Set(delta.removed);
    const modifiedById = new Map(delta.modified.map((item) => [item.id, item.patch]));
    const addedIds = new Set(delta.added.map((step) => step.id));
    const steps = [
        ...plan.steps
            .filter((step) => !removedIds.has(step.id))
            .map((step) => {
                const patch = modifiedById.get(step.id);
                return patch ? applyStepPatch(step, patch) : step;
            })
            .filter((step) => !addedIds.has(step.id)),
        ...delta.added,
    ];
    const parsedPlan = agentPlanSchema.safeParse({
        ...plan,
        summary: delta.summary,
        steps,
        requiresApproval: true,
    });

    return parsedPlan.success ? parsedPlan.data : null;
};
