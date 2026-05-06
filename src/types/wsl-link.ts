export type TWslLinkConnectionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'reconnecting'
  | 'resuming'
  | 'backoff'
  | 'closed';

export type TWslLinkTransportKind = 'vsockGrpc';

export type TWslLinkProbeStatus = 'ok' | 'warning' | 'error' | 'unknown' | 'unsupported';

export interface IWslLinkMetrics {
  activeTransport: TWslLinkTransportKind | null;
  rttMs: number | null;
  reconnectsTotal: number;
  inflightRequests: number;
  lastError: string | null;
}

export interface IWslLinkStatusPayload {
  state: TWslLinkConnectionState;
  maturity: 'yellow' | 'green' | 'red';
  protocolVersion: string;
  primaryTransport: TWslLinkTransportKind;
  vsockGrpcPort: number;
  supervisorRunning: boolean;
  sessionId: string | null;
  supervisorStartedAtUnixMs: number | null;
  lastHeartbeatAtUnixMs: number | null;
  nextRetryInMs: number | null;
  metrics: IWslLinkMetrics;
  note: string;
}

export interface IWslLinkProbeResult {
  key: string;
  label: string;
  status: TWslLinkProbeStatus;
  message: string;
  detail: string | null;
}

export interface IWslLinkEnvironmentReport {
  status: TWslLinkProbeStatus;
  checkedAtUnixMs: number;
  wslVersion: string | null;
  defaultDistro: string | null;
  mirroredNetworking: boolean | null;
  checks: IWslLinkProbeResult[];
}

export interface IWslLinkAgentArtifactPayload {
  found: boolean;
  path: string | null;
  candidates: string[];
  message: string;
}

export interface IInstallWslLinkAgentRequest {
  confirmInstall: true;
  distroName?: string;
}

export interface IStartWslLinkAgentRequest {
  confirmStart: true;
  distroName?: string;
}

export interface IStartWslLinkSupervisorRequest {
  confirmStart: true;
}

export interface IInstallWslLinkAgentPayload {
  binaryPath: string;
  noiseConfigPath: string;
  stepCount: number;
}

export interface IStartWslLinkAgentPayload {
  binaryPath: string;
  noiseConfigPath: string;
  pidPath: string;
  logPath: string;
  stdout: string;
}

export interface IProbeWslLinkPrimaryPayload {
  ok: boolean;
  message: string;
  sessionId: string | null;
  transport: TWslLinkTransportKind | null;
  serverSeq: number | null;
  ackClientSeq: number | null;
  rttMs: number | null;
}

export interface IWslLinkSupervisorControlPayload {
  running: boolean;
  message: string;
}
