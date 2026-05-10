<script setup lang="ts">
import type { TAttachmentData, TAttachmentVariant } from '@/components/ai-elements/attachments';
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getAttachmentMediaLabel,
  getMediaCategory,
} from '@/components/ai-elements/attachments';
import type { IAiImageAttachmentPreview } from '@/types/ai';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type TAiImageAttachmentPreviewVariant = 'composer' | 'message';

interface IAiAttachmentPreviewItem {
  id: string;
  name: string;
  preview?: IAiImageAttachmentPreview;
  mediaType?: string;
  detailLabel?: string;
}

interface IPhotoSwipeZoomLevelView {
  fit: number;
  elementSize: {
    x: number;
    y: number;
  } | null;
}

const LIGHTBOX_INITIAL_MAX_WIDTH = 960;
const LIGHTBOX_INITIAL_MAX_HEIGHT = 640;
const LIGHTBOX_VERTICAL_PADDING = 72;
const LIGHTBOX_COMPACT_HORIZONTAL_PADDING = 24;
const LIGHTBOX_DESKTOP_HORIZONTAL_PADDING = 160;
const LIGHTBOX_DESKTOP_MIN_WIDTH = 960;
const LIGHTBOX_SHOW_ANIMATION_DURATION = 0;
const LIGHTBOX_HIDE_ANIMATION_DURATION = 120;
const LIGHTBOX_ZOOM_ANIMATION_DURATION = 160;

const props = withDefaults(
  defineProps<{
    items: readonly IAiAttachmentPreviewItem[];
    ariaLabel?: string;
    removable?: boolean;
    variant?: TAiImageAttachmentPreviewVariant;
  }>(),
  {
    ariaLabel: '附件预览',
    removable: false,
    variant: 'composer',
  },
);

const emit = defineEmits<{
  remove: [id: string];
}>();

const galleryRef = ref<HTMLElement | null>(null);

let lightbox: PhotoSwipeLightbox | null = null;
const imagePreloadHandles = new Map<string, HTMLImageElement>();
const preloadedImageSources = new Set<string>();

const attachmentVariant = computed<TAttachmentVariant>(() =>
  props.variant === 'composer' ? 'inline' : 'grid',
);

const attachmentItems = computed(() =>
  props.items.map((item) => ({
    item,
    data: toAttachmentData(item),
  })),
);

const openableIndexes = computed(() =>
  props.items.reduce<number[]>((indexes, item, index) => {
    if (canOpenItem(item)) {
      indexes.push(index);
    }

    return indexes;
  }, []),
);

const canOpenItem = (item: IAiAttachmentPreviewItem): item is IAiAttachmentPreviewItem & {
  preview: IAiImageAttachmentPreview;
} =>
  Boolean(item.preview?.src) &&
  typeof item.preview?.width === 'number' &&
  item.preview.width > 0 &&
  typeof item.preview?.height === 'number' &&
  item.preview.height > 0;

const toAttachmentData = (item: IAiAttachmentPreviewItem): TAttachmentData => ({
  id: item.id,
  type: 'file',
  url: item.preview?.src ?? '',
  mediaType: item.preview?.mimeType ?? item.mediaType ?? 'application/octet-stream',
  filename: item.name,
});

const openablePreviewSources = computed(() =>
  props.items.reduce<string[]>((sources, item) => {
    if (canOpenItem(item)) {
      sources.push(item.preview.src);
    }

    return sources;
  }, []),
);

const destroyLightbox = (): void => {
  lightbox?.destroy();
  lightbox = null;
};

const releasePreloadHandle = (src: string, image: HTMLImageElement): void => {
  if (imagePreloadHandles.get(src) !== image) {
    return;
  }

  image.onload = null;
  image.onerror = null;
  imagePreloadHandles.delete(src);
};

const completeImagePreload = (src: string, image: HTMLImageElement): void => {
  preloadedImageSources.add(src);
  releasePreloadHandle(src, image);
};

const preloadImagePreview = (src: string): void => {
  if (preloadedImageSources.has(src) || imagePreloadHandles.has(src)) {
    return;
  }

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    if (typeof image.decode !== 'function') {
      completeImagePreload(src, image);
    }
  };
  image.onerror = () => releasePreloadHandle(src, image);
  imagePreloadHandles.set(src, image);
  image.src = src;

  if (typeof image.decode === 'function') {
    void image
      .decode()
      .then(() => completeImagePreload(src, image))
      .catch(() => releasePreloadHandle(src, image));
  } else if (image.complete) {
    completeImagePreload(src, image);
  }
};

const clearImagePreloads = (): void => {
  imagePreloadHandles.forEach((image, src) => {
    releasePreloadHandle(src, image);
  });
};

const resolveLightboxHorizontalPadding = (viewportWidth: number): number => {
  if (viewportWidth < LIGHTBOX_DESKTOP_MIN_WIDTH) {
    return LIGHTBOX_COMPACT_HORIZONTAL_PADDING;
  }

  return LIGHTBOX_DESKTOP_HORIZONTAL_PADDING;
};

const resolveInitialLightboxZoom = (zoomLevel: IPhotoSwipeZoomLevelView): number => {
  if (!zoomLevel.elementSize) {
    return zoomLevel.fit;
  }

  const widthZoom = LIGHTBOX_INITIAL_MAX_WIDTH / zoomLevel.elementSize.x;
  const heightZoom = LIGHTBOX_INITIAL_MAX_HEIGHT / zoomLevel.elementSize.y;

  return Math.min(zoomLevel.fit, widthZoom, heightZoom);
};

const initLightbox = (): void => {
  if (lightbox || !galleryRef.value) {
    return;
  }

  lightbox = new PhotoSwipeLightbox({
    gallery: galleryRef.value,
    children: 'a[data-ai-attachment-preview="image"]',
    pswpModule: () => import('photoswipe'),
    showHideAnimationType: 'none',
    showAnimationDuration: LIGHTBOX_SHOW_ANIMATION_DURATION,
    hideAnimationDuration: LIGHTBOX_HIDE_ANIMATION_DURATION,
    zoomAnimationDuration: LIGHTBOX_ZOOM_ANIMATION_DURATION,
    paddingFn: (viewportSize) => {
      const horizontalPadding = resolveLightboxHorizontalPadding(viewportSize.x);

      return {
        top: LIGHTBOX_VERTICAL_PADDING,
        right: horizontalPadding,
        bottom: LIGHTBOX_VERTICAL_PADDING,
        left: horizontalPadding,
      };
    },
    initialZoomLevel: resolveInitialLightboxZoom,
    secondaryZoomLevel: (zoomLevel) => Math.min(zoomLevel.fit, 1),
    maxZoomLevel: (zoomLevel) => Math.max(1, zoomLevel.fit),
    bgOpacity: 0.78,
    mainClass: 'pswp--ai-attachment-preview',
  });
  lightbox.init();
};

const openImagePreview = (item: IAiAttachmentPreviewItem, index: number): void => {
  if (!canOpenItem(item) || !lightbox) {
    return;
  }

  const openableIndex = openableIndexes.value.indexOf(index);
  if (openableIndex < 0) {
    return;
  }

  lightbox.loadAndOpen(openableIndex);
};

const handleRemove = (id: string): void => {
  emit('remove', id);
};

watch(
  () => openableIndexes.value.length,
  async (count) => {
    if (count === 0) {
      destroyLightbox();
      return;
    }

    await nextTick();
    initLightbox();
  },
  { immediate: true },
);

watch(
  openablePreviewSources,
  (sources) => {
    sources.forEach(preloadImagePreview);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  destroyLightbox();
  clearImagePreloads();
});
</script>

<template>
  <div v-if="items.length" ref="galleryRef" class="ai-image-attachment-preview-grid" :data-variant="variant"
    :aria-label="ariaLabel">
    <Attachments class="ai-attachment-list" :variant="attachmentVariant">
      <template v-for="({ item, data }, index) in attachmentItems" :key="item.id">
        <AttachmentHoverCard v-if="attachmentVariant === 'inline'">
          <AttachmentHoverCardTrigger as-child>
            <Attachment :data="data" class="ai-attachment-card" :data-variant="variant" @remove="handleRemove(item.id)">
              <a v-if="canOpenItem(item)" class="ai-image-attachment-preview-link ai-attachment-preview-frame"
                :class="{ 'is-openable': canOpenItem(item) }" :href="item.preview.src" :data-pswp-src="item.preview.src"
                :data-pswp-width="item.preview.width ?? undefined" :data-pswp-height="item.preview.height ?? undefined"
                data-ai-attachment-preview="image" :aria-label="`查看图片附件 ${item.name}`" :title="item.name"
                @click.prevent="openImagePreview(item, index)">
                <AttachmentPreview class="ai-attachment-preview-media" />
              </a>
              <div v-else class="ai-attachment-preview-frame" :title="item.name">
                <AttachmentPreview class="ai-attachment-preview-media" />
              </div>

              <AttachmentInfo class="ai-attachment-inline-info" />

              <AttachmentRemove v-if="removable" class="ai-image-attachment-preview-remove" label="移除附件" />
            </Attachment>
          </AttachmentHoverCardTrigger>

          <AttachmentHoverCardContent class="ai-attachment-hover-card">
            <div class="ai-attachment-hover-card__content">
              <div v-if="getMediaCategory(data) === 'image' && data.type === 'file' && data.url"
                class="ai-attachment-hover-card__image">
                <img :alt="getAttachmentLabel(data)" :src="data.url" loading="lazy" decoding="async">
              </div>
              <div class="ai-attachment-hover-card__meta">
                <h4>{{ getAttachmentLabel(data) }}</h4>
                <p>{{ getAttachmentMediaLabel(data) }}</p>
                <p v-if="item.detailLabel">{{ item.detailLabel }}</p>
              </div>
            </div>
          </AttachmentHoverCardContent>
        </AttachmentHoverCard>

        <template v-else>
          <Attachment :data="data" class="ai-attachment-card" :data-variant="variant" @remove="handleRemove(item.id)">
            <a v-if="canOpenItem(item)" class="ai-image-attachment-preview-link ai-attachment-preview-frame"
              :class="{ 'is-openable': canOpenItem(item) }" :href="item.preview.src" :data-pswp-src="item.preview.src"
              :data-pswp-width="item.preview.width ?? undefined" :data-pswp-height="item.preview.height ?? undefined"
              data-ai-attachment-preview="image" :aria-label="`查看图片附件 ${item.name}`" :title="item.name"
              @click.prevent="openImagePreview(item, index)">
              <AttachmentPreview class="ai-attachment-preview-media" />
            </a>
            <div v-else class="ai-attachment-preview-frame" :title="item.name">
              <AttachmentPreview class="ai-attachment-preview-media" />
            </div>

            <AttachmentInfo v-if="attachmentVariant === 'inline'" class="ai-attachment-inline-info" />
            <span v-else class="sr-only">{{ item.name }}</span>

            <AttachmentRemove v-if="removable" class="ai-image-attachment-preview-remove" label="移除附件" />
          </Attachment>
        </template>
      </template>
    </Attachments>
  </div>
</template>

<style scoped>
.ai-image-attachment-preview-grid {
  min-width: 0;
}

.ai-image-attachment-preview-grid[data-variant='message'] {
  display: flex;
  justify-content: flex-end;
}

.ai-attachment-list {
  max-width: 100%;
}

.ai-image-attachment-preview-grid[data-variant='composer'] .ai-attachment-list {
  justify-content: flex-start;
}

.ai-image-attachment-preview-grid[data-variant='message'] .ai-attachment-list {
  justify-content: flex-end;
}

.ai-attachment-card {
  border-color: color-mix(in srgb, var(--shell-divider) 82%, transparent);
  background: #ffffff;
  color: var(--text-primary);
}

.ai-attachment-card[data-variant='composer'] {
  max-width: min(100%, 220px);
  border-radius: 8px;
  background: #ffffff;
  padding: 0 6px 0 4px;
  color: var(--text-primary);
}

.ai-attachment-card[data-variant='message'] {
  width: 96px;
  height: 96px;
  border-radius: 12px;
  background: #f4f4f5;
}

.ai-attachment-preview-frame {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--text-tertiary);
  text-decoration: none;
}

.ai-attachment-card[data-variant='composer'] .ai-attachment-preview-frame {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: transparent;
}

.ai-attachment-card[data-variant='message'] .ai-attachment-preview-frame {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: #f4f4f5;
}

.ai-attachment-preview-frame :deep(.ai-attachment-preview-media) {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: transparent;
}

.ai-image-attachment-preview-link.is-openable {
  cursor: pointer;
}

.ai-image-attachment-preview-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 22%, transparent);
  outline-offset: 2px;
}

.ai-attachment-preview-frame :deep(img),
.ai-attachment-preview-frame :deep(video) {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: transparent;
  object-fit: cover;
}

.ai-attachment-card[data-variant='composer'] .ai-attachment-preview-frame :deep(img),
.ai-attachment-card[data-variant='composer'] .ai-attachment-preview-frame :deep(video) {
  object-fit: cover;
}

.ai-attachment-inline-info {
  min-width: 0;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 20px;
}

.ai-image-attachment-preview-remove {
  color: var(--text-tertiary);
}

.ai-attachment-card[data-variant='composer'] .ai-image-attachment-preview-remove {
  position: static;
  flex: 0 0 auto;
  opacity: 1;
}

.ai-attachment-card[data-variant='message'] .ai-image-attachment-preview-remove {
  background: color-mix(in srgb, #ffffff 88%, transparent);
  color: var(--text-secondary);
}

.ai-attachment-hover-card {
  border-color: color-mix(in srgb, var(--shell-divider) 78%, transparent);
  background: #ffffff;
  color: var(--text-primary);
  box-shadow: var(--image-attachment-preview-shadow, var(--image-preview-frame-shadow));
}

.ai-attachment-hover-card__content {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.ai-attachment-hover-card__image {
  display: flex;
  width: 320px;
  max-width: 72vw;
  max-height: 384px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  border-radius: 8px;
  background: #f6f6f7;
}

.ai-attachment-hover-card__image img {
  display: block;
  max-width: 100%;
  max-height: 384px;
  object-fit: contain;
}

.ai-attachment-hover-card__meta {
  min-width: 0;
  padding: 0 2px;
}

.ai-attachment-hover-card__meta h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.ai-attachment-hover-card__meta p {
  margin: 3px 0 0;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 16px;
}

:global(.pswp--ai-attachment-preview .pswp__img),
:global(.pswp--ai-attachment-preview .pswp__img--placeholder) {
  border-radius: var(--image-attachment-preview-radius, 12px);
  background: var(--image-preview-frame-surface);
  box-shadow: var(--image-attachment-preview-shadow, var(--image-preview-frame-shadow));
}

:global(.pswp--ai-attachment-preview .pswp__img--placeholder) {
  object-fit: cover;
}

:global(.pswp--ai-attachment-preview) {
  --pswp-transition-duration: 180ms;
  --pswp-placeholder-bg: var(--image-preview-frame-surface);
}

@media (prefers-reduced-motion: reduce) {
  .ai-attachment-card {
    transition: none;
  }
}
</style>
