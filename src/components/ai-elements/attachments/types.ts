import type { FileUIPart, SourceDocumentUIPart } from 'ai';

export type TAttachmentData =
  | (FileUIPart & { id: string })
  | (SourceDocumentUIPart & { id: string });

export type TAttachmentMediaCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'source'
  | 'unknown';

export type TAttachmentVariant = 'grid' | 'inline' | 'list';
