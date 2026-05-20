import {
  aiProviderCatalogEntrySchema,
  aiProviderProfilePayloadSchema,
  aiProviderTypeSchema,
} from '@/types/ai-provider.schema';
import { describe, expect, it } from 'vitest';

describe('AI provider schema', () => {
  it('校验 provider 类型和目录项', () => {
    expect(aiProviderTypeSchema.parse('mastra')).toBe('mastra');

    const entry = aiProviderCatalogEntrySchema.parse({
      providerType: 'mastra',
      label: 'Mastra',
      roles: ['main', 'narrator'],
      modelIds: ['deepseek-chat'],
    });

    expect(entry.roles).toContain('narrator');
    expect(() => aiProviderTypeSchema.parse('deepseek')).toThrow();
  });

  it('校验 provider profile wire payload', () => {
    const profile = aiProviderProfilePayloadSchema.parse({
      id: 'profile-1',
      role: 'main',
      name: '默认模型',
      providerType: 'mastra',
      selectedModel: 'deepseek-chat',
      baseUrl: null,
      inlineCompletionEnabled: true,
      chatEnabled: true,
      agentEnabled: true,
      hasCredentials: true,
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
      lastUsedAt: null,
    });

    expect(profile.isConnected).toBe(false);
  });
});
