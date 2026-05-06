import { z } from 'zod';

export const wslLinkConnectionStateSchema = z.enum([
  'idle',
  'connecting',
  'ready',
  'degraded',
  'reconnecting',
  'resuming',
  'backoff',
  'closed',
]);

export const wslLinkTransportKindSchema = z.enum(['vsockGrpc']);

export const wslLinkProbeStatusSchema = z.enum([
  'ok',
  'warning',
  'error',
  'unknown',
  'unsupported',
]);

export const wslLinkMetricsSchema = z.object({
  activeTransport: wslLinkTransportKindSchema.nullable(),
  rttMs: z.number().int().nonnegative().nullable(),
  reconnectsTotal: z.number().int().nonnegative(),
  inflightRequests: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export const wslLinkStatusPayloadSchema = z.object({
  state: wslLinkConnectionStateSchema,
  maturity: z.enum(['yellow', 'green', 'red']),
  protocolVersion: z.string().min(1),
  primaryTransport: wslLinkTransportKindSchema,
  vsockGrpcPort: z.number().int().min(1).max(65535),
  supervisorRunning: z.boolean(),
  sessionId: z.string().min(1).nullable(),
  supervisorStartedAtUnixMs: z.number().int().nonnegative().nullable(),
  lastHeartbeatAtUnixMs: z.number().int().nonnegative().nullable(),
  nextRetryInMs: z.number().int().nonnegative().nullable(),
  metrics: wslLinkMetricsSchema,
  note: z.string(),
});

export const wslLinkProbeResultSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  status: wslLinkProbeStatusSchema,
  message: z.string(),
  detail: z.string().nullable(),
});

export const wslLinkEnvironmentReportSchema = z.object({
  status: wslLinkProbeStatusSchema,
  checkedAtUnixMs: z.number().int().nonnegative(),
  wslVersion: z.string().nullable(),
  defaultDistro: z.string().nullable(),
  mirroredNetworking: z.boolean().nullable(),
  checks: z.array(wslLinkProbeResultSchema),
});

export const wslLinkAgentArtifactPayloadSchema = z.object({
  found: z.boolean(),
  path: z.string().min(1).nullable(),
  candidates: z.array(z.string().min(1)),
  message: z.string(),
});

export const installWslLinkAgentRequestSchema = z.object({
  confirmInstall: z.literal(true),
  distroName: z.string().min(1).optional(),
});

export const startWslLinkAgentRequestSchema = z.object({
  confirmStart: z.literal(true),
  distroName: z.string().min(1).optional(),
});

export const startWslLinkSupervisorRequestSchema = z.object({
  confirmStart: z.literal(true),
});

export const installWslLinkAgentPayloadSchema = z.object({
  binaryPath: z.string().min(1),
  noiseConfigPath: z.string().min(1),
  stepCount: z.number().int().positive(),
});

export const startWslLinkAgentPayloadSchema = z.object({
  binaryPath: z.string().min(1),
  noiseConfigPath: z.string().min(1),
  pidPath: z.string().min(1),
  logPath: z.string().min(1),
  stdout: z.string(),
});

export const probeWslLinkPrimaryPayloadSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  sessionId: z.string().min(1).nullable(),
  transport: wslLinkTransportKindSchema.nullable(),
  serverSeq: z.number().int().nonnegative().nullable(),
  ackClientSeq: z.number().int().nonnegative().nullable(),
  rttMs: z.number().int().nonnegative().nullable(),
});

export const wslLinkSupervisorControlPayloadSchema = z.object({
  running: z.boolean(),
  message: z.string().min(1),
});
