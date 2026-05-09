<script setup lang="ts">
import type { IAiImageAttachmentPreview } from '@/types/ai';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';

type TAiImageAttachmentPreviewVariant = 'composer' | 'message';

interface IAiImageAttachmentPreviewItem {
  id: string;
  name: string;
  preview: IAiImageAttachmentPreview;
}

const props = withDefaults(
  defineProps<{
    items: readonly IAiImageAttachmentPreviewItem[];
    ariaLabel?: string;
    removable?: boolean;
    variant?: TAiImageAttachmentPreviewVariant;
  }>(),
  {
    ariaLabel: '图片附件预览',
    removable: false,
    variant: 'composer',
  },
);

const emit = defineEmits<{
  remove: [id: string];
}>();

const galleryRef = ref<HTMLElement | null>(null);

let lightbox: PhotoSwipeLightbox | null = null;

const openableIndexes = computed(() =>
  props.items.reduce<number[]>((indexes, item, index) => {
    if (
      typeof item.preview.width === 'number' &&
      item.preview.width > 0 &&
      typeof item.preview.height === 'number' &&
      item.preview.height > 0
    ) {
      indexes.push(index);
    }

    return indexes;
  }, []),
);

const canOpenItem = (item: IAiImageAttachmentPreviewItem): boolean =>
  typeof item.preview.width === 'number' &&
  item.preview.width > 0 &&
  typeof item.preview.height === 'number' &&
  item.preview.height > 0;

const destroyLightbox = (): void => {
  lightbox?.destroy();
  lightbox = null;
};

const initLightbox = (): void => {
  if (lightbox || !galleryRef.value) {
    return;
  }

  lightbox = new PhotoSwipeLightbox({
    gallery: galleryRef.value,
    children: 'a[data-ai-attachment-preview="image"]',
    pswpModule: () => import('photoswipe'),
    showHideAnimationType: 'zoom',
    bgOpacity: 0.78,
    mainClass: 'pswp--ai-attachment-preview',
  });
  lightbox.init();
};

const openImagePreview = (item: IAiImageAttachmentPreviewItem, index: number): void => {
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

onBeforeUnmount(() => {
  destroyLightbox();
});
</script>

<template>
  <div
    v-if="items.length"
    ref="galleryRef"
    class="ai-image-attachment-preview-grid"
    :data-variant="variant"
    :aria-label="ariaLabel"
  >
    <article
      v-for="(item, index) in items"
      :key="item.id"
      class="ai-image-attachment-preview-card"
      :data-variant="variant"
    >
      <a
        class="ai-image-attachment-preview-link"
        :class="{ 'is-openable': canOpenItem(item) }"
        :href="item.preview.src"
        :data-pswp-src="item.preview.src"
        :data-pswp-width="item.preview.width ?? undefined"
        :data-pswp-height="item.preview.height ?? undefined"
        :data-ai-attachment-preview="canOpenItem(item) ? 'image' : undefined"
        :aria-label="`查看图片附件 ${item.name}`"
        :title="item.name"
        @click.prevent="openImagePreview(item, index)"
      >
        <img
          :src="item.preview.src"
          :alt="item.name"
          loading="lazy"
          decoding="async"
          draggable="false"
        >
      </a>

      <button
        v-if="removable"
        type="button"
        class="ai-image-attachment-preview-remove"
        aria-label="移除图片附件"
        @click.stop="handleRemove(item.id)"
      >
        <X aria-hidden="true" />
      </button>
    </article>
  </div>
</template>

<style scoped>
.ai-image-attachment-preview-grid {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 10px;
}

.ai-image-attachment-preview-grid[data-variant='message'] {
  justify-content: flex-end;
}

.ai-image-attachment-preview-card {
  position: relative;
  flex: 0 0 auto;
}

.ai-image-attachment-preview-card[data-variant='composer'] {
  --ai-image-attachment-preview-radius: 9px;
  width: 112px;
  height: 76px;
}

.ai-image-attachment-preview-card[data-variant='message'] {
  --ai-image-attachment-preview-radius: 12px;
  width: 148px;
  height: 104px;
  max-width: min(40vw, 148px);
}

.ai-image-attachment-preview-link {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--ai-image-attachment-preview-radius, var(--image-attachment-preview-radius, 12px));
  background: var(--image-preview-frame-surface);
  box-shadow: var(--image-attachment-preview-shadow, var(--image-preview-frame-shadow));
  transition:
    transform var(--motion-duration-normal) var(--motion-easing-emphasized),
    box-shadow var(--motion-duration-normal) var(--motion-easing-standard);
}

.ai-image-attachment-preview-link.is-openable {
  cursor: pointer;
}

.ai-image-attachment-preview-link:hover {
  transform: translateY(-1px);
}

.ai-image-attachment-preview-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 22%, transparent);
  outline-offset: 2px;
}

.ai-image-attachment-preview-link img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--image-preview-frame-surface);
}

.ai-image-attachment-preview-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  color: var(--text-secondary);
  cursor: pointer;
  backdrop-filter: blur(10px);
  opacity: 0;
  pointer-events: none;
  transform: scale(0.92);
  transition:
    opacity var(--motion-duration-fast) var(--motion-easing-standard),
    background-color var(--motion-duration-fast) var(--motion-easing-standard),
    color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.ai-image-attachment-preview-card:hover .ai-image-attachment-preview-remove,
.ai-image-attachment-preview-card:focus-within .ai-image-attachment-preview-remove {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}

.ai-image-attachment-preview-remove:hover {
  background: var(--panel-bg);
  color: var(--text-primary);
  transform: scale(1.03);
}

.ai-image-attachment-preview-remove:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 24%, transparent);
  outline-offset: 2px;
}

.ai-image-attachment-preview-remove svg {
  width: 12px;
  height: 12px;
}

:global(.pswp--ai-attachment-preview .pswp__img) {
  border-radius: var(--image-attachment-preview-radius, 12px);
  background: var(--image-preview-frame-surface);
  box-shadow: var(--image-attachment-preview-shadow, var(--image-preview-frame-shadow));
}

@media (prefers-reduced-motion: reduce) {
  .ai-image-attachment-preview-link,
  .ai-image-attachment-preview-remove {
    transition: none;
  }
}
</style>
