import type { TAiProviderType } from '@/types/ai';

export interface IAiProviderPreset {
  id: TAiProviderType;
  label: string;
  description: string;
  baseUrl: string | null;
  defaultModel: string;
  models: readonly string[];
  apiKeyHint: string;
  iconUrl: string | null;
  isEndpointEditable: boolean;
  isAvailable: boolean;
}

const LOBE_ICONS_BASE_URL =
  'https://unpkg.com/@lobehub/icons-static-svg@latest/icons' as const;

/**
 * 本地 mock provider，同时也是 `findAiProviderPreset` 在未命中时的安全兜底。
 * 抽到 `AI_PROVIDER_PRESETS` 之外是为了让 fallback 语义显式、且不依赖数组下标。
 */
const MOCK_PROVIDER_PRESET = {
  id: 'mock',
  label: 'MockProvider',
  description: '本地测试 Provider，不需要 API Key。',
  baseUrl: null,
  defaultModel: 'mock-ide-assistant',
  models: ['mock-ide-assistant'],
  apiKeyHint: '无需配置',
  iconUrl: null,
  isEndpointEditable: false,
  isAvailable: true,
} as const satisfies IAiProviderPreset;

export const AI_PROVIDER_PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'OpenAI 官方 API，兼容 /v1/chat/completions。',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.5',
    models: [
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
    ],
    apiKeyHint: 'sk-xxxxxxxxxxxxx',
    iconUrl: `${LOBE_ICONS_BASE_URL}/openai.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek 官方 OpenAI-compatible API。',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-pro',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    apiKeyHint: 'sk-xxxxxxxxxxxxx',
    iconUrl: `${LOBE_ICONS_BASE_URL}/deepseek-color.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    description: 'Moonshot AI OpenAI-compatible API。',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    models: ['kimi-k2.6'],
    apiKeyHint: 'sk-xxxxxxxxxxxxx',
    iconUrl: `${LOBE_ICONS_BASE_URL}/moonshot.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 / DashScope',
    description: 'DashScope 兼容 OpenAI 模式。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-max',
    models: [
      'qwen3-max',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-plus',
      'qwen3-coder-next',
    ],
    apiKeyHint: 'sk-xxxxxxxxxxxxx',
    iconUrl: `${LOBE_ICONS_BASE_URL}/qwen-color.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    description: '智谱 OpenAI-compatible API。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5.1', 'glm-4.6v'],
    apiKeyHint: '填写智谱 API Key',
    iconUrl: `${LOBE_ICONS_BASE_URL}/zhipu-color.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    description: 'SiliconFlow OpenAI-compatible API。',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Pro',
    models: [
      'deepseek-ai/DeepSeek-V4-Pro',
      'deepseek-ai/DeepSeek-V4-Flash',
      'Pro/moonshotai/Kimi-K2.6',
      'Pro/zai-org/GLM-5.1',
      'Pro/MiniMaxAI/MiniMax-M2.5',
      'tencent/Hy3-preview',
    ],
    apiKeyHint: 'sk-xxxxxxxxxxxxx',
    iconUrl: `${LOBE_ICONS_BASE_URL}/siliconcloud-color.svg`,
    isEndpointEditable: false,
    isAvailable: true,
  },
  {
    id: 'claude-compatible',
    label: 'Claude',
    description: '规划中：需单独 Provider adapter，不伪装为已接入。',
    baseUrl: null,
    defaultModel: 'claude-3-5-sonnet-latest',
    models: ['claude-3-5-sonnet-latest'],
    apiKeyHint: '暂不支持保存',
    iconUrl: `${LOBE_ICONS_BASE_URL}/claude-color.svg`,
    isEndpointEditable: false,
    isAvailable: false,
  },
  MOCK_PROVIDER_PRESET,
] as const satisfies readonly IAiProviderPreset[];

/**
 * 通过 provider 类型查找预设。未命中时回退到 mock preset，
 * 以便调用点不必对 `undefined` 做防御处理。
 */
export const findAiProviderPreset = (
  providerType: TAiProviderType,
): IAiProviderPreset =>
  AI_PROVIDER_PRESETS.find((preset) => preset.id === providerType) ??
  MOCK_PROVIDER_PRESET;