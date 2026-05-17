import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  MastraModelGateway,
  type GatewayLanguageModel,
  type ProviderConfig,
} from '@mastra/core/llm';

import { deepseekReasoningFetch } from './deepseek-reasoning-fetch.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const DEFAULT_DEEPSEEK_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
] as const;

const DEFAULT_API_KEY_ENV_VAR = 'AGENT_SIDECAR_API_KEY';

export const AGENT_SIDECAR_MASTRA_GATEWAY_ID = 'agent-sidecar' as const;
export const AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID = 'deepseek' as const;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBaseUrl = (value: string): string =>
  value.trim().replace(/\/+$/u, '');

const assertValidHttpUrl = (value: string, source: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[deepseek-mastra-gateway] ${source} 不是合法的 URL: "${value}"`,
    );
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `[deepseek-mastra-gateway] ${source} 仅允许 http/https 协议，收到: "${url.protocol}"`,
    );
  }
  return value;
};

const dedupeModels = (models: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const buildGatewayProviderModelId = (
  providerId: string,
  modelId: string,
): string =>
  `${AGENT_SIDECAR_MASTRA_GATEWAY_ID}/${providerId}/${modelId}`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IDeepSeekMastraGatewayOptions {
  /** 鉴权 API Key，必填。 */
  apiKey: string;
  /** DeepSeek 兼容服务的 baseURL。默认 https://api.deepseek.com/v1 。 */
  baseUrl?: string | undefined;
  /** 暴露给上层的模型清单。默认两个 deepseek-v4 模型。 */
  models?: readonly string[] | undefined;
  /**
   * Mastra `apiKeyEnvVar` 字段。多 gateway 并存时建议显式区分，
   * 避免不同 sidecar 共用同一个环境变量名。
   */
  apiKeyEnvVar?: string | undefined;
}

const assertPlainOptions = (
  options: IDeepSeekMastraGatewayOptions,
): IDeepSeekMastraGatewayOptions => {
  if (options === null || typeof options !== 'object') {
    throw new Error('[deepseek-mastra-gateway] options 不能为空。');
  }
  return options;
};

// ---------------------------------------------------------------------------
// Gateway 实现
// ---------------------------------------------------------------------------

export class DeepSeekMastraGateway extends MastraModelGateway {
  readonly id = AGENT_SIDECAR_MASTRA_GATEWAY_ID;
  readonly name = 'Agent Sidecar Gateway';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly models: readonly string[];
  private readonly apiKeyEnvVar: string;
  private readonly gatewayPrefix: string;
  private readonly providerPrefix: string;

  constructor(options: IDeepSeekMastraGatewayOptions) {
    super();
    const safeOptions = assertPlainOptions(options);

    const apiKey = toNonEmptyString(safeOptions.apiKey);
    if (!apiKey) {
      throw new Error('[deepseek-mastra-gateway] apiKey 不能为空。');
    }
    this.apiKey = apiKey;

    const rawBaseUrl = toNonEmptyString(safeOptions.baseUrl) ?? DEFAULT_DEEPSEEK_BASE_URL;
    this.baseUrl = assertValidHttpUrl(normalizeBaseUrl(rawBaseUrl), 'baseUrl');

    const requested = safeOptions.models ? dedupeModels(safeOptions.models) : [];
    this.models = requested.length > 0 ? requested : [...DEFAULT_DEEPSEEK_MODELS];

    this.apiKeyEnvVar =
      toNonEmptyString(safeOptions.apiKeyEnvVar) ?? DEFAULT_API_KEY_ENV_VAR;

    this.gatewayPrefix = `${this.id}/${AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID}/`;
    this.providerPrefix = `${AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID}/`;
  }

  // -------------------------------------------------------------------------
  // 内部辅助
  // -------------------------------------------------------------------------

  /** 判断给定 modelId 是否属于本 gateway。 */
  private matchesThisGateway(modelId: string): boolean {
    if (modelId === AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID) return true;
    if (modelId.startsWith(this.gatewayPrefix)) {
      return modelId.length > this.gatewayPrefix.length;
    }
    if (modelId.startsWith(this.providerPrefix)) {
      return modelId.length > this.providerPrefix.length;
    }
    return false;
  }

  /** 把可能带前缀的 modelId 还原为 DeepSeek 原生 modelId。 */
  private stripGatewayPrefix(modelId: string): string {
    if (modelId.startsWith(this.gatewayPrefix)) {
      return modelId.slice(this.gatewayPrefix.length);
    }
    if (modelId.startsWith(this.providerPrefix)) {
      return modelId.slice(this.providerPrefix.length);
    }
    return modelId;
  }

  // -------------------------------------------------------------------------
  // MastraModelGateway 接口
  // -------------------------------------------------------------------------

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      [AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID]: {
        url: this.baseUrl,
        apiKeyEnvVar: this.apiKeyEnvVar,
        apiKeyHeader: 'Authorization',
        name: 'DeepSeek',
        models: [...this.models],
        gateway: this.id,
      },
    };
  }

  override buildUrl(
    modelId: string,
    _envVars: Record<string, string> = {},
  ): string | undefined {
    const normalized = modelId.trim();
    if (!normalized) return undefined;
    return this.matchesThisGateway(normalized) ? this.baseUrl : undefined;
  }

  override async getApiKey(_modelId: string): Promise<string> {
    return this.apiKey;
  }

  override async resolveLanguageModel(args: {
    modelId: string;
    providerId: string;
    apiKey: string;
    headers?: Record<string, string>;
  }): Promise<GatewayLanguageModel> {
    if (args.providerId !== AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID) {
      throw new Error(
        `[deepseek-mastra-gateway] 不支持的 provider: ${args.providerId}`,
      );
    }

    const effectiveApiKey = toNonEmptyString(args.apiKey) ?? this.apiKey;
    const nativeModelId = this.stripGatewayPrefix(args.modelId.trim());
    if (!nativeModelId) {
      throw new Error('[deepseek-mastra-gateway] modelId 不能为空。');
    }

    return createOpenAICompatible({
      name: args.providerId,
      apiKey: effectiveApiKey,
      baseURL: this.baseUrl,
      ...(args.headers ? { headers: args.headers } : {}),
      fetch: deepseekReasoningFetch,
      supportsStructuredOutputs: true,
    }).chatModel(nativeModelId);
  }

  override serializeForSpan(): {
    id: string;
    name: string;
    provider: string;
    modelCount: number;
  } {
    return {
      id: this.id,
      name: this.name,
      provider: AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID,
      modelCount: this.models.length,
    };
  }
}

// ---------------------------------------------------------------------------
// 工厂 / 助手导出
// ---------------------------------------------------------------------------

export const createDeepSeekMastraGateway = (
  options: IDeepSeekMastraGatewayOptions,
): DeepSeekMastraGateway => new DeepSeekMastraGateway(options);

export const createDeepSeekGatewayModelId = (modelId: string): string =>
  buildGatewayProviderModelId(AGENT_SIDECAR_DEEPSEEK_PROVIDER_ID, modelId);