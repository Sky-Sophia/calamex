import type { ToolsInput } from '@mastra/core/agent';
import { z } from 'zod';
import type { IDeepSeekRequestPayloadStats } from '../models/deepseek-reasoning-fetch.js';
import type { IAgentRuntimeRunOptions, TAgentRuntimeOutputEvent } from './runtime-contracts.js';
import type { IAgentContextReferenceInput } from './runtime-input.js';
import { pushUiEvent, toRecord } from './mastra-runtime-utils.js';
import type { IMastraToolBudgetStats, TAcontextProviderPayloadEventDraft, TAcontextTokenEventDraft, TMastraChatMessage, TRuntimeEventFactory } from './mastra-runtime-types.js';

export const countTextChars = (value: string): number => Array.from(value).length;

export const stringifyForBudget = (value: unknown): string => {
    try {
        return JSON.stringify(value) ?? '';
    } catch {
        return '';
    }
};

export const countJsonChars = (value: unknown): number => countTextChars(stringifyForBudget(value));

export const createJsonToolModelOutput = (value: unknown): { type: 'json'; value: unknown } => ({
    type: 'json',
    value,
});

export const EMPTY_TOOL_PARAMETERS = {
    type: 'object',
    properties: {},
    additionalProperties: false,
} as const;

export const isZodSchemaLike = (value: unknown): value is z.ZodType<unknown> => {
    const record = toRecord(value);

    return typeof record?.parse === 'function'
        && typeof record?.safeParse === 'function';
};

export const convertToolInputSchemaForBudget = (schema: unknown): unknown => {
    if (!schema) {
        return EMPTY_TOOL_PARAMETERS;
    }

    const schemaRecord = toRecord(schema);
    if (schemaRecord && 'jsonSchema' in schemaRecord) {
        return schemaRecord.jsonSchema;
    }

    if (isZodSchemaLike(schema)) {
        try {
            return z.toJSONSchema(schema);
        } catch {
            return EMPTY_TOOL_PARAMETERS;
        }
    }

    return schema;
};

export const createProviderToolBudgetShape = (
    name: string,
    tool: unknown,
): {
    type: 'function';
    name: string;
    description?: string;
    parameters: unknown;
} => {
    const toolRecord = toRecord(tool);
    const description = typeof toolRecord?.description === 'string'
        ? toolRecord.description
        : undefined;
    const inputSchema = toolRecord && 'inputSchema' in toolRecord
        ? toolRecord.inputSchema
        : toolRecord?.parameters;

    return {
        type: 'function',
        name,
        ...(description ? { description } : {}),
        parameters: convertToolInputSchemaForBudget(inputSchema),
    };
};

export const countProviderToolSchemaChars = (tools: ToolsInput): number =>
    countJsonChars(Object.entries(tools).map(([name, tool]) =>
        createProviderToolBudgetShape(name, tool),
    ));

export const estimateInputTokensByChars = (value: string): number => {
    let asciiRunLength = 0;
    let tokens = 0;

    for (const char of Array.from(value)) {
        const codePoint = char.codePointAt(0) ?? 0;

        if (codePoint <= 0x7f) {
            asciiRunLength += 1;
            continue;
        }

        if (asciiRunLength > 0) {
            tokens += Math.ceil(asciiRunLength / 4);
            asciiRunLength = 0;
        }

        tokens += 1;
    }

    if (asciiRunLength > 0) {
        tokens += Math.ceil(asciiRunLength / 4);
    }

    return Math.max(tokens, 1);
};

export const createAcontextTokenEventDraft = (input: {
    systemPrompt: string;
    messages: readonly TMastraChatMessage[];
    contextReferences: readonly IAgentContextReferenceInput[];
    tools: ToolsInput;
    toolStats: IMastraToolBudgetStats;
    workspaceEnabled: boolean;
    browserEnabled: boolean;
    memoryEnabled: boolean;
    maxSteps: number;
    toolChoice: 'auto' | 'none';
}): TAcontextTokenEventDraft => {
    const messagesText = stringifyForBudget(input.messages);
    const toolsText = stringifyForBudget(Object.entries(input.tools).map(([name, tool]) =>
        createProviderToolBudgetShape(name, tool),
    ));
    const systemPromptCharCount = countTextChars(input.systemPrompt);
    const messageCharCount = countTextChars(messagesText);
    const toolSchemaCharCount = input.toolStats.toolSchemaCharCount;
    const contextCharCount = countJsonChars(input.contextReferences);
    const inputText = [
        input.systemPrompt,
        messagesText,
        toolsText,
    ].join('\n');

    return {
        type: 'acontext.token.checked',
        visibility: 'debug',
        level: 'info',
        projectedInputTokens: estimateInputTokensByChars(inputText),
        inputCharCount: systemPromptCharCount + messageCharCount + toolSchemaCharCount,
        systemPromptCharCount,
        messageCharCount,
        contextCharCount,
        toolSchemaCharCount,
        toolCount: input.toolStats.toolCount,
        mcpToolCount: input.toolStats.mcpToolCount,
        mcpServerCount: input.toolStats.mcpServerCount,
        uiContextToolCount: input.toolStats.uiContextToolCount,
        nativeToolCount: input.toolStats.nativeToolCount,
        logToolCount: input.toolStats.logToolCount,
        mcpServerNames: input.toolStats.mcpServerNames,
        toolLoadStrategy: input.toolStats.toolLoadStrategy,
        workspaceEnabled: input.workspaceEnabled,
        browserEnabled: input.browserEnabled,
        memoryEnabled: input.memoryEnabled,
        maxSteps: input.maxSteps,
        toolChoice: input.toolChoice,
        tokenEstimateMethod: 'char_heuristic',
    };
};

export const createAcontextProviderPayloadEventDraft = (
    stats: IDeepSeekRequestPayloadStats,
    requestIndex: number,
): TAcontextProviderPayloadEventDraft => ({
    type: 'acontext.provider_payload.checked',
    visibility: 'debug',
    level: 'info',
    provider: stats.provider,
    ...(stats.model ? { model: stats.model } : {}),
    ...(stats.stream !== undefined ? { stream: stats.stream } : {}),
    requestIndex,
    requestBodyCharCount: stats.requestBodyCharCount,
    projectedInputTokens: stats.projectedInputTokens,
    messageCharCount: stats.messageCharCount,
    systemMessageCharCount: stats.systemMessageCharCount,
    userMessageCharCount: stats.userMessageCharCount,
    assistantMessageCharCount: stats.assistantMessageCharCount,
    toolMessageCharCount: stats.toolMessageCharCount,
    reasoningReplayCharCount: stats.reasoningReplayCharCount,
    toolSchemaCharCount: stats.toolSchemaCharCount,
    toolCount: stats.toolCount,
    responseFormatCharCount: stats.responseFormatCharCount,
    reasoningInjected: stats.reasoningInjected,
    tokenEstimateMethod: 'char_heuristic',
});

export const createDeepSeekPayloadEventSink = (
    events: TAgentRuntimeOutputEvent[],
    options: IAgentRuntimeRunOptions,
): {
    onRequestPayload: (stats: IDeepSeekRequestPayloadStats) => void;
    attachRuntimeEventFactory: (factory: TRuntimeEventFactory) => void;
} => {
    const pending: TAcontextProviderPayloadEventDraft[] = [];
    let runtimeEventFactory: TRuntimeEventFactory | null = null;
    let requestIndex = 0;

    const pushDraft = (draft: TAcontextProviderPayloadEventDraft): void => {
        if (!runtimeEventFactory) {
            pending.push(draft);
            return;
        }

        pushUiEvent(events, runtimeEventFactory(draft), options);
    };

    return {
        onRequestPayload: (stats) => {
            requestIndex += 1;
            pushDraft(createAcontextProviderPayloadEventDraft(stats, requestIndex));
        },
        attachRuntimeEventFactory: (factory) => {
            runtimeEventFactory = factory;

            while (pending.length > 0) {
                const draft = pending.shift();

                if (draft) {
                    pushUiEvent(events, runtimeEventFactory(draft), options);
                }
            }
        },
    };
};
