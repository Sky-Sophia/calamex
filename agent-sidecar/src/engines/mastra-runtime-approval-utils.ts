import { Buffer } from 'node:buffer';
import { APPROVAL_TOKEN_PREFIX } from './mastra-runtime-utils.js';
import { toRecord } from './mastra-runtime-utils.js';

export interface IEncodedApprovalRequestPayload {
    runId: string;
    toolCallId: string;
    path?: string | undefined;
}

export const extractApprovalToolPath = (args: unknown): string | undefined => {
    const path = toRecord(args)?.path;
    return typeof path === 'string' && path.trim().length > 0 ? path : undefined;
};

export const encodeApprovalRequestId = (
    runId: string,
    toolCallId: string,
    path?: string,
): string => {
    const encoded = Buffer.from(JSON.stringify({
        runId,
        toolCallId,
        ...(typeof path === 'string' && path.trim().length > 0 ? { path } : {}),
    } satisfies IEncodedApprovalRequestPayload), 'utf8').toString('base64url');

    return `${APPROVAL_TOKEN_PREFIX}${encoded}`;
};

export const decodeApprovalRequestId = (
    requestId: string,
): IEncodedApprovalRequestPayload | null => {
    if (!requestId.startsWith(APPROVAL_TOKEN_PREFIX)) {
        return null;
    }

    try {
        const parsed = JSON.parse(
            Buffer.from(requestId.slice(APPROVAL_TOKEN_PREFIX.length), 'base64url').toString('utf8'),
        ) as { runId?: unknown; toolCallId?: unknown; path?: unknown };

        return typeof parsed.runId === 'string' && typeof parsed.toolCallId === 'string'
            ? {
                runId: parsed.runId,
                toolCallId: parsed.toolCallId,
                ...(typeof parsed.path === 'string' && parsed.path.trim().length > 0
                    ? { path: parsed.path }
                    : {}),
            }
            : null;
    } catch {
        return null;
    }
};

export const getChunkRunId = (chunk: unknown): string | null => {
    const runId = toRecord(chunk)?.runId;
    return typeof runId === 'string' && runId.trim().length > 0 ? runId : null;
};

export const isApprovedDecision = (decision: string): boolean => {
    const normalizedDecision = decision.trim().toLowerCase();

    return ![
        'decline',
        'declined',
        'deny',
        'denied',
        'no',
        'reject',
        'rejected',
        'skip',
        'skipped',
        'stop',
        'stopped',
    ].includes(normalizedDecision);
};
