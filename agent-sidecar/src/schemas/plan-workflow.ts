import { z } from 'zod';

import { agentPlanStepSchema } from './plan.js';
import type { JSONValue } from '../types/json-value.js';

const jsonValueSchema: z.ZodType<JSONValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const agentPlanWorkflowStatusSchema = z.enum([
  'waiting_approval',
  'approved',
  'executing',
  'completed',
  'failed',
  'rejected',
  'cancelled',
]);

export const agentPlanWorkflowPhaseSchema = z.enum([
  'approval_gate',
  'execute_plan',
  'validate_result',
  'replan',
  'finish',
]);

export const agentPlanWorkflowSuspendReasonSchema = z.enum([
  'plan_approval',
  'validator_needs_replan',
  'ask_user',
  'tool_external_wait',
]);

export const agentPlanWorkflowStateSchema = z.object({
  planId: z.string().min(1),
  planVersion: z.number().int().positive(),
  threadId: z.string().min(1),
  stepIds: z.array(z.string().min(1)),
  stepIdempotencyKeys: z.record(z.string().min(1), z.string().min(1)),
  executionCursor: z.number().int().nonnegative(),
  approvedPlanHash: z.string().min(1),
  currentStepId: z.string().min(1).nullable(),
  completedStepIds: z.array(z.string().min(1)),
  failedStepIds: z.array(z.string().min(1)),
  lastHeartbeatAt: z.string().min(1).nullable(),
  parentRunId: z.string().min(1).nullable(),
  replanOfVersion: z.number().int().positive().nullable(),
  suspend: z.object({
    reason: agentPlanWorkflowSuspendReasonSchema.nullable(),
    token: z.string().min(1).nullable(),
    payload: jsonValueSchema.nullable(),
    expiresAt: z.string().min(1).nullable(),
    resumeContract: z.object({
      allowedFields: z.array(z.string().min(1)),
    }).nullable(),
  }),
  approval: z.object({
    required: z.boolean(),
    approved: z.boolean(),
    rejected: z.boolean(),
    reason: z.string().min(1).nullable(),
  }),
  validator: z.object({
    status: z.enum(['pending', 'running', 'passed', 'failed', 'needs_replan', 'skipped']),
    summary: z.string().min(1).nullable(),
    needsReplan: z.boolean(),
  }),
});

export const agentPlanWorkflowRecordSchema = z.object({
  workflowRunId: z.string().min(1),
  planId: z.string().min(1),
  planVersion: z.number().int().positive(),
  threadId: z.string().min(1),
  status: agentPlanWorkflowStatusSchema,
  phase: agentPlanWorkflowPhaseSchema,
  currentStepId: z.string().min(1).nullable(),
  mastraRunId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  suspendedAt: z.string().min(1).nullable(),
  resumedAt: z.string().min(1).nullable(),
  finishedAt: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
  state: agentPlanWorkflowStateSchema,
});

export const agentPlanValidationReportSchema = z.object({
  status: z.enum(['passed', 'failed', 'needs_replan']),
  summary: z.string().min(1),
  checkedStepIds: z.array(z.string().min(1)),
  needsReplan: z.boolean(),
  findings: z.array(z.object({
    stepId: z.string().min(1).nullable(),
    severity: z.enum(['low', 'medium', 'high']),
    title: z.string().min(1),
    detail: z.string().min(1),
    retryable: z.boolean(),
  })),
  acceptance: z.array(z.object({
    criterion: z.string().min(1),
    passed: z.boolean(),
    detail: z.string().min(1),
  })),
});

export const agentPlanStepPatchSchema = z.object({
  title: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  files: z.array(z.string().min(1)).optional(),
  commands: z.array(z.string().min(1)).optional(),
  risks: z.array(z.string().min(1)).optional(),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  requiresApproval: z.boolean().optional(),
  expectedOutput: z.string().min(1).optional(),
});

export const agentPlanDeltaSchema = z.object({
  summary: z.string().min(1),
  added: z.array(agentPlanStepSchema),
  modified: z.array(z.object({
    id: z.string().min(1),
    patch: agentPlanStepPatchSchema,
  })),
  removed: z.array(z.string().min(1)),
});

export const agentPlanWorkflowEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PlanGenerated'),
    planId: z.string().min(1),
    version: z.number().int().positive(),
    threadId: z.string().min(1),
    planHash: z.string().min(1),
    stepIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('PlanApproved'),
    version: z.number().int().positive(),
    approvedHash: z.string().min(1),
    approvedBy: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal('StepStarted'),
    stepId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    mastraRunId: z.string().min(1).nullable(),
    toolCall: jsonValueSchema.nullable(),
  }),
  z.object({
    type: z.literal('StepCompleted'),
    stepId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    resultRef: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal('StepFailed'),
    stepId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    error: z.string().min(1),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal('ValidatorReported'),
    report: agentPlanValidationReportSchema,
  }),
  z.object({
    type: z.literal('ReplanIssued'),
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    deltaRef: z.string().min(1).nullable(),
    delta: agentPlanDeltaSchema,
  }),
  z.object({
    type: z.literal('Suspended'),
    reason: agentPlanWorkflowSuspendReasonSchema,
    token: z.string().min(1),
    payload: jsonValueSchema.nullable(),
    expiresAt: z.string().min(1).nullable(),
    resumeContract: z.object({
      allowedFields: z.array(z.string().min(1)),
    }),
  }),
  z.object({
    type: z.literal('Resumed'),
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal('Heartbeat'),
    stepId: z.string().min(1).nullable(),
    phase: z.enum(['before_tool', 'after_tool', 'step_start', 'step_end']),
  }),
  z.object({
    type: z.literal('PlanFinished'),
    status: z.enum(['completed', 'failed', 'rejected', 'cancelled']),
    errorMessage: z.string().min(1).nullable(),
  }),
]);

export const agentPlanWorkflowEventRecordSchema = z.object({
  eventId: z.string().min(1),
  workflowRunId: z.string().min(1),
  planId: z.string().min(1),
  planVersion: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  event: agentPlanWorkflowEventSchema,
});

export const agentPlanWorkflowRecordWithEventsSchema = agentPlanWorkflowRecordSchema.extend({
  events: z.array(agentPlanWorkflowEventRecordSchema),
});

export type TAgentPlanWorkflowStatus = z.infer<typeof agentPlanWorkflowStatusSchema>;
export type TAgentPlanWorkflowPhase = z.infer<typeof agentPlanWorkflowPhaseSchema>;
export type TAgentPlanWorkflowSuspendReason = z.infer<typeof agentPlanWorkflowSuspendReasonSchema>;
export type TAgentPlanValidationReport = z.infer<typeof agentPlanValidationReportSchema>;
export type TAgentPlanStepPatch = z.infer<typeof agentPlanStepPatchSchema>;
export type TAgentPlanDelta = z.infer<typeof agentPlanDeltaSchema>;
export type TAgentPlanWorkflowState = z.infer<typeof agentPlanWorkflowStateSchema>;
export type TAgentPlanWorkflowRecord = z.infer<typeof agentPlanWorkflowRecordSchema>;
export type TAgentPlanWorkflowEvent = z.infer<typeof agentPlanWorkflowEventSchema>;
export type TAgentPlanWorkflowEventRecord = z.infer<typeof agentPlanWorkflowEventRecordSchema>;
export type TAgentPlanWorkflowRecordWithEvents = z.infer<typeof agentPlanWorkflowRecordWithEventsSchema>;
