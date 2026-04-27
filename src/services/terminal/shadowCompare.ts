type TShadowChannel = 'legacy' | 'shadow';

interface IShadowChannelRecord {
  startedAtMs: number | null;
  completedAtMs: number | null;
  output: string;
  states: string[];
}

export interface IShadowComparison {
  runId: string;
  outputEqual: boolean;
  byteDiff: number;
  legacyBytes: number;
  shadowBytes: number;
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
  output: '',
  states: [],
});

const measureBytes = (value: string): number =>
  textEncoder ? textEncoder.encode(value).length : value.length;

export class TerminalShadowCompareStore {
  private readonly records = new Map<string, IShadowRunRecord>();

  start(runId: string, channel: TShadowChannel, atMs: number): void {
    this.getOrCreateRecord(runId)[channel].startedAtMs = atMs;
  }

  appendOutput(runId: string, channel: TShadowChannel, data: string): void {
    this.getOrCreateRecord(runId)[channel].output += data;
  }

  complete(runId: string, channel: TShadowChannel, atMs: number): void {
    this.getOrCreateRecord(runId)[channel].completedAtMs = atMs;
  }

  pushState(runId: string, channel: TShadowChannel, state: string): void {
    this.getOrCreateRecord(runId)[channel].states.push(state);
  }

  compare(runId: string): IShadowComparison | null {
    const record = this.records.get(runId);
    if (!record) {
      return null;
    }

    const legacyDuration = this.resolveDuration(record.legacy);
    const shadowDuration = this.resolveDuration(record.shadow);
    const legacyBytes = measureBytes(record.legacy.output);
    const shadowBytes = measureBytes(record.shadow.output);

    return {
      runId,
      outputEqual: record.legacy.output === record.shadow.output,
      byteDiff: Math.abs(legacyBytes - shadowBytes),
      legacyBytes,
      shadowBytes,
      durationDeltaMs:
        legacyDuration === null || shadowDuration === null ? null : shadowDuration - legacyDuration,
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

  clear(): void {
    this.records.clear();
  }

  private getOrCreateRecord(runId: string): IShadowRunRecord {
    const existing = this.records.get(runId);
    if (existing) {
      return existing;
    }

    const record = {
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

    return left.every((value, index) => value === right[index]);
  }
}

export const createTerminalShadowCompareStore = (): TerminalShadowCompareStore =>
  new TerminalShadowCompareStore();
