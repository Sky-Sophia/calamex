import type {
  Agent,
  FileStorage,
  JSONValue,
  LocalAgent,
  SessionManager,
} from '@strands-agents/sdk';

export type TCheckpointReason =
  | 'auto_message_interval'
  | 'before_risky_tool'
  | 'before_manual_rollback'
  | 'manual_user_request'
  | 'task_phase_boundary';

export type TToolRiskLevel = 'low' | 'medium' | 'high';

export type TSideEffectStatus =
  | 'planned'
  | 'executed'
  | 'failed'
  | 'compensated'
  | 'not_compensatable';

export interface IAcontextCheckpoint {
  snapshotId: string;
  sessionId: string;
  agentId: string;
  createdAt?: string;
  messageCount?: number;
  reason?: TCheckpointReason;
  toolName?: string;
}

export interface ISideEffectLedgerEntry {
  id: string;
  sessionId: string;
  agentId: string;
  toolName: string;
  checkpointId?: string;
  riskLevel: TToolRiskLevel;
  status: TSideEffectStatus;
  idempotencyKey?: string;
  undoAvailable: boolean;
  undoToolName?: string;
  createdAt: string;
  notes?: string;
}

export interface IToolRiskMetadata {
  toolName: string;
  riskLevel: TToolRiskLevel;
  hasExternalSideEffect: boolean;
  supportsDryRun: boolean;
  supportsUndo: boolean;
  undoToolName?: string;
}

export interface IRestoreResult {
  ok: boolean;
  sessionId: string;
  agentId: string;
  restoredLatest: boolean;
  snapshotId?: string;
  message?: string;
  error?: string;
  externalSideEffects?: ISideEffectLedgerEntry[];
}

export interface IAcontextSessionResources {
  storage: FileStorage;
  sessionManager: SessionManager;
}

export interface IAcontextAgentFactoryResult extends IAcontextSessionResources {
  agent: Agent;
}

export type TAcontextAgentFactory =
  () => IAcontextAgentFactoryResult | Promise<IAcontextAgentFactoryResult>;

export interface ICheckpointTarget {
  sessionManager: SessionManager;
  agent: LocalAgent;
  reason: TCheckpointReason;
}

export type TAcontextRollbackAppData = Record<string, JSONValue>;
