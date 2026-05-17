import type {
  ITerminalRunChunkPayload,
  ITerminalRunCompletedPayload,
  ITerminalRunHandle,
} from '@/types/terminal';

/**
 * 单个 chunk 的存储形态。
 *
 * - `seq`:后端给的序号(可选)。`null` 表示该 chunk 不带序号,只能靠
 *   `arrivalIndex` 排序。
 * - `arrivalIndex`:**跨所有 run 共享**的全局到达序号。语义上略不洁,但同
 *   run 内仍然单调递增,排序正确性不受影响。`clear()` 会重置。
 */
interface ITerminalRunChunk {
  seq: number | null;
  arrivalIndex: number;
  data: string;
}

interface ITerminalRunRecordInternal {
  runId: string;
  sessionId: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  chunks: ITerminalRunChunk[];
  /**
   * R1 修复:输出缓存。`null` 表示需要重算。`appendChunk` 失效,
   * `getOutput` 命中即返回。
   */
  cachedOutput: string | null;
  /**
   * R1 修复:已经按 seq 单调递增到达(常见 case),`getOutput` 可走 fast
   * path 跳过 spread+sort。任何"乱序到达"或"出现 null seq"会把它置 false,
   * 之后只能走完整排序路径。
   */
  chunksAreSorted: boolean;
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

/** 不含 `output` 字段的轻量元数据,用于只关心 completedAt/exitCode 等的消费者。 */
export interface ITerminalRunMetadata {
  runId: string;
  sessionId: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  chunkCount: number;
}

export interface IStartRunOptions {
  /**
   * 重置已有 record 的 `completedAt` / `exitCode` / `chunks`。默认 false。
   *
   * 默认 false 的原因:facade 协议允许 "run-chunk 先于 run-started 事件
   * 到达",此时 `getOrCreateRecord` 已经创建了带 chunks 的占位 record,
   * 后续 `startRun` 只应**补充** sessionId/startedAt,**保留** chunks。
   *
   * 仅当上层明确要 retry 复用 runId 时才传 `reset: true`。
   */
  reset?: boolean;
}

export class TerminalRunStore {
  private readonly records = new Map<string, ITerminalRunRecordInternal>();
  private nextArrivalIndex = 0;

  /**
   * 启动一个 run。
   *
   * - 若该 runId **不存在 record**:创建新 record。
   * - 若该 runId **已存在 record**(通常是 chunk 先于 run-started 到达,
   *   `getOrCreateRecord` 已经建过占位):**仅补充** sessionId 与 startedAt,
   *   **保留** chunks/completedAt/exitCode。这是与 facade 同步协议的关键
   *   行为,不要"修复"成重置。
   * - 显式 retry 复用 runId 请传 `options.reset = true`。
   */
  startRun(handle: ITerminalRunHandle, options: IStartRunOptions = {}): void {
    const existing = this.records.get(handle.runId);
    if (existing) {
      existing.sessionId = handle.sessionId;
      existing.startedAt = handle.startedAt;
      if (options.reset === true) {
        existing.completedAt = null;
        existing.exitCode = null;
        existing.chunks = [];
        existing.cachedOutput = '';
        existing.chunksAreSorted = true;
      }
      return;
    }
    this.records.set(handle.runId, {
      runId: handle.runId,
      sessionId: handle.sessionId,
      startedAt: handle.startedAt,
      completedAt: null,
      exitCode: null,
      chunks: [],
      cachedOutput: '',
      chunksAreSorted: true,
    });
  }

  /**
   * 追加一个 output chunk。
   *
   * 允许在 `completeRun` 之后追加(尾部乱序 chunk 场景);如果上层希望严格
   * 拒绝 "complete 后 append",请在调用前自查 `getMetadata(runId)?.completedAt`。
   */
  appendChunk(payload: ITerminalRunChunkPayload): void {
    const record = this.getOrCreateRecord(payload.runId, payload.sessionId);
    const seq = typeof payload.seq === 'number' ? payload.seq : null;
    const chunk: ITerminalRunChunk = {
      seq,
      arrivalIndex: this.nextArrivalIndex,
      data: payload.data,
    };
    this.nextArrivalIndex += 1;

    // R1 fast-path 维护:任何 null seq 或 seq 倒序到达都打破单调性。
    if (record.chunksAreSorted) {
      const last = record.chunks[record.chunks.length - 1];
      if (seq === null || (last && last.seq !== null && seq < last.seq)) {
        record.chunksAreSorted = false;
      }
    }

    record.chunks.push(chunk);
    record.cachedOutput = null; // R1:失效缓存
  }

  /**
   * 标记 run 完成。重复调用会被忽略并 warn(R2:first-write-wins),
   * 避免 retry / 乱序事件覆盖原始完成时间。
   */
  completeRun(payload: ITerminalRunCompletedPayload): void {
    const record = this.getOrCreateRecord(payload.runId, payload.sessionId);
    if (record.completedAt !== null) {
      console.warn(`[terminal-run-store] duplicate completeRun ignored runId=${payload.runId}`);
      return;
    }
    record.completedAt = payload.finishedAt;
    record.exitCode = payload.exitCode;
  }

  getOutput(runId: string): string {
    const record = this.records.get(runId);
    if (!record) {
      return '';
    }
    if (record.cachedOutput !== null) {
      return record.cachedOutput;
    }
    const ordered = this.resolveChunks(record);
    const output = ordered.length === record.chunks.length && ordered === record.chunks
      ? this.joinChunks(record.chunks)
      : this.joinChunks(ordered);
    record.cachedOutput = output;
    return output;
  }

  /** R5 新增:不含 output 的轻量元数据,避免触发缓存 miss 的全量重算。 */
  getMetadata(runId: string): ITerminalRunMetadata | null {
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
      chunkCount: record.chunks.length,
    };
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

  /** R5 新增:消费一条丢一条,避免 Map 无界增长。 */
  delete(runId: string): boolean {
    return this.records.delete(runId);
  }

  /** R5 新增:观测当前已记录的 run 数量。 */
  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.nextArrivalIndex = 0;
  }

  private getOrCreateRecord(runId: string, sessionId: string): ITerminalRunRecordInternal {
    const existing = this.records.get(runId);
    if (existing) {
      return existing;
    }
    const record: ITerminalRunRecordInternal = {
      runId,
      sessionId,
      startedAt: null,
      completedAt: null,
      exitCode: null,
      chunks: [],
      cachedOutput: '',
      chunksAreSorted: true,
    };
    this.records.set(runId, record);
    return record;
  }

  /**
   * R1 优化:
   *   - 若 `chunksAreSorted` 为 true → 直接返回原数组,**不 copy 不 sort**。
   *   - 否则按 (seq, arrivalIndex) 二级排序;无 seq 时仅按 arrivalIndex。
   */
  private resolveChunks(record: ITerminalRunRecordInternal): ITerminalRunChunk[] {
    if (record.chunksAreSorted) {
      return record.chunks;
    }
    const allChunksHaveSequence = record.chunks.every((chunk) => chunk.seq !== null);
    if (!allChunksHaveSequence) {
      return [...record.chunks].sort((a, b) => a.arrivalIndex - b.arrivalIndex);
    }
    return [...record.chunks].sort((a, b) => {
      const leftSeq = a.seq ?? 0;
      const rightSeq = b.seq ?? 0;
      if (leftSeq !== rightSeq) {
        return leftSeq - rightSeq;
      }
      return a.arrivalIndex - b.arrivalIndex;
    });
  }

  private joinChunks(chunks: ITerminalRunChunk[]): string {
    // 单 chunk 跳过分配。
    if (chunks.length === 0) return '';
    if (chunks.length === 1) return chunks[0].data;
    // Array.prototype.join 比 reduce + concat 快;V8 有专门优化。
    const parts: string[] = new Array(chunks.length);
    for (let i = 0; i < chunks.length; i += 1) {
      parts[i] = chunks[i].data;
    }
    return parts.join('');
  }
}

export const createTerminalRunStore = (): TerminalRunStore => new TerminalRunStore();