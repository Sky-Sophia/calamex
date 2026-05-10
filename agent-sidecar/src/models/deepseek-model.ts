import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { PROVIDER_REGISTRY, type MastraModelConfig } from '@mastra/core/llm';

import { deepseekReasoningFetch } from './deepseek-reasoning-fetch.js';

const DEFAULT_DEEPSEEK_PROVIDER = 'deepseek';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

export type TDeepSeekModelConfig = MastraModelConfig & {
  readonly modelId: string;
};

const readEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/u, '');

/**
 * 使用 AI SDK OpenAI-compatible provider 创建 DeepSeek 模型配置。
 * 从环境变量读取：DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL（可选）、DEEPSEEK_MODEL（可选）。
 * 返回 null 表示未配置 API Key。
 */
export const createDeepSeekModelConfigFromEnv = (): TDeepSeekModelConfig | null => {
  const apiKey = readEnv('DEEPSEEK_API_KEY');

  if (!apiKey) {
    return null;
  }

  const modelId = readEnv('DEEPSEEK_MODEL') ?? DEFAULT_DEEPSEEK_MODEL;
  const registryEntry = PROVIDER_REGISTRY[DEFAULT_DEEPSEEK_PROVIDER] as { url?: string } | undefined;
  const url = readEnv('DEEPSEEK_BASE_URL') ?? registryEntry?.url ?? 'https://api.deepseek.com';
  const deepseek = createOpenAICompatible<string, never, never, never>({
    name: DEFAULT_DEEPSEEK_PROVIDER,
    baseURL: normalizeBaseUrl(url),
    apiKey,
    fetch: deepseekReasoningFetch,
  });

  return deepseek.chatModel(modelId) as TDeepSeekModelConfig;
};
