import type { SessionManager } from '@strands-agents/sdk';

import type { AgentStreamEventBus } from '../streaming/stream-event-bus.js';
import { createSideEffectWarningMessage, type ISideEffectLedger } from './side-effect-ledger.js';
import type {
  IRestoreResult,
  TAcontextAgentFactory,
} from './rollback-types.js';

export interface IRestoreAcontextCheckpointParams {
  createAgent: TAcontextAgentFactory;
  sessionId: string;
  agentId: string;
  snapshotId: string;
  sideEffectLedger?: ISideEffectLedger;
  streamBus?: AgentStreamEventBus;
}

export interface IRestoreLatestAcontextSessionParams {
  createAgent: TAcontextAgentFactory;
  sessionId: string;
  agentId: string;
}

export interface IDeleteAcontextSessionParams {
  sessionManager: SessionManager;
  allowDeleteSession: boolean;
}

export const restoreAcontextCheckpoint = async (
  params: IRestoreAcontextCheckpointParams,
): Promise<IRestoreResult> => {
  const { agent, sessionManager } = await params.createAgent();

  params.streamBus?.emitDraft({
    type: 'rollback.restore.started',
    visibility: 'debug',
    level: 'info',
    snapshotId: params.snapshotId,
  });

  await agent.initialize();

  const restored = await sessionManager.restoreSnapshot({
    target: agent,
    snapshotId: params.snapshotId,
  });

  if (!restored) {
    params.streamBus?.emitDraft({
      type: 'rollback.restore.failed',
      visibility: 'debug',
      level: 'error',
      snapshotId: params.snapshotId,
      errorMessage: 'Snapshot not found or restore failed.',
    });
    return {
      ok: false,
      sessionId: params.sessionId,
      agentId: params.agentId,
      snapshotId: params.snapshotId,
      restoredLatest: false,
      error: 'Snapshot not found or restore failed.',
    };
  }

  await sessionManager.saveSnapshot({
    target: agent,
    isLatest: true,
  });

  const externalSideEffects = params.sideEffectLedger?.listEntriesAfterCheckpoint({
    sessionId: params.sessionId,
    agentId: params.agentId,
    checkpointId: params.snapshotId,
  }) ?? [];
  const warning = createSideEffectWarningMessage(externalSideEffects);
  const message = warning ?? 'Agent internal state restored from checkpoint and saved as latest.';

  params.streamBus?.emitDraft({
    type: 'rollback.restore.completed',
    visibility: 'user',
    level: warning ? 'warn' : 'info',
    snapshotId: params.snapshotId,
    savedAsLatest: true,
    message,
  });

  return {
    ok: true,
    sessionId: params.sessionId,
    agentId: params.agentId,
    snapshotId: params.snapshotId,
    restoredLatest: false,
    message,
    ...(externalSideEffects.length > 0 ? { externalSideEffects } : {}),
  };
};

export const restoreLatestAcontextSession = async (
  params: IRestoreLatestAcontextSessionParams,
): Promise<IRestoreResult> => {
  const { agent, sessionManager } = await params.createAgent();

  await agent.initialize();

  const restored = await sessionManager.restoreSnapshot({
    target: agent,
  });

  if (!restored) {
    return {
      ok: false,
      sessionId: params.sessionId,
      agentId: params.agentId,
      restoredLatest: true,
      error: 'Latest snapshot does not exist.',
    };
  }

  return {
    ok: true,
    sessionId: params.sessionId,
    agentId: params.agentId,
    restoredLatest: true,
    message: 'Agent restored from latest snapshot.',
  };
};

export const deleteAcontextSession = async (
  params: IDeleteAcontextSessionParams,
): Promise<void> => {
  if (!params.allowDeleteSession) {
    throw new Error('Session deletion is disabled by rollback config.');
  }

  await params.sessionManager.deleteSession();
};
