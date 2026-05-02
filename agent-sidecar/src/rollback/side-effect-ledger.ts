import { randomUUID } from 'node:crypto';

import type {
  ISideEffectLedgerEntry,
  TSideEffectStatus,
  TToolRiskLevel,
} from './rollback-types.js';

export interface IRecordSideEffectLedgerEntryParams {
  sessionId: string;
  agentId: string;
  toolName: string;
  riskLevel: TToolRiskLevel;
  status: TSideEffectStatus;
  checkpointId?: string;
  idempotencyKey?: string;
  undoAvailable?: boolean;
  undoToolName?: string;
  notes?: string;
  createdAt?: string;
}

export interface IListSideEffectLedgerEntriesParams {
  sessionId: string;
  agentId: string;
}

export interface IListEntriesAfterCheckpointParams extends IListSideEffectLedgerEntriesParams {
  checkpointId?: string;
}

export interface ISideEffectLedger {
  record(params: IRecordSideEffectLedgerEntryParams): ISideEffectLedgerEntry;
  listBySession(params: IListSideEffectLedgerEntriesParams): ISideEffectLedgerEntry[];
  listEntriesAfterCheckpoint(params: IListEntriesAfterCheckpointParams): ISideEffectLedgerEntry[];
}

const isUncompensatedStatus = (status: TSideEffectStatus): boolean =>
  status !== 'compensated';

export class InMemorySideEffectLedger implements ISideEffectLedger {
  private readonly entries: ISideEffectLedgerEntry[] = [];

  record(params: IRecordSideEffectLedgerEntryParams): ISideEffectLedgerEntry {
    const entry: ISideEffectLedgerEntry = {
      id: randomUUID(),
      sessionId: params.sessionId,
      agentId: params.agentId,
      toolName: params.toolName,
      riskLevel: params.riskLevel,
      status: params.status,
      undoAvailable: params.undoAvailable ?? false,
      createdAt: params.createdAt ?? new Date().toISOString(),
    };

    if (params.checkpointId !== undefined) {
      entry.checkpointId = params.checkpointId;
    }

    if (params.idempotencyKey !== undefined) {
      entry.idempotencyKey = params.idempotencyKey;
    }

    if (params.undoToolName !== undefined) {
      entry.undoToolName = params.undoToolName;
    }

    if (params.notes !== undefined) {
      entry.notes = params.notes;
    }

    this.entries.push(entry);

    return entry;
  }

  listBySession(params: IListSideEffectLedgerEntriesParams): ISideEffectLedgerEntry[] {
    return this.entries.filter((entry) =>
      entry.sessionId === params.sessionId && entry.agentId === params.agentId);
  }

  listEntriesAfterCheckpoint(
    params: IListEntriesAfterCheckpointParams,
  ): ISideEffectLedgerEntry[] {
    return this.listBySession(params).filter((entry) => {
      if (!isUncompensatedStatus(entry.status)) {
        return false;
      }

      if (params.checkpointId === undefined) {
        return true;
      }

      return entry.checkpointId === undefined || entry.checkpointId === params.checkpointId;
    });
  }
}

export const createSideEffectWarningMessage = (
  entries: ISideEffectLedgerEntry[],
): string | null => {
  if (!entries.length) {
    return null;
  }

  return [
    '已恢复 Agent 内部状态，但 Strands snapshot 不会自动撤销外部工具副作用。',
    '以下副作用需要人工确认或通过业务 undo tool 单独补偿：',
    ...entries.map((entry) => [
      `- toolName: ${entry.toolName}`,
      `  status: ${entry.status}`,
      `  undoAvailable: ${entry.undoAvailable ? 'true' : 'false'}`,
    ].join('\n')),
  ].join('\n');
};
