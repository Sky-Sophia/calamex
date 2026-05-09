import { ModelRouterLanguageModel, PROVIDER_REGISTRY } from '@mastra/core/llm';

const DEFAULT_DEEPSEEK_PROVIDER = 'deepseek';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

const readEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

/**
 * 使用 Mastra 官方 ModelRouterLanguageModel 创建 DeepSeek 模型配置。
 * 从环境变量读取：DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL（可选）、DEEPSEEK_MODEL（可选）。
 * 返回 null 表示未配置 API Key。
 */
export const createDeepSeekModelConfigFromEnv = (): ModelRouterLanguageModel | null => {
  const apiKey = readEnv('DEEPSEEK_API_KEY');

  if (!apiKey) {
    return null;
  }

  const modelId = readEnv('DEEPSEEK_MODEL') ?? DEFAULT_DEEPSEEK_MODEL;
  const registryEntry = PROVIDER_REGISTRY[DEFAULT_DEEPSEEK_PROVIDER] as { url?: string } | undefined;
  const url = readEnv('DEEPSEEK_BASE_URL') ?? registryEntry?.url;

  return new ModelRouterLanguageModel({
    providerId: DEFAULT_DEEPSEEK_PROVIDER,
    modelId,
    apiKey,
    ...(url ? { url } : {}),
  });
};
