import { computed, inject, type InjectionKey, type Ref } from 'vue';
import type { TAttachmentData, TAttachmentMediaCategory, TAttachmentVariant } from './types';

export interface IAttachmentsContextValue {
  variant: Ref<TAttachmentVariant>;
}

export const AttachmentsKey: InjectionKey<IAttachmentsContextValue> = Symbol('Attachments');

export function useAttachmentsContext(): IAttachmentsContextValue {
  const context = inject(AttachmentsKey);

  if (context) {
    return context;
  }

  return {
    variant: computed(() => 'grid'),
  };
}

export interface IAttachmentContextValue {
  data: Ref<TAttachmentData>;
  mediaCategory: Ref<TAttachmentMediaCategory>;
  remove?: () => void;
  variant: Ref<TAttachmentVariant>;
}

export const AttachmentKey: InjectionKey<IAttachmentContextValue> = Symbol('Attachment');

export function useAttachmentContext(): IAttachmentContextValue {
  const context = inject(AttachmentKey);

  if (!context) {
    throw new Error('Attachment 组件必须在 <Attachment> 内使用');
  }

  return context;
}
