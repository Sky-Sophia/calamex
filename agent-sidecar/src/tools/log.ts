import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

import { createTool } from '@mastra/core/tools';
import { PinoLogger } from '@mastra/loggers';
import { FileTransport } from '@mastra/loggers/file';
import { z } from 'zod';

const LOG_LEVEL_VALUES = ['debug', 'info', 'warn', 'error'] as const;

const logLevelSchema = z.enum(LOG_LEVEL_VALUES)
    .optional()
    .describe('Minimum log level to filter by.');

const paginationSchema = {
    page: z.number().int().min(1).optional().describe('Page number (1-based).'),
    per_page: z.number().int().min(1).max(200).optional().describe('Results per page (max 200).'),
};

const dateRangeSchema = {
    from_date: z.string().optional().describe('ISO 8601 start date, e.g. 2026-05-01T00:00:00Z.'),
    to_date: z.string().optional().describe('ISO 8601 end date, e.g. 2026-05-09T23:59:59Z.'),
};

const logEntrySchema = z.object({
    level: z.string(),
    msg: z.string(),
    time: z.string().optional(),
    runId: z.string().optional(),
    destinationPath: z.string().optional(),
    type: z.string().optional(),
}).passthrough();

const listLogsOutputSchema = z.object({
    logs: z.array(logEntrySchema),
    total: z.number(),
    page: z.number(),
    per_page: z.number(),
    has_more: z.boolean(),
});

type TLogEntry = z.infer<typeof logEntrySchema>;

const toLogEntry = (raw: unknown): TLogEntry => {
    const r = raw as { time?: unknown;[k: string]: unknown };
    return {
        ...r,
        time: r.time instanceof Date ? r.time.toISOString() : (r.time as string | undefined),
    } as TLogEntry;
};

export interface IMastraLogToolsRef {
    current: PinoLogger | null;
}

export const createMastraLoggerRef = (): IMastraLogToolsRef => ({ current: null });

export const ensureMastraLogFile = (logFilePath: string): string => {
    const logDir = dirname(logFilePath);

    if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
    }

    if (!existsSync(logFilePath)) {
        closeSync(openSync(logFilePath, 'a'));
    }

    return logFilePath;
};

export const createMastraFileLogger = (logFilePath: string): PinoLogger => new PinoLogger({
    name: 'mastra-sidecar',
    level: 'info',
    transports: {
        file: new FileTransport({ path: ensureMastraLogFile(logFilePath) }),
    },
    overrideDefaultTransports: false,
});

export const createMastraLogTools = (
    loggerRef: IMastraLogToolsRef,
): Record<'mastra_list_logs' | 'mastra_list_logs_by_run_id', ReturnType<typeof createTool>> => ({
    mastra_list_logs: createTool({
        id: 'mastra_list_logs',
        description:
            'List structured logs written by the Mastra sidecar logger. Supports filtering by date range, log level, and pagination. Use this to inspect recent agent activity, errors, or workflow progress.',
        inputSchema: z.object({
            log_level: logLevelSchema,
            ...dateRangeSchema,
            ...paginationSchema,
        }),
        outputSchema: listLogsOutputSchema,
        strict: true,
        execute: async ({ log_level, from_date, to_date, page, per_page }) => {
            const logger = loggerRef.current;
            if (!logger) {
                return { logs: [], total: 0, page: 1, per_page: per_page ?? 50, has_more: false };
            }
            const result = await logger.listLogs('file', {
                ...(log_level ? { logLevel: log_level } : {}),
                ...(from_date ? { fromDate: new Date(from_date) } : {}),
                ...(to_date ? { toDate: new Date(to_date) } : {}),
                page: page ?? 1,
                perPage: per_page ?? 50,
            });
            return {
                logs: result.logs.map(toLogEntry),
                total: result.total,
                page: result.page,
                per_page: result.perPage,
                has_more: result.hasMore,
            };
        },
    }),

    mastra_list_logs_by_run_id: createTool({
        id: 'mastra_list_logs_by_run_id',
        description:
            'Retrieve all structured logs for a specific agent run. Useful for diagnosing failures, tracing execution steps, or auditing tool calls within a single run.',
        inputSchema: z.object({
            run_id: z.string().describe('The run ID to retrieve logs for.'),
            log_level: logLevelSchema,
            ...dateRangeSchema,
            ...paginationSchema,
        }),
        outputSchema: listLogsOutputSchema,
        strict: true,
        execute: async ({ run_id, log_level, from_date, to_date, page, per_page }) => {
            const logger = loggerRef.current;
            if (!logger) {
                return { logs: [], total: 0, page: 1, per_page: per_page ?? 50, has_more: false };
            }
            const result = await logger.listLogsByRunId({
                transportId: 'file',
                runId: run_id,
                ...(log_level ? { logLevel: log_level } : {}),
                ...(from_date ? { fromDate: new Date(from_date) } : {}),
                ...(to_date ? { toDate: new Date(to_date) } : {}),
                page: page ?? 1,
                perPage: per_page ?? 50,
            });
            return {
                logs: result.logs.map(toLogEntry),
                total: result.total,
                page: result.page,
                per_page: result.perPage,
                has_more: result.hasMore,
            };
        },
    }),
});

