import { z } from 'zod';

export const aiContextKindSchema = z.enum([
  'current-file',
  'selection',
  'cursor-window',
  'diagnostics',
  'git-diff',
  'terminal-log',
  'search-result',
  'image-attachment',
  'symbol-definition',
  'symbol-references',
  'project-tree',
]);

export const aiContextRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

export const aiImageAttachmentPreviewSchema = z.object({
  src: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mimeType: z.string().min(1),
});

export const aiContextReferenceSchema = z.object({
  id: z.string().min(1),
  kind: aiContextKindSchema,
  label: z.string().min(1),
  path: z.string().nullable(),
  range: aiContextRangeSchema.nullable(),
  contentPreview: z.string(),
  redacted: z.boolean(),
  attachmentPreview: aiImageAttachmentPreviewSchema.optional(),
});
