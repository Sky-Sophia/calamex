const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

export interface IDeepSeekModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const readEnv = (key: string): string | null => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

export const createDeepSeekModelConfigFromEnv = (): IDeepSeekModelConfig | null => {
  const apiKey = readEnv('DEEPSEEK_API_KEY');

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: readEnv('DEEPSEEK_BASE_URL') ?? DEFAULT_DEEPSEEK_BASE_URL,
    model: readEnv('DEEPSEEK_MODEL') ?? DEFAULT_DEEPSEEK_MODEL,
  };
};
