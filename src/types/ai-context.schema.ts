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

/**
 * 行号区间(1-based,inclusive)。
 *
 * Invariant: `endLine >= startLine`。schema 在此处显式强制,避免下游消费方
 * 做行数计算 / 选区高亮时收到 negative span。
 */
export const aiContextRangeSchema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((range) => range.endLine >= range.startLine, {
    message: 'endLine must be greater than or equal to startLine.',
    path: ['endLine'],
  });

export const aiImageAttachmentPreviewSchema = z.object({
  src: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  mimeType: z.string().min(1),
});

/**
 * 上下文引用。
 *
 * - `path`:`null` 表"无关联文件路径"(例如 `terminal-log`、`search-result`)。
 *   注意非 null 时强制 `.min(1)`——空字符串会被拒绝,避免 `""` 进入 fs / glob
 *   下游被误判。
 * - `attachmentPreview`:**约定**仅在 `kind === 'image-attachment'` 时设置。
 *   schema 没有强制 discriminated union(避免对现有 wire 协议做 breaking 改造);
 *   消费方应自行 narrow 后再访问该字段。
 */
export const aiContextReferenceSchema = z.object({
  id: z.string().min(1),
  kind: aiContextKindSchema,
  label: z.string().min(1),
  path: z.string().min(1).nullable(),
  range: aiContextRangeSchema.nullable(),
  contentPreview: z.string(),
  redacted: z.boolean(),
  attachmentPreview: aiImageAttachmentPreviewSchema.optional(),
});