import { z } from 'zod';

import {
  aiSuggestionPoolPayloadSchema,
  aiSuggestionPoolRequestSchema,
} from '@/types/ai.schema';

export const aiSuggestionTextSchema = z.string().trim().min(1).max(120);

export const aiSuggestionPoolItemSchema = z.object({
  id: z.string().trim().min(1),
  text: aiSuggestionTextSchema,
  source: z.enum(['fallback', 'local', 'generated']),
});

export const aiSuggestionSelectionSchema = z.object({
  selectedText: aiSuggestionTextSchema,
  selectedAt: z.string().trim().min(1),
});

export const aiSuggestionLayoutSchema = z.object({
  visibleCount: z.number().int().min(0).max(12),
  columnCount: z.number().int().min(1).max(4),
});

export {
  aiSuggestionPoolPayloadSchema,
  aiSuggestionPoolRequestSchema,
};
