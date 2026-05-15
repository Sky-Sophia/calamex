interface IRedactedTextSummary {
  redacted: true;
  chars: number;
  estimatedBytes: number;
}

const SENSITIVE_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'clientsecret',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'token',
]);

const MAX_REDACTION_DEPTH = 8;
const REDACTED_TOKEN = '[REDACTED]';
const AUTHORIZATION_HEADER_SECRET_PATTERN =
  /\b(authorization|proxy-authorization)\s*[:=]\s*(?:Bearer\s+)?["']?([^\s"',;}\]]+)/gi;
const KEY_VALUE_SECRET_PATTERN =
  /\b(x-api-key|api[_-]?key)\s*[:=]\s*["']?([^\s"',;}\]]+)/gi;
const BEARER_SECRET_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/g;
const OPENAI_STYLE_KEY_PATTERN = /\b(sk-[A-Za-z0-9][A-Za-z0-9._-]{8,})\b/g;

const normalizeFieldName = (field: string): string =>
  field.replace(/[\s_-]/g, '').toLowerCase();

const estimateTextBytes = (value: string): number =>
  typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length;

export const createRedactedTextSummary = (value: string): IRedactedTextSummary => ({
  redacted: true,
  chars: [...value].length,
  estimatedBytes: estimateTextBytes(value),
});

const isSensitiveFieldName = (field: string): boolean =>
  SENSITIVE_FIELD_NAMES.has(normalizeFieldName(field));

export const redactSensitiveText = (value: string): string =>
  value
    .replace(
      AUTHORIZATION_HEADER_SECRET_PATTERN,
      (_match, key: string) => `${key}: ${REDACTED_TOKEN}`,
    )
    .replace(KEY_VALUE_SECRET_PATTERN, (_match, key: string) => `${key}: ${REDACTED_TOKEN}`)
    .replace(BEARER_SECRET_PATTERN, `Bearer ${REDACTED_TOKEN}`)
    .replace(OPENAI_STYLE_KEY_PATTERN, 'sk-[REDACTED]');

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;

const summarizeSensitiveValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return createRedactedTextSummary(value);
  }

  if (value === null || value === undefined) {
    return value;
  }

  return { redacted: true };
};

const redactRecord = (
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [field, fieldValue] of Object.entries(value)) {
    result[field] = isSensitiveFieldName(field)
      ? summarizeSensitiveValue(fieldValue)
      : redactForLogInternal(fieldValue, depth + 1, seen);
  }

  return result;
};

const redactError = (value: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> => {
  const cause = 'cause' in value ? value.cause : undefined;
  return {
    name: value.name,
    message: redactSensitiveText(value.message),
    ...(cause === undefined ? {} : { cause: redactForLogInternal(cause, depth + 1, seen) }),
  };
};

const redactForLogInternal = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return `[${typeof value}]`;
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return '[MaxDepth]';
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return redactError(value, depth, seen);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactForLogInternal(item, depth + 1, seen));
  }

  if (isPlainRecord(value)) {
    return redactRecord(value, depth, seen);
  }

  return redactSensitiveText(String(value));
};

export const redactForLog = (value: unknown): unknown =>
  redactForLogInternal(value, 0, new WeakSet<object>());
