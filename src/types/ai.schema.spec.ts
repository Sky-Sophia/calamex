import {
  aiChatPayloadSchema,
  aiChatRequestSchema,
  aiConfigPayloadSchema,
  aiProviderProfilePayloadSchema,
  aiProviderTypeSchema,
} from '@/types/ai.schema';
import { describe, expect, it } from 'vitest';

const reference = {
  id: 'current-file:/tmp/a.sh',
  kind: 'current-file',
  label: 'a.sh',
  path: '/tmp/a.sh',
  range: null,
  contentPreview: 'echo ok',
  redacted: false,
};

const message = {
  id: 'm1',
  role: 'user',
  content: '解释一下',
  createdAt: '2026-04-27T00:00:00.000Z',
  references: [reference],
};

describe('AI schema', () => {
  it('校验 AI 配置不包含密钥字段', () => {
    const parsed = aiConfigPayloadSchema.parse({
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
      narrator: {
        providerType: 'litellm',
        selectedModel: 'zhipu/glm-4-flash',
        baseUrl: 'http://127.0.0.1:4000/v1',
        activeProfileId: null,
        isBaseUrlConfigured: true,
        hasCredentials: false,
        isConfigured: false,
      },
    });

    expect(parsed.providerType).toBe('litellm');
    expect('apiKey' in parsed).toBe(false);
  });

  it('校验 chat 请求必须携带结构化引用', () => {
    const parsed = aiChatRequestSchema.parse({
      threadId: null,
      messages: [message],
      references: [reference],
    });

    expect(parsed.references[0]?.kind).toBe('current-file');
  });

  it('允许图片附件引用携带预览元数据', () => {
    const parsed = aiChatRequestSchema.parse({
      threadId: null,
      messages: [message],
      references: [
        {
          id: 'attachment:screenshot.png:1:4096',
          kind: 'image-attachment',
          label: '图片附件 · screenshot.png',
          path: 'screenshot.png',
          range: null,
          contentPreview: '图片附件',
          redacted: false,
          attachmentPreview: {
            src: 'blob:attachment-preview',
            width: 1280,
            height: 720,
            mimeType: 'image/png',
          },
        },
      ],
    });

    expect(parsed.references[0]?.attachmentPreview?.mimeType).toBe('image/png');
  });

  it('拒绝未知 Provider', () => {
    expect(() =>
      aiConfigPayloadSchema.parse({
        providerType: 'unknown',
        selectedModel: null,
        baseUrl: null,
        activeProfileId: null,
        isBaseUrlConfigured: false,
        hasCredentials: false,
        isConfigured: false,
        inlineCompletionEnabled: false,
        chatEnabled: false,
        agentEnabled: false,
        narrator: {
          providerType: 'litellm',
          selectedModel: 'zhipu/glm-4-flash',
          baseUrl: 'http://127.0.0.1:4000/v1',
          activeProfileId: null,
          isBaseUrlConfigured: true,
          hasCredentials: false,
          isConfigured: false,
        },
      }),
    ).toThrow();
  });

  it('允许 LiteLLM Provider 类型', () => {
    expect(aiProviderTypeSchema.parse('litellm')).toBe('litellm');
  });

  it('配置记录包含模型用途和真实连接状态字段', () => {
    const parsed = aiProviderProfilePayloadSchema.parse({
      id: 'profile-narrator',
      role: 'narrator',
      name: '旁白 GLM',
      providerType: 'litellm',
      selectedModel: 'zhipu/glm-4-flash',
      baseUrl: 'http://127.0.0.1:4000/v1',
      inlineCompletionEnabled: false,
      chatEnabled: false,
      agentEnabled: false,
      hasCredentials: true,
      isConnected: true,
      createdAt: '2026-05-03T00:00:00.000Z',
      updatedAt: '2026-05-03T00:00:00.000Z',
      lastUsedAt: null,
    });

    expect(parsed.role).toBe('narrator');
    expect(parsed.isConnected).toBe(true);
  });

  it('校验 chat 响应消息', () => {
    const parsed = aiChatPayloadSchema.parse({
      providerType: 'litellm',
      model: 'openai/gpt-5.5',
      message: {
        ...message,
        id: 'assistant-1',
        role: 'assistant',
        content: 'Mock 回复',
      },
    });

    expect(parsed.message.role).toBe('assistant');
  });
});
