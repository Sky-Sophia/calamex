import { AsyncLocalStorage } from 'node:async_hooks';

interface IDeepSeekReasoningContext {
  sessionId: string;
  runId: string;
}

type TJsonRecord = Record<string, unknown>;

interface IReasoningStoreEntry {
  createdAt: number;
  reasoning: string;
}

const textEncoder = new TextEncoder();
const reasoningStore = new Map<string, IReasoningStoreEntry>();

export const deepseekReasoningContext = new AsyncLocalStorage<IDeepSeekReasoningContext>();

const isRecord = (value: unknown): value is TJsonRecord => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getReasoningLogEnabled = (): boolean =>
  process.env.AGENT_SIDECAR_DEEPSEEK_REASONING_DEBUG === '1';

const logReasoningDebug = (
  event: string,
  fields: Record<string, string | number | boolean | null>,
): void => {
  if (!getReasoningLogEnabled()) {
    return;
  }

  console.info('[deepseek-reasoning]', { event, ...fields });
};

const logReasoningWarning = (
  event: string,
  fields: Record<string, string | number | boolean | null>,
  error?: unknown,
): void => {
  console.warn('[deepseek-reasoning]', {
    event,
    ...fields,
    ...(error instanceof Error ? { error: error.message } : {}),
  });
};

export const createDeepSeekReasoningKey = (
  context: IDeepSeekReasoningContext | undefined,
  toolCallIds: readonly string[],
): string => {
  const sessionId = context?.sessionId ?? 'anon';
  const runId = context?.runId ?? 'anon';
  const normalizedIds = [...toolCallIds]
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .sort();

  return `${sessionId}::${runId}::${normalizedIds.join('|')}`;
};

export const evictDeepSeekReasoningByPrefix = (prefix: string): void => {
  for (const key of reasoningStore.keys()) {
    if (key.startsWith(prefix)) {
      reasoningStore.delete(key);
    }
  }
};

export const createDeepSeekReasoningRunPrefix = (
  sessionId: string,
  runId: string,
): string => `${sessionId}::${runId}::`;

export const runWithDeepSeekReasoningContext = async <T>(
  context: IDeepSeekReasoningContext,
  task: () => Promise<T>,
): Promise<T> => deepseekReasoningContext.run(context, task);

export const clearDeepSeekReasoningStoreForTest = (): void => {
  reasoningStore.clear();
};

export const setDeepSeekReasoningForTest = (
  context: IDeepSeekReasoningContext,
  toolCallIds: readonly string[],
  reasoning: string,
): void => {
  reasoningStore.set(createDeepSeekReasoningKey(context, toolCallIds), {
    createdAt: Date.now(),
    reasoning,
  });
};

const getToolCallIds = (toolCalls: unknown): string[] => {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall) => {
    const id = toNonEmptyString(isRecord(toolCall) ? toolCall.id : null);
    return id ? [id] : [];
  });
};

const storeReasoning = (
  context: IDeepSeekReasoningContext | undefined,
  toolCallIds: readonly string[],
  reasoning: string,
): void => {
  if (toolCallIds.length === 0 || reasoning.length === 0) {
    return;
  }

  const key = createDeepSeekReasoningKey(context, toolCallIds);
  reasoningStore.set(key, {
    createdAt: Date.now(),
    reasoning,
  });
  logReasoningDebug('capture', {
    sessionId: context?.sessionId ?? null,
    runId: context?.runId ?? null,
    toolCallCount: toolCallIds.length,
  });
};

const injectReasoningIntoMessages = (
  body: TJsonRecord,
  context: IDeepSeekReasoningContext | undefined,
): boolean => {
  const messages = body.messages;

  if (!Array.isArray(messages)) {
    return false;
  }

  let changed = false;

  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant') {
      continue;
    }

    const toolCallIds = getToolCallIds(message.tool_calls);
    if (toolCallIds.length === 0) {
      continue;
    }

    const key = createDeepSeekReasoningKey(context, toolCallIds);
    const stored = reasoningStore.get(key);

    if (!stored) {
      if (typeof message.reasoning_content !== 'string') {
        logReasoningWarning('miss', {
          sessionId: context?.sessionId ?? null,
          runId: context?.runId ?? null,
          toolCallCount: toolCallIds.length,
        });
      }
      continue;
    }

    delete message.reasoning_content;
    message.reasoning_content = stored.reasoning;
    changed = true;
    logReasoningDebug('inject', {
      sessionId: context?.sessionId ?? null,
      runId: context?.runId ?? null,
      toolCallCount: toolCallIds.length,
      ageMs: Date.now() - stored.createdAt,
    });
  }

  return changed;
};

const captureReasoningFromJson = (
  body: unknown,
  context: IDeepSeekReasoningContext | undefined,
): void => {
  const record = isRecord(body) ? body : null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(firstChoice?.message) ? firstChoice.message : null;
  const reasoning = typeof message?.reasoning_content === 'string'
    ? message.reasoning_content
    : '';
  const toolCallIds = getToolCallIds(message?.tool_calls);

  storeReasoning(context, toolCallIds, reasoning);
};

const extractStreamingDelta = (chunk: unknown): TJsonRecord | null => {
  const record = isRecord(chunk) ? chunk : null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  return isRecord(firstChoice?.delta) ? firstChoice.delta : null;
};

const captureStreamingLine = (
  line: string,
  state: {
    reasoning: string;
    toolCallIds: Set<string>;
  },
): void => {
  const trimmedLine = line.trimEnd();

  if (!trimmedLine.startsWith('data:')) {
    return;
  }

  const data = trimmedLine.slice('data:'.length).trim();

  if (!data || data === '[DONE]') {
    return;
  }

  const parsed = JSON.parse(data) as unknown;
  const delta = extractStreamingDelta(parsed);

  if (!delta) {
    return;
  }

  if (typeof delta.reasoning_content === 'string') {
    state.reasoning += delta.reasoning_content;
  }

  for (const id of getToolCallIds(delta.tool_calls)) {
    state.toolCallIds.add(id);
  }
};

const processStreamingText = (
  text: string,
  state: {
    pending: string;
    reasoning: string;
    toolCallIds: Set<string>;
  },
): void => {
  state.pending += text;
  const lines = state.pending.split('\n');
  state.pending = lines.pop() ?? '';

  for (const line of lines) {
    captureStreamingLine(line, state);
  }
};

const finalizeStreamingCapture = (
  context: IDeepSeekReasoningContext | undefined,
  decoder: TextDecoder,
  state: {
    pending: string;
    reasoning: string;
    toolCallIds: Set<string>;
  },
): void => {
  const flushed = decoder.decode();
  if (flushed) {
    processStreamingText(flushed, state);
  }
  if (state.pending) {
    captureStreamingLine(state.pending, state);
    state.pending = '';
  }

  storeReasoning(context, [...state.toolCallIds], state.reasoning);
};

const shouldHandleRequest = (body: unknown): body is TJsonRecord => (
  isRecord(body)
  && Array.isArray(body.messages)
);

const readRequestJsonBody = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<TJsonRecord | null> => {
  const rawBody = init?.body;

  if (typeof rawBody === 'string') {
    const parsed = JSON.parse(rawBody) as unknown;
    return shouldHandleRequest(parsed) ? parsed : null;
  }

  if (rawBody instanceof Uint8Array) {
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    return shouldHandleRequest(parsed) ? parsed : null;
  }

  if (rawBody instanceof ArrayBuffer) {
    const parsed = JSON.parse(new TextDecoder().decode(rawBody)) as unknown;
    return shouldHandleRequest(parsed) ? parsed : null;
  }

  if (input instanceof Request && rawBody === undefined) {
    const parsed = JSON.parse(await input.clone().text()) as unknown;
    return shouldHandleRequest(parsed) ? parsed : null;
  }

  return null;
};

const createRequestWithJsonBody = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  body: TJsonRecord,
): [RequestInfo | URL, RequestInit | undefined] => {
  const nextBody = JSON.stringify(body);

  if (input instanceof Request && init?.body === undefined) {
    return [new Request(input, { body: nextBody }), undefined];
  }

  return [
    input,
    {
      ...init,
      body: nextBody,
    },
  ];
};

const prepareOutboundRequest = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<[RequestInfo | URL, RequestInit | undefined]> => {
  const context = deepseekReasoningContext.getStore();

  try {
    const body = await readRequestJsonBody(input, init);

    if (!body) {
      return [input, init];
    }

    const changed = injectReasoningIntoMessages(body, context);
    return changed ? createRequestWithJsonBody(input, init, body) : [input, init];
  } catch (error) {
    logReasoningWarning('outbound-failed', {
      sessionId: context?.sessionId ?? null,
      runId: context?.runId ?? null,
      toolCallCount: 0,
    }, error);
    return [input, init];
  }
};

const responseInitFrom = (response: Response): ResponseInit => ({
  status: response.status,
  statusText: response.statusText,
  headers: new Headers(response.headers),
});

const captureNonStreamingResponse = async (
  response: Response,
  context: IDeepSeekReasoningContext | undefined,
): Promise<Response> => {
  const text = await response.text();

  try {
    if (text.trim().length > 0) {
      captureReasoningFromJson(JSON.parse(text) as unknown, context);
    }
  } catch (error) {
    logReasoningWarning('non-stream-capture-failed', {
      sessionId: context?.sessionId ?? null,
      runId: context?.runId ?? null,
      toolCallCount: 0,
    }, error);
  }

  return new Response(text, responseInitFrom(response));
};

const captureStreamingResponse = (
  response: Response,
  context: IDeepSeekReasoningContext | undefined,
): Response => {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    pending: '',
    reasoning: '',
    toolCallIds: new Set<string>(),
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();

      if (result.done) {
        try {
          finalizeStreamingCapture(context, decoder, state);
        } catch (error) {
          logReasoningWarning('stream-capture-failed', {
            sessionId: context?.sessionId ?? null,
            runId: context?.runId ?? null,
            toolCallCount: state.toolCallIds.size,
          }, error);
        }
        controller.close();
        return;
      }

      try {
        const text = decoder.decode(result.value, { stream: true });
        processStreamingText(text, state);
      } catch (error) {
        logReasoningWarning('stream-chunk-capture-failed', {
          sessionId: context?.sessionId ?? null,
          runId: context?.runId ?? null,
          toolCallCount: state.toolCallIds.size,
        }, error);
      }

      controller.enqueue(result.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return new Response(body, responseInitFrom(response));
};

const isStreamingResponse = (response: Response): boolean => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.includes('text/event-stream');
};

export const deepseekReasoningFetch: typeof fetch = async (input, init) => {
  const [nextInput, nextInit] = await prepareOutboundRequest(input, init);
  const response = await fetch(nextInput, nextInit);
  const context = deepseekReasoningContext.getStore();

  if (isStreamingResponse(response)) {
    return captureStreamingResponse(response, context);
  }

  return captureNonStreamingResponse(response, context);
};

export const encodeSseLineForTest = (line: string): Uint8Array =>
  textEncoder.encode(line);
