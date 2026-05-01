import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { StrandsEngine } from './engines/strands-engine.js';
import type { IStrandsEngineInput, TAgentMode } from './engines/strands-engine.js';
import { agentSidecarResponseSchema } from './schemas/events.js';
import { getMcpRuntimeStatus } from './tools/mcp.js';

const DEFAULT_PORT = 39871;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

const agentModeSchema = z.enum(['ask', 'plan', 'agent', 'patch', 'review']);

const agentMessageInputSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
});

const agentContextReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().min(1),
  path: z.string().nullable(),
  range: z.object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }).nullable(),
  contentPreview: z.string(),
  redacted: z.boolean(),
});

const baseAgentRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  mode: agentModeSchema.optional(),
  goal: z.string().min(1).optional(),
  messages: z.array(agentMessageInputSchema).default([]),
  workspaceRootPath: z.string().min(1).nullable().optional(),
  context: z.array(agentContextReferenceSchema).default([]),
});

const approvalResolutionSchema = z.object({
  requestId: z.string().min(1),
  decision: z.string().min(1),
});

const engine = new StrandsEngine();

const writeJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
};

const readBody = async (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    request.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        reject(new Error('请求体超过 sidecar 限制。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('error', reject);
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8').trim();
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(new Error('请求体不是合法 JSON。'));
      }
    });
  });

const toAgentInput = (
  payload: z.infer<typeof baseAgentRequestSchema>,
  mode: TAgentMode,
): IStrandsEngineInput => {
  const lastUserMessage = [...payload.messages]
    .reverse()
    .find((message) => message.role === 'user');
  const input: IStrandsEngineInput = {
    mode: payload.mode ?? mode,
    goal: payload.goal ?? lastUserMessage?.content ?? '继续当前任务',
    messages: payload.messages,
    context: payload.context,
  };

  if (payload.sessionId) {
    input.sessionId = payload.sessionId;
  }

  if (payload.workspaceRootPath) {
    input.workspaceRootPath = payload.workspaceRootPath;
  }

  return input;
};

const handlePost = async (
  request: IncomingMessage,
  response: ServerResponse,
  handler: (body: unknown) => Promise<unknown>,
): Promise<void> => {
  try {
    const body = await readBody(request);
    writeJson(response, 200, await handler(body));
  } catch (error) {
    writeJson(response, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const createAgentSidecarServer = () =>
  createServer((request, response) => {
    const url = request.url ?? '/';

    if (request.method === 'GET' && url === '/health') {
      writeJson(response, 200, {
        ok: true,
        status: 'ready',
        engine: 'strands',
        version: '0.1.0',
        mcp: getMcpRuntimeStatus(),
      });
      return;
    }

    if (request.method === 'POST' && url === '/agent/chat') {
      void handlePost(request, response, async (body) => {
        const payload = baseAgentRequestSchema.parse(body);
        return agentSidecarResponseSchema.parse(await engine.chat(toAgentInput(payload, 'ask')));
      });
      return;
    }

    if (request.method === 'POST' && url === '/agent/plan') {
      void handlePost(request, response, async (body) => {
        const payload = baseAgentRequestSchema.parse(body);
        return agentSidecarResponseSchema.parse(await engine.plan(toAgentInput(payload, 'plan')));
      });
      return;
    }

    if (request.method === 'POST' && url === '/agent/execute') {
      void handlePost(request, response, async (body) => {
        const payload = baseAgentRequestSchema.parse(body);
        return agentSidecarResponseSchema.parse(await engine.execute(toAgentInput(payload, 'agent')));
      });
      return;
    }

    if (request.method === 'POST' && url === '/approval/resolve') {
      void handlePost(request, response, async (body) => {
        const payload = approvalResolutionSchema.parse(body);
        return agentSidecarResponseSchema.parse(await engine.resolveApproval(payload));
      });
      return;
    }

    writeJson(response, 404, {
      error: '未知 sidecar 路由。',
    });
  });

const resolvePort = (): number => {
  const rawPort = process.env.AGENT_SIDECAR_PORT?.trim();
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;
};

const isEntrypoint = (): boolean => {
  const entrypoint = process.argv[1];
  return entrypoint ? resolve(fileURLToPath(import.meta.url)) === resolve(entrypoint) : false;
};

if (isEntrypoint()) {
  const port = resolvePort();
  createAgentSidecarServer().listen(port, '127.0.0.1', () => {
    console.info(`agent sidecar listening on http://127.0.0.1:${port}`);
  });
}
