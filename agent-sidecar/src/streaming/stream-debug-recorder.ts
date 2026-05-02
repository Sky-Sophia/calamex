import { mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { TAgentRuntimeEvent } from './stream-types.js';

export class StreamDebugRecorder {
  constructor(
    private readonly enabled: boolean,
    private readonly filePath: string,
  ) {}

  async record(event: TAgentRuntimeEvent): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
