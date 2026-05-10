import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import PromptInputAttachmentsDisplay from '@/components/ai-elements/prompt-input/PromptInputAttachmentsDisplay.vue';
import type { IAiAttachedFile } from '@/types/ai';

type TLightboxZoomLevelResolver = (zoomLevel: {
  fit: number;
  elementSize: {
    x: number;
    y: number;
  } | null;
}) => number;

const getLightboxZoomLevelResolver = (value: unknown): TLightboxZoomLevelResolver => {
  if (typeof value !== 'function') {
    throw new Error('PhotoSwipe 初始缩放配置缺失');
  }

  return (zoomLevel) => {
    const result: unknown = value(zoomLevel);

    if (typeof result !== 'number') {
      throw new Error('PhotoSwipe 初始缩放配置必须返回数字');
    }

    return result;
  };
};

const lightboxMock = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    init: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    loadAndOpen: ReturnType<typeof vi.fn>;
  }> = [];

  const ctor = vi.fn(function MockPhotoSwipeLightbox(this: Record<string, unknown>, options: Record<string, unknown>) {
    const instance = {
      options,
      init: vi.fn(),
      destroy: vi.fn(),
      loadAndOpen: vi.fn(() => true),
    };

    instances.push(instance);
    Object.assign(this, instance);
  });

  return { ctor, instances };
});

vi.mock('photoswipe/lightbox', () => ({
  default: lightboxMock.ctor,
}));

const createImageAttachment = (): IAiAttachedFile => ({
  id: 'image-1',
  name: 'pasted-image.png',
  sizeLabel: '4.5 KB',
  kind: 'image',
  detailLabel: '665 × 329',
  preview: {
    src: 'data:image/png;base64,ZmFrZQ==',
    width: 665,
    height: 329,
    mimeType: 'image/png',
  },
  reference: {
    id: 'attachment:pasted-image.png:1:4608',
    kind: 'image-attachment',
    label: '图片附件 · pasted-image.png',
    path: 'pasted-image.png',
    range: null,
    contentPreview: '图片附件',
    redacted: false,
  },
});

const createTextAttachment = (): IAiAttachedFile => ({
  id: 'file-1',
  name: 'README.md',
  sizeLabel: '2.4 KB',
  kind: 'text',
  reference: {
    id: 'attachment:README.md:1:2400',
    kind: 'search-result',
    label: '附件 · README.md',
    path: 'README.md',
    range: null,
    contentPreview: 'README',
    redacted: false,
  },
});

describe('PromptInputAttachmentsDisplay', () => {
  beforeEach(() => {
    lightboxMock.instances.length = 0;
    lightboxMock.ctor.mockClear();
  });

  it('为图片附件渲染缩略图并接入 PhotoSwipe', async () => {
    const wrapper = mount(PromptInputAttachmentsDisplay, {
      props: {
        attachments: [createImageAttachment()],
      },
    });

    await nextTick();

    expect(lightboxMock.ctor).toHaveBeenCalledTimes(1);
    expect(lightboxMock.instances[0]?.init).toHaveBeenCalledTimes(1);
    expect(lightboxMock.instances[0]?.options).toMatchObject({
      showHideAnimationType: 'none',
      showAnimationDuration: 0,
      hideAnimationDuration: 120,
      zoomAnimationDuration: 160,
    });
    const resolveInitialZoom = getLightboxZoomLevelResolver(
      lightboxMock.instances[0]?.options.initialZoomLevel,
    );
    expect(
      resolveInitialZoom({
        fit: 1,
        elementSize: {
          x: 1224,
          y: 609,
        },
      }),
    ).toBeCloseTo(960 / 1224);
    expect(wrapper.find('.ai-image-attachment-preview-link').exists()).toBe(true);
    expect(wrapper.get('.ai-image-attachment-preview-link').attributes('data-pswp-width')).toBe(
      '665',
    );
    expect(wrapper.get('.ai-image-attachment-preview-link img').attributes('src')).toBe(
      'data:image/png;base64,ZmFrZQ==',
    );
    expect(wrapper.text()).not.toContain('665 × 329');
    expect(wrapper.text()).not.toContain('4.5 KB');

    await wrapper.get('.ai-image-attachment-preview-link').trigger('click');
    expect(lightboxMock.instances[0]?.loadAndOpen).toHaveBeenCalledWith(0);

    await wrapper.get('.ai-image-attachment-preview-remove').trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['image-1']]);

    wrapper.unmount();
    expect(lightboxMock.instances[0]?.destroy).toHaveBeenCalledTimes(1);
  });

  it('保留文本附件胶囊展示', () => {
    const wrapper = mount(PromptInputAttachmentsDisplay, {
      props: {
        attachments: [createTextAttachment()],
      },
    });

    expect(wrapper.find('.ai-attachment-card[data-variant="composer"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('README.md');
    expect(wrapper.find('.ai-image-attachment-preview-link').exists()).toBe(false);
    expect(lightboxMock.ctor).not.toHaveBeenCalled();
  });
});
