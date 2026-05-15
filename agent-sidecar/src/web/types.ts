import { z } from 'zod';

export const AI_WEB_SEARCH_INTENTS = [
  'official-docs',
  'api-reference',
  'error-debug',
  'best-practice',
  'release-notes',
  'general',
] as const;

export const AI_WEB_SEARCH_RECENCIES = ['any', 'day', 'week', 'month', 'year'] as const;

export const AI_WEB_SOURCE_TYPES = [
  'official',
  'docs',
  'github',
  'blog',
  'forum',
  'unknown',
] as const;

const privateIpv4Patterns = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[0-1])\./u,
] as const;

const isAllowedPublicHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();

    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '0.0.0.0'
      || hostname === '::1'
      || hostname === '[::1]'
    ) {
      return false;
    }

    return !privateIpv4Patterns.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
};

export const aiWebSearchIntentSchema = z.enum(AI_WEB_SEARCH_INTENTS);
export const aiWebSearchRecencySchema = z.enum(AI_WEB_SEARCH_RECENCIES);
export const aiWebSourceTypeSchema = z.enum(AI_WEB_SOURCE_TYPES);

export const aiWebSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(240),
  intent: aiWebSearchIntentSchema,
  maxResults: z.number().int().min(1).max(8),
  recency: aiWebSearchRecencySchema.optional(),
});

export const aiWebSearchResultSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string(),
  sourceType: aiWebSourceTypeSchema,
  fetchedAt: z.string().min(1),
});

export const aiWebSearchPayloadSchema = z.object({
  results: z.array(aiWebSearchResultSchema).max(8),
});

export const aiWebFetchInputSchema = z.object({
  url: z.string().trim().min(1).refine(isAllowedPublicHttpUrl, {
    message: 'web_fetch 只允许访问公网 http/https URL。',
  }),
  reason: z.string().trim().min(1).max(240),
  maxBytes: z.number().int().min(1).max(512 * 1024),
});

export const aiWebFetchResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  textRef: z.string().min(1),
  excerpt: z.string(),
  bytes: z.number().int().nonnegative(),
  fetchedAt: z.string().min(1),
  truncated: z.boolean(),
});

export const aiWebFetchPayloadSchema = z.object({
  source: aiWebFetchResultSchema,
});

export type TAiWebSearchInput = z.infer<typeof aiWebSearchInputSchema>;
export type TAiWebSearchPayload = z.infer<typeof aiWebSearchPayloadSchema>;
export type TAiWebFetchInput = z.infer<typeof aiWebFetchInputSchema>;
export type TAiWebFetchPayload = z.infer<typeof aiWebFetchPayloadSchema>;
