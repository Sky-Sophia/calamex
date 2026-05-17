import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import type { ToolCallPayload } from '@mastra/core/stream';
import { EXPLICIT_CONTEXT_MESSAGE_LIMIT, type TMastraChatMessage } from './mastra-runtime-types.js';
import type { IAgentMessageInput, IAgentRuntimeInput } from './runtime-input.js';
import { toNonEmptyString, toRecord } from './mastra-runtime-utils.js';

export const findLastUserMessage = (messages: IAgentMessageInput[]): IAgentMessageInput | null => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];

        if (message?.role === 'user') {
            return message;
        }
    }

    return null;
};

export const buildMastraUserPrompt = (input: IAgentRuntimeInput): string => {
    const lastUserContent = findLastUserMessage(input.messages)?.content.trim() ?? '';
    const request = lastUserContent || input.goal.trim();
    const goal = request === input.goal ? '' : `目标：${input.goal}`;
    const outputContract = input.mode === 'plan'
        ? '输出格式：返回一个简洁的 json object，根对象必须直接包含 goal、steps；steps 只写短标题节点，不要包裹在 plan/result/data 字段里。'
        : '';

    return [
        outputContract,
        goal,
        request,
    ]
        .filter((line) => line.trim().length > 0)
        .join('\n');
};

export const buildMastraMessages = (input: IAgentRuntimeInput): TMastraChatMessage[] => {
    const userPrompt = buildMastraUserPrompt(input).trim();
    const conversationMessages = input.messages
        .filter((message): message is IAgentMessageInput & { role: TMastraChatMessage['role'] } =>
            (message.role === 'user' || message.role === 'assistant')
            && message.content.trim().length > 0)
        .map((message) => ({
            role: message.role,
            content: message.content.trim(),
        }))
        .slice(-EXPLICIT_CONTEXT_MESSAGE_LIMIT);

    if (conversationMessages.length === 0) {
        return [{
            role: 'user',
            content: userPrompt.length > 0
                ? userPrompt
                : (input.goal.trim().length > 0 ? input.goal : '继续。'),
        }];
    }

    if (userPrompt.length === 0) {
        return conversationMessages;
    }

    for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
        if (conversationMessages[index]?.role === 'user') {
            return conversationMessages.map((message, messageIndex) =>
                messageIndex === index ? { ...message, content: userPrompt } : message);
        }
    }

    return [
        ...conversationMessages,
        { role: 'user', content: userPrompt },
    ];
};

export const formatApprovalSummary = (payload: ToolCallPayload): string => {
    if (payload.args === undefined) {
        return `${payload.toolName} 请求执行，但当前没有可展示的参数。`;
    }

    if (payload.toolName === WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND) {
        const command = toNonEmptyString(toRecord(payload.args)?.command);
        return command
            ? `请求执行命令：${command}`
            : '请求执行命令，请确认是否继续。';
    }

    return `${payload.toolName} 请求执行，参数内容已收敛显示，请确认是否继续。`;
};

export const normalizeMastraError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }

    const message = toRecord(error)?.message;
    return typeof message === 'string' && message.trim().length > 0
        ? message
        : String(error);
};
