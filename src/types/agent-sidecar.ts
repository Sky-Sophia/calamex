import type { IAiContextReference } from '@/types/ai-context';

export const AGENT_SIDECAR_MODES = [
  'ask',
  'plan',
  'agent',
  'patch',
  'review',
] as const;

export type TAgentSidecarMode = (typeof AGENT_SIDECAR_MODES)[number];

export type TAgentSidecarMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type TJsonValue =
  | string
  | number
  | boolean
  | null
  | TJsonValue[]
  | { readonly [key: string]: TJsonValue };

export interface IAgentSidecarMessage {
  role: TAgentSidecarMessageRole;
  content: string;
}

export interface IAgentPlanStep {
  id: string;
  title: string;
  goal: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
  tools: string[];
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  expectedOutput: string;
}

export interface IAgentPlan {
  goal: string;
  steps: IAgentPlanStep[];
}

export interface IApprovalRequest {
  id: string;
  toolName: string;
  question: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  reversible: boolean;
  createdAt: string;
}

export interface IDiffFile {
  path: string;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
}

export type TAgentUiEvent =
  | { type: 'message_delta'; text: string }
  | { type: 'plan_ready'; plan: IAgentPlan }
  | { type: 'tool_start'; toolName: string; input: TJsonValue }
  | { type: 'tool_result'; toolName: string; output: TJsonValue }
  | { type: 'approval_required'; request: IApprovalRequest }
  | { type: 'diff_ready'; files: IDiffFile[] }
  | { type: 'done'; result: string }
  | { type: 'error'; message: string };

export interface IAgentSidecarBaseRequest {
  sessionId?: string;
  goal?: string;
  messages: IAgentSidecarMessage[];
  workspaceRootPath?: string | null;
  context: IAiContextReference[];
}

export interface IAgentSidecarChatRequest extends IAgentSidecarBaseRequest {
  mode?: TAgentSidecarMode;
}

export interface IAgentSidecarPlanRequest extends Omit<IAgentSidecarBaseRequest, 'goal'> {
  goal: string;
}

export interface IAgentSidecarExecuteRequest extends Omit<IAgentSidecarBaseRequest, 'goal'> {
  goal: string;
}

export interface IAgentSidecarApprovalResolveRequest {
  requestId: string;
  decision: string;
}

export interface IAgentSidecarHealthPayload {
  ok: boolean;
  status: string;
  engine: string;
  version: string | null;
  mcp: {
    configuredServers: number;
    serverNames: string[];
    errors: string[];
  };
}

export interface IAgentSidecarResponsePayload {
  sessionId: string;
  events: TAgentUiEvent[];
  result: string | null;
}
