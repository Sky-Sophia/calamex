import type { Agent, AgentResult, InvokeOptions } from '@strands-agents/sdk';

import type { TAgentUiEvent, TJsonValue } from '../schemas/events.js';
import { normalizeStrandsStreamEvent, extractModelTextDelta } from './stream-normalizer.js';
import { redactForStream } from './stream-redaction.js';
import type { AgentStreamEventBus } from './stream-event-bus.js';

export interface ICompletedAgentStream {
  agentResult: AgentResult;
  visibleText: string;
}

export interface IRunAgentStreamParams {
  agent: Agent;
  prompt: string;
  streamOptions: InvokeOptions;
  eventBus: AgentStreamEventBus;
  emitLegacyEvent: (event: TAgentUiEvent) => void;
  toJsonValue: (value: unknown) => TJsonValue;
}

interface IAgentStreamCapture {
  visibleText: string;
}

interface IJsonSerializable {
  toJSON: () => unknown;
}

const RUN_INPUT_PREVIEW_CHARS = 300;
const RUN_OUTPUT_PREVIEW_CHARS = 1200;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const getStringValue = (
  value: unknown,
  key: string,
): string | undefined => {
  const candidate = toRecord(value)?.[key];
  return typeof candidate === 'string' ? candidate : undefined;
};

const getEventType = (event: unknown): string =>
  getStringValue(event, 'type') ?? 'unknown';

const getToolUse = (event: unknown): Record<string, unknown> | null =>
  toRecord(toRecord(event)?.toolUse);

const getToolUseName = (event: unknown): string =>
  getStringValue(getToolUse(event), 'name') ?? 'unknown_tool';

const getToolUseInput = (event: unknown): unknown =>
  getToolUse(event)?.input;

const hasToJson = (value: unknown): value is IJsonSerializable => {
  const record = toRecord(value);
  return typeof record?.toJSON === 'function';
};

const getToolResultOutput = (event: unknown): unknown => {
  const result = toRecord(event)?.result;
  return hasToJson(result) ? result.toJSON() : result;
};

const clipPreview = (value: string, limit: number): string => {
  const characters = Array.from(value.replace(/\s+/gu, ' ').trim());

  if (characters.length <= limit) {
    return characters.join('');
  }

  return `${characters.slice(0, limit).join('')}...`;
};

const appendLegacySidecarEvent = (
  event: unknown,
  params: Pick<IRunAgentStreamParams, 'emitLegacyEvent' | 'toJsonValue'>,
  capture: IAgentStreamCapture,
): void => {
  const textDelta = extractModelTextDelta(event);

  if (textDelta) {
    capture.visibleText += textDelta;
    params.emitLegacyEvent({
      type: 'message_delta',
      text: capture.visibleText,
    });
    return;
  }

  const eventType = getEventType(event);

  if (eventType === 'beforeToolCallEvent') {
    params.emitLegacyEvent({
      type: 'tool_start',
      toolName: getToolUseName(event),
      input: params.toJsonValue(getToolUseInput(event)),
    });
    return;
  }

  if (eventType === 'afterToolCallEvent') {
    params.emitLegacyEvent({
      type: 'tool_result',
      toolName: getToolUseName(event),
      output: params.toJsonValue(getToolResultOutput(event)),
    });
  }
};

const emitRuntimeDrafts = (
  event: unknown,
  eventBus: AgentStreamEventBus,
): void => {
  for (const draft of normalizeStrandsStreamEvent(event)) {
    eventBus.emitDraft(draft);
  }
};

export const runAgentStream = async (
  params: IRunAgentStreamParams,
): Promise<ICompletedAgentStream> => {
  const capture: IAgentStreamCapture = {
    visibleText: '',
  };

  params.eventBus.emitDraft({
    type: 'agent.run.started',
    visibility: 'user',
    level: 'info',
    inputPreview: redactForStream(clipPreview(params.prompt, RUN_INPUT_PREVIEW_CHARS)),
  });

  try {
    const stream = params.agent.stream(params.prompt, params.streamOptions);

    while (true) {
      const next = await stream.next();
      if (next.done) {
        const outputPreview = capture.visibleText.trim()
          ? redactForStream(clipPreview(capture.visibleText, RUN_OUTPUT_PREVIEW_CHARS))
          : undefined;

        params.eventBus.emitDraft({
          type: 'agent.run.completed',
          visibility: 'user',
          level: 'info',
          stopReason: next.value.stopReason,
          ...(outputPreview ? { outputPreview } : {}),
        });

        return {
          agentResult: next.value,
          visibleText: capture.visibleText,
        };
      }

      emitRuntimeDrafts(next.value, params.eventBus);
      appendLegacySidecarEvent(next.value, params, capture);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    params.eventBus.emitDraft({
      type: 'agent.run.error',
      visibility: 'user',
      level: 'error',
      errorMessage: message,
    });

    throw error;
  }
};
