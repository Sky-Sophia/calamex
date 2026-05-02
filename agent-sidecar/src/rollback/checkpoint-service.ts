import { isAbsolute, resolve } from 'node:path';

import {
  AfterToolCallEvent,
  BeforeToolCallEvent,
  FileStorage,
  SessionManager,
  type Agent,
  type LocalAgent,
} from '@strands-agents/sdk';

import { createSafeStrandsSessionId } from '../config/settings.js';
import type { AgentStreamEventBus } from '../streaming/stream-event-bus.js';
import {
  createAcontextSnapshotTrigger,
  isRiskyToolName,
} from './checkpoint-policy.js';
import { createRollbackConfig, type IRollbackConfig } from './rollback-config.js';
import type { ISideEffectLedger } from './side-effect-ledger.js';
import type {
  IAcontextSessionResources,
  ICheckpointTarget,
} from './rollback-types.js';

export interface ICreateAcontextSessionResourcesParams {
  sessionId: string;
  config?: Partial<IRollbackConfig>;
}

export interface IListAcontextCheckpointIdsParams {
  storage: FileStorage;
  sessionId: string;
  agentId: string;
  limit?: number;
  startAfter?: string;
}

export interface IRegisterRollbackCheckpointHooksParams {
  agent: Agent;
  sessionId: string;
  storage: FileStorage;
  sessionManager: SessionManager;
  config?: Partial<IRollbackConfig>;
  sideEffectLedger?: ISideEffectLedger;
  streamBus?: AgentStreamEventBus;
  now?: () => string;
}

const resolveSessionDir = (sessionDir: string): string =>
  isAbsolute(sessionDir) ? resolve(sessionDir) : resolve(process.cwd(), sessionDir);

export const createAcontextSessionResources = (
  params: ICreateAcontextSessionResourcesParams,
): IAcontextSessionResources => {
  const config = createRollbackConfig(params.config);
  const storage = new FileStorage(resolveSessionDir(config.sessionDir));
  const sessionManager = new SessionManager({
    sessionId: createSafeStrandsSessionId(params.sessionId),
    storage: {
      snapshot: storage,
    },
    saveLatestOn: 'invocation',
    snapshotTrigger: createAcontextSnapshotTrigger(config),
  });

  return {
    storage,
    sessionManager,
  };
};

export const createManualCheckpoint = async (
  params: ICheckpointTarget,
): Promise<void> => {
  await params.sessionManager.saveSnapshot({
    target: params.agent,
    isLatest: false,
  });
};

export const listAcontextCheckpointIds = async (
  params: IListAcontextCheckpointIdsParams,
): Promise<string[]> => {
  const options: Parameters<FileStorage['listSnapshotIds']>[0] = {
    location: {
      sessionId: createSafeStrandsSessionId(params.sessionId),
      scope: 'agent',
      scopeId: params.agentId,
    },
  };

  if (params.limit !== undefined) {
    options.limit = params.limit;
  }

  if (params.startAfter !== undefined) {
    options.startAfter = params.startAfter;
  }

  return params.storage.listSnapshotIds(options);
};

export const listAcontextCheckpointIdsForAgent = async (params: {
  storage: FileStorage;
  sessionId: string;
  agent: LocalAgent;
  limit?: number;
  startAfter?: string;
}): Promise<string[]> =>
  listAcontextCheckpointIds({
    storage: params.storage,
    sessionId: params.sessionId,
    agentId: params.agent.id,
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
    ...(params.startAfter !== undefined ? { startAfter: params.startAfter } : {}),
  });

const findNewSnapshotId = (
  beforeIds: readonly string[],
  afterIds: readonly string[],
): string | null => {
  const before = new Set(beforeIds);
  const newIds = afterIds.filter((id) => !before.has(id));

  return newIds.at(-1) ?? null;
};

const createCheckpointAndResolveId = async (params: {
  storage: FileStorage;
  sessionId: string;
  agent: LocalAgent;
  sessionManager: SessionManager;
}): Promise<string | null> => {
  const beforeIds = await listAcontextCheckpointIdsForAgent({
    storage: params.storage,
    sessionId: params.sessionId,
    agent: params.agent,
  });

  await params.sessionManager.saveSnapshot({
    target: params.agent,
    isLatest: false,
  });

  const afterIds = await listAcontextCheckpointIdsForAgent({
    storage: params.storage,
    sessionId: params.sessionId,
    agent: params.agent,
  });

  return findNewSnapshotId(beforeIds, afterIds);
};

export const registerRollbackCheckpointHooks = (
  params: IRegisterRollbackCheckpointHooksParams,
): (() => void) => {
  const config = createRollbackConfig(params.config);
  const checkpointIdsByToolUseId = new Map<string, string | null>();
  const now = params.now ?? (() => new Date().toISOString());
  const beforeCleanup = params.agent.addHook(BeforeToolCallEvent, async (event) => {
    if (
      !config.enabled ||
      !config.checkpointBeforeRiskyTool ||
      !isRiskyToolName(event.toolUse.name, config.riskyToolNames)
    ) {
      return;
    }

    let checkpointId: string | null;

    try {
      checkpointId = await createCheckpointAndResolveId({
        storage: params.storage,
        sessionId: params.sessionId,
        agent: event.agent,
        sessionManager: params.sessionManager,
      });
      params.streamBus?.emitDraft({
        type: 'rollback.checkpoint.created',
        visibility: 'debug',
        level: 'info',
        reason: 'before_risky_tool',
        ...(checkpointId ? { snapshotId: checkpointId } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.streamBus?.emitDraft({
        type: 'rollback.checkpoint.failed',
        visibility: 'debug',
        level: 'error',
        reason: 'before_risky_tool',
        errorMessage: message,
      });
      throw error;
    }

    checkpointIdsByToolUseId.set(event.toolUse.toolUseId, checkpointId);

    params.sideEffectLedger?.record({
      sessionId: params.sessionId,
      agentId: event.agent.id,
      toolName: event.toolUse.name,
      riskLevel: 'high',
      status: 'planned',
      undoAvailable: false,
      createdAt: now(),
      ...(checkpointId ? { checkpointId } : {}),
      notes: '高风险工具执行前已创建 Agent 内部状态 checkpoint；外部副作用不会自动回滚。',
    });
    params.streamBus?.emitDraft({
      type: 'side_effect.recorded',
      visibility: 'debug',
      level: 'warn',
      toolName: event.toolUse.name,
      riskLevel: 'high',
      undoAvailable: false,
      message: '高风险工具即将执行，已记录外部副作用风险；Agent checkpoint 不会自动撤销真实副作用。',
    });
  });
  const afterCleanup = params.agent.addHook(AfterToolCallEvent, (event) => {
    if (
      !config.enabled ||
      !config.checkpointBeforeRiskyTool ||
      !isRiskyToolName(event.toolUse.name, config.riskyToolNames)
    ) {
      return;
    }

    const checkpointId = checkpointIdsByToolUseId.get(event.toolUse.toolUseId) ?? null;
    const status = event.error || event.result.status === 'error' ? 'failed' : 'executed';

    params.sideEffectLedger?.record({
      sessionId: params.sessionId,
      agentId: event.agent.id,
      toolName: event.toolUse.name,
      riskLevel: 'high',
      status,
      undoAvailable: false,
      createdAt: now(),
      ...(checkpointId ? { checkpointId } : {}),
      notes: '工具执行状态已记录；如产生外部副作用，需由业务层人工确认或补偿。',
    });
    params.streamBus?.emitDraft({
      type: 'side_effect.warning',
      visibility: 'user',
      level: status === 'failed' ? 'error' : 'warn',
      toolName: event.toolUse.name,
      riskLevel: 'high',
      undoAvailable: false,
      message: '工具可能已经产生外部副作用；回滚 Agent snapshot 不会自动撤销真实文件、命令或远端 API 影响。',
    });
    checkpointIdsByToolUseId.delete(event.toolUse.toolUseId);
  });

  return () => {
    beforeCleanup();
    afterCleanup();
  };
};
