/**
 * 终端 legacy/shadow 双通道对比存储。
 *
 * 用于灰度迁移时把"旧实现 (legacy) 和新实现 (shadow) 并行跑同一脚本"的
 * 输出/时序/状态序列收集到一起,事后做差异对比,**不参与产品行为**。
 *
 * 单次 run 的生命周期(每条通道独立):
 *   start  →  appendOutput*  →  pushState*  →  complete
 *
 * 协议特性:
 *   - 同一个 (runId, channel) 的 start / complete 取**首次**写入 (R2 修复)。
 *   - appendOutput / pushState 可以多次,顺序保留;允许在 complete 之后仍
 *     被追加(事件乱序场景),不会拒收但行为是"尾部仍并入 output"。
 *   - 不做磁盘持久化,不做 LRU,长跑请配合 `delete(runId)` 或 `clear()`。
 */

type TShadowChannel = 'legacy' | 'shadow';

interface IShadowChannelRecord {
  startedAtMs: number | null;
  completedAtMs: number | null;
  /**
   * 输出 chunk 数组(R1 修复)。仅在 `compare()` 时 join 成完整字符串,
   * 避免 `+= data` 在长跑场景下的 O(n²) flatten 退化。
   */
  chunks: string[];
  states: string[];
}

export interface IShadowComparison {
  runId: string;
  /** 完整 output 字符串严格相等。**判等永远以本字段为准**。 */
  outputEqual: boolean;
  /**
   * 字节数之差的**绝对值**,不是字节级 diff (Myers / LCS)。
   * `byteDiff === 0` **不**蕴含 `outputEqual === true`(可能字节数相同但
   * 内容不同),只能作为诊断信号。
   */
  byteDiff: number;
  legacyBytes: number;
  shadowBytes: number;
  /** shadow - legacy。任一通道未完整 (start/complete 缺失) 时为 null。 */
  durationDeltaMs: number | null;
  stateSequenceEqual: boolean;
}

interface IShadowRunRecord {
  runId: string;
  legacy: IShadowChannelRecord;
  shadow: IShadowChannelRecord;
}

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const createChannelRecord = (): IShadowChannelRecord => ({
  startedAtMs: null,
  completedAtMs: null,
  chunks: [],
  states: [],
});

/**
 * UTF-8 字节长度。fallback 路径(无 TextEncoder)用 UTF-16 code unit count
 * 近似,在 emoji / CJK 上有偏差,但所有现代浏览器 + Node 11+ 都内置
 * TextEncoder,fallback 实际不会被触发。
 */
const measureBytes = (value: string): number => {
  if (textEncoder) {
    return textEncoder.encode(value).length;
  }
  console.warn('[shadow-compare] TextEncoder 缺失,byteDiff 退化为 UTF-16 code unit count');
  return value.length;
};

export class TerminalShadowCompareStore {
  private readonly records = new Map<string, IShadowRunRecord>();

  start(runId: string, channel: TShadowChannel, atMs: number): void {
    const channelRecord = this.getOrCreateRecord(runId)[channel];
    if (channelRecord.startedAtMs !== null) {
      // R2 修复:first-write-wins,避免 retry / 乱序覆盖。
      console.warn(
        `[shadow-compare] duplicate start ignored runId=${runId} channel=${channel}`,
      );
      return;
    }
    channelRecord.startedAtMs = atMs;
  }

  appendOutput(runId: string, channel: TShadowChannel, data: string): void {
    // 不在 complete 后阻拦(允许尾部乱序 chunk 并入)。R3:见类 jsdoc。
    this.getOrCreateRecord(runId)[channel].chunks.push(data);
  }

  complete(runId: string, channel: TShadowChannel, atMs: number): void {
    const channelRecord = this.getOrCreateRecord(runId)[channel];
    if (channelRecord.completedAtMs !== null) {
      // R2 修复:first-write-wins。
      console.warn(
        `[shadow-compare] duplicate complete ignored runId=${runId} channel=${channel}`,
      );
      return;
    }
    channelRecord.completedAtMs = atMs;
  }

  pushState(runId: string, channel: TShadowChannel, state: string): void {
    this.getOrCreateRecord(runId)[channel].states.push(state);
  }

  /** 返回单次 run 的两通道对比;runId 不存在返回 null。 */
  compare(runId: string): IShadowComparison | null {
    const record = this.records.get(runId);
    if (!record) {
      return null;
    }
    const legacyOutput = record.legacy.chunks.join('');
    const shadowOutput = record.shadow.chunks.join('');
    const legacyDuration = this.resolveDuration(record.legacy);
    const shadowDuration = this.resolveDuration(record.shadow);
    const legacyBytes = measureBytes(legacyOutput);
    const shadowBytes = measureBytes(shadowOutput);
    return {
      runId,
      outputEqual: legacyOutput === shadowOutput,
      byteDiff: Math.abs(legacyBytes - shadowBytes),
      legacyBytes,
      shadowBytes,
      durationDeltaMs:
        legacyDuration === null || shadowDuration === null
          ? null
          : shadowDuration - legacyDuration,
      stateSequenceEqual: this.statesEqual(record.legacy.states, record.shadow.states),
    };
  }

  listComparisons(): IShadowComparison[] {
    const comparisons: IShadowComparison[] = [];
    for (const runId of this.records.keys()) {
      const comparison = this.compare(runId);
      if (comparison) {
        comparisons.push(comparison);
      }
    }
    return comparisons;
  }

  /** R5 新增:消费一条丢一条,避免上层只有 clear-all 选项导致 Map 无界增长。 */
  delete(runId: string): boolean {
    return this.records.delete(runId);
  }

  /** 当前已记录的 runId 数,便于 UI / 测试观测。 */
  size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }

  private getOrCreateRecord(runId: string): IShadowRunRecord {
    const existing = this.records.get(runId);
    if (existing) {
      return existing;
    }
    const record: IShadowRunRecord = {
      runId,
      legacy: createChannelRecord(),
      shadow: createChannelRecord(),
    };
    this.records.set(runId, record);
    return record;
  }

  private resolveDuration(record: IShadowChannelRecord): number | null {
    if (record.startedAtMs === null || record.completedAtMs === null) {
      return null;
    }
    return Math.max(0, record.completedAtMs - record.startedAtMs);
  }

  private statesEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }
}

export const createTerminalShadowCompareStore = (): TerminalShadowCompareStore =>
  new TerminalShadowCompareStore();