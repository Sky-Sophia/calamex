import { aiService } from '@/services/modules/ai';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiStore } from './ai';
import { createDefaultAiModelEndpointConfig } from '@/utils/ai-config';

const tauriServiceMock = vi.hoisted(() => ({
  aiGetConfig: vi.fn(),
  aiSaveConfig: vi.fn(),
  aiSaveCredentials: vi.fn(),
  aiClearCredentials: vi.fn(),
  aiTestProvider: vi.fn(),
  aiTestProviderConfig: vi.fn(),
  aiConnectProvider: vi.fn(),
  aiChat: vi.fn(),
  aiChatStream: vi.fn(),
  aiCancel: vi.fn(),
  onAiChatStream: vi.fn(),
  aiInlineComplete: vi.fn(),
  aiCodeAction: vi.fn(),
  aiPlanTask: vi.fn(),
  aiBuildIndex: vi.fn(),
  aiQueryIndex: vi.fn(),
  aiProposePatch: vi.fn(),
  aiApplyPatch: vi.fn(),
  aiListTools: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
  tauriService: tauriServiceMock,
}));

describe('AI service and store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('service 通过统一 tauriService 调用 chat', async () => {
    const payload = {
      providerType: 'litellm',
      model: 'openai/gpt-5.5',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: 'ok',
        createdAt: '2026-04-27T00:00:00.000Z',
        references: [],
      },
    };
    tauriServiceMock.aiChat.mockResolvedValueOnce(payload);

    await expect(aiService.chat({ threadId: null, messages: [payload.message], references: [] }))
      .resolves.toBe(payload);
  });

  it('store 只保存非敏感配置', async () => {
    tauriServiceMock.aiGetConfig.mockResolvedValueOnce({
      providerType: 'litellm',
      selectedModel: 'openai/gpt-5.5',
      baseUrl: 'http://127.0.0.1:4000/v1',
      activeProfileId: null,
      isBaseUrlConfigured: true,
      hasCredentials: false,
      isConfigured: true,
      inlineCompletionEnabled: false,
      chatEnabled: true,
      agentEnabled: false,
      narrator: createDefaultAiModelEndpointConfig('zhipu/glm-4-flash'),
    });

    const store = useAiStore();
    await store.loadConfig();

    expect(store.config.providerType).toBe('litellm');
    expect('apiKey' in store.config).toBe(false);
  });

  it('connectProvider 成功后只落非敏感 config，不把 apiKey 放进 store', async () => {
    tauriServiceMock.aiConnectProvider.mockResolvedValueOnce({
      config: {
        providerType: 'litellm',
        selectedModel: 'openai/gpt-5.5',
        baseUrl: 'http://127.0.0.1:4000/v1',
        activeProfileId: null,
        isBaseUrlConfigured: true,
        hasCredentials: true,
        isConfigured: true,
        inlineCompletionEnabled: true,
        chatEnabled: true,
        agentEnabled: false,
        narrator: createDefaultAiModelEndpointConfig('zhipu/glm-4-flash'),
      },
      test: {
        ok: true,
        code: 'AI_PROVIDER_READY',
        message: 'AI Provider 可用。',
      },
    });

    const store = useAiStore();
    await store.connectProvider({
      providerType: 'litellm',
      selectedModel: 'openai/gpt-5.5',
      baseUrl: 'http://127.0.0.1:4000/v1',
      inlineCompletionEnabled: true,
      chatEnabled: true,
      agentEnabled: false,
      apiKey: 'sk-test-secret-value',
    });

    expect(store.config.providerType).toBe('litellm');
    expect(store.config.hasCredentials).toBe(true);
    expect('apiKey' in store.config).toBe(false);
  });
});
