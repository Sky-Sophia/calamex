import { z } from 'zod';

import {
  AGENT_RUNTIME_EVENT_SCHEMA_VERSION,
  AGENT_RUNTIME_EVENT_TYPES,
  AGENT_SIDECAR_MODES,
  type TJsonValue,
} from '@/types/agent-sidecar';
import { aiContextReferenceSchema } from '@/types/ai-context.schema';

export const jsonValueSchema: z.ZodType<TJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const agentSidecarModeSchema = z.enum(AGENT_SIDECAR_MODES);

const optionalNonEmptyStringSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional()).optional();

const requiredNonEmptyStringSchema = z.string().trim().min(1);

const optionalAgentModeSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, agentSidecarModeSchema.optional()).optional();

const optionalWorkspaceRootPathSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).nullable().optional()).optional();

export const agentSidecarMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
});

export const agentPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped', 'cancelled']),
  tools: z.array(z.string().min(1)),
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  expectedOutput: z.string().min(1),
});

export const agentPlanSchema = z.object({
  goal: z.string().min(1),
  steps: z.array(agentPlanStepSchema).min(1),
});

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  question: z.string().min(1),
  summary: z.string().min(1),
  riskLevel: z.enum(['low', 'medium', 'high']),
  reversible: z.boolean(),
  createdAt: z.string().min(1),
});

export const diffFileSchema = z.object({
  path: z.string().min(1),
  hunks: z.array(z.object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    lines: z.array(z.string()),
  })),
});

export const agentRuntimeEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(AGENT_RUNTIME_EVENT_TYPES),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  timestamp: z.string().min(1),
  seq: z.number().int().nonnegative(),
  schemaVersion: z.literal(AGENT_RUNTIME_EVENT_SCHEMA_VERSION),
  redacted: z.literal(true),
  visibility: z.enum(['user', 'debug']),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  parentId: z.string().min(1).optional(),
  spanId: z.string().min(1).optional(),
}).passthrough();

export const agentUiEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_delta'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('agent_event'),
    event: agentRuntimeEventSchema,
  }),
  z.object({
    type: z.literal('plan_ready'),
    plan: agentPlanSchema,
  }),
  z.object({
    type: z.literal('tool_start'),
    toolName: z.string().min(1),
    input: jsonValueSchema,
  }),
  z.object({
    type: z.literal('tool_result'),
    toolName: z.string().min(1),
    output: jsonValueSchema,
  }),
  z.object({
    type: z.literal('approval_required'),
    request: approvalRequestSchema,
  }),
  z.object({
    type: z.literal('diff_ready'),
    files: z.array(diffFileSchema),
  }),
  z.object({
    type: z.literal('done'),
    result: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().min(1),
  }),
]);

export const agentSidecarHealthPayloadSchema = z.object({
  ok: z.boolean(),
  status: z.string().min(1),
  engine: z.string().min(1),
  version: z.string().min(1).nullable(),
  protocolVersion: z.string().min(1).nullable().optional(),
  mcp: z.object({
    configuredServers: z.number().int().nonnegative(),
    serverNames: z.array(z.string()),
    errors: z.array(z.string()),
  }),
});

const agentSidecarBaseRequestSchema = z.object({
  sessionId: optionalNonEmptyStringSchema,
  goal: optionalNonEmptyStringSchema,
  messages: z.array(agentSidecarMessageSchema),
  workspaceRootPath: optionalWorkspaceRootPathSchema,
  context: z.array(aiContextReferenceSchema).default([]),
});

export const agentSidecarChatRequestSchema = agentSidecarBaseRequestSchema.extend({
  mode: optionalAgentModeSchema,
});

export const agentSidecarPlanRequestSchema = agentSidecarBaseRequestSchema.extend({
  goal: requiredNonEmptyStringSchema,
});

export const agentSidecarExecuteRequestSchema = agentSidecarBaseRequestSchema.extend({
  goal: requiredNonEmptyStringSchema,
});

export const agentSidecarApprovalResolveRequestSchema = z.object({
  sessionId: optionalNonEmptyStringSchema,
  requestId: z.string().min(1),
  decision: z.string().min(1),
});

export const agentSidecarResponsePayloadSchema = z.object({
  sessionId: z.string().min(1),
  events: z.array(agentUiEventSchema),
  result: z.string().nullable(),
});

export const agentSidecarStreamEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  event: agentUiEventSchema,
});
