import {
  aiProviderCatalogEntrySchema,
  aiCredentialStatusPayloadSchema,
  aiProviderTypeSchema,
} from '@/types/ai/provider.schema';
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

  it('校验 provider credential wire payload', () => {
    const credential = aiCredentialStatusPayloadSchema.parse({
      providerId: 'deepseek',
      hasCredentials: true,
    });

    expect(credential.providerId).toBe('deepseek');
  });
});
