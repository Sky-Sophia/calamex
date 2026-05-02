import type { SnapshotTriggerCallback } from '@strands-agents/sdk';

import type { IRollbackConfig } from './rollback-config.js';

export const shouldCreateMessageIntervalCheckpoint = (
  messageCount: number,
  everyMessages: number,
): boolean =>
  Number.isInteger(messageCount) &&
  Number.isInteger(everyMessages) &&
  messageCount > 0 &&
  everyMessages > 0 &&
  messageCount % everyMessages === 0;

export const createAcontextSnapshotTrigger = (
  config: Pick<IRollbackConfig, 'enabled' | 'autoCheckpointEveryMessages'>,
): SnapshotTriggerCallback => ({ agentData }) => {
  if (!config.enabled) {
    return false;
  }

  return shouldCreateMessageIntervalCheckpoint(
    agentData.messages.length,
    config.autoCheckpointEveryMessages,
  );
};

export const isRiskyToolName = (
  toolName: string,
  riskyToolNames: readonly string[],
): boolean => riskyToolNames.includes(toolName);
