import { getOfficialAcontextSessionDir } from '../config/settings.js';

export interface IRollbackConfig {
  enabled: boolean;
  sessionDir: string;
  autoCheckpointEveryMessages: number;
  checkpointBeforeRiskyTool: boolean;
  listLimit: number;
  allowDeleteSession: boolean;
  riskyToolNames: readonly string[];
}

export const DEFAULT_ROLLBACK_CONFIG: IRollbackConfig = {
  enabled: true,
  sessionDir: getOfficialAcontextSessionDir(),
  autoCheckpointEveryMessages: 8,
  checkpointBeforeRiskyTool: true,
  listLimit: 50,
  allowDeleteSession: false,
  riskyToolNames: [],
};

export const createRollbackConfig = (
  overrides: Partial<IRollbackConfig> = {},
): IRollbackConfig => {
  const defaults = {
    ...DEFAULT_ROLLBACK_CONFIG,
    sessionDir: getOfficialAcontextSessionDir(),
  };

  return {
    ...defaults,
    ...overrides,
  };
};
