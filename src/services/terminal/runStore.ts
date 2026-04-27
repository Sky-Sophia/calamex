import type {
  ITerminalRunCompletedPayload,
  ITerminalRunHandle,
  ITerminalRunChunkPayload,
} from '@/types/terminal';

interface ITerminalRunChunk {
  seq: number | null;
  arrivalIndex: number;
  data: string;
}

export interface ITerminalRunRecord {
  runId: string;
  sessionId: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  output: string;
  chunkCount: number;
}

export class TerminalRunStore {
  private readonly records = new Map<string, {
    runId: string;
    sessionId: string;
    startedAt: string | null;
    completedAt: string | null;
    exitCode: number | null;
    chunks: ITerminalRunChunk[];
  }>();

  private nextArrivalIndex = 0;

  startRun(handle: ITerminalRunHandle): void {
    const existing = this.records.get(handle.runId);
    if (existing) {
      existing.sessionId = handle.sessionId;
      existing.startedAt = handle.startedAt;
      return;
    }

    this.records.set(handle.runId, {
      runId: handle.runId,
      sessionId: handle.sessionId,
      startedAt: handle.startedAt,
      completedAt: null,
      exitCode: null,
      chunks: [],
    });
  }

  appendChunk(payload: ITerminalRunChunkPayload): void {
    const record = this.getOrCreateRecord(payload.runId, payload.sessionId);
    record.chunks.push({
      seq: typeof payload.seq === 'number' ? payload.seq : null,
      arrivalIndex: this.nextArrivalIndex,
      data: payload.data,
    });
    this.nextArrivalIndex += 1;
  }

  completeRun(payload: ITerminalRunCompletedPayload): void {
    const record = this.getOrCreateRecord(payload.runId, payload.sessionId);
    record.completedAt = payload.finishedAt;
    record.exitCode = payload.exitCode;
  }

  getOutput(runId: string): string {
    const record = this.records.get(runId);
    if (!record) {
      return '';
    }

    return this.resolveChunks(record.chunks).map((chunk) => chunk.data).join('');
  }

  getRecord(runId: string): ITerminalRunRecord | null {
    const record = this.records.get(runId);
    if (!record) {
      return null;
    }

    return {
      runId: record.runId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      exitCode: record.exitCode,
      output: this.getOutput(runId),
      chunkCount: record.chunks.length,
    };
  }

  clear(): void {
    this.records.clear();
    this.nextArrivalIndex = 0;
  }

  private getOrCreateRecord(runId: string, sessionId: string) {
    const existing = this.records.get(runId);
    if (existing) {
      return existing;
    }

    const record = {
      runId,
      sessionId,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      chunks: [],
    };
    this.records.set(runId, record);
    return record;
  }

  private resolveChunks(chunks: ITerminalRunChunk[]): ITerminalRunChunk[] {
    const allChunksHaveSequence = chunks.every((chunk) => chunk.seq !== null);
    if (!allChunksHaveSequence) {
      return [...chunks].sort((a, b) => a.arrivalIndex - b.arrivalIndex);
    }

    return [...chunks].sort((a, b) => {
      const leftSeq = a.seq ?? 0;
      const rightSeq = b.seq ?? 0;
      if (leftSeq !== rightSeq) {
        return leftSeq - rightSeq;
      }
      return a.arrivalIndex - b.arrivalIndex;
    });
  }
}

export const createTerminalRunStore = (): TerminalRunStore => new TerminalRunStore();
