import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const DEFAULT_STRANDS_SESSION_DIR = '.strands-sessions';
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9_-]+$/;

const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

export const getOfficialAcontextSessionDir = (): string => {
  const configuredDir = readOptionalEnv('AGENT_SIDECAR_SESSION_DIR');

  if (!configuredDir) {
    return resolve(process.cwd(), DEFAULT_STRANDS_SESSION_DIR);
  }

  return isAbsolute(configuredDir)
    ? resolve(configuredDir)
    : resolve(process.cwd(), configuredDir);
};

export const createSafeStrandsSessionId = (sessionId: string): string => {
  const normalized = sessionId.normalize('NFKC').trim().toLowerCase();

  if (SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    return normalized;
  }

  const readablePart = normalized
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48);
  const digest = createHash('sha256')
    .update(sessionId, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return `${readablePart || 'session'}_${digest}`;
};
