<script setup lang="ts">
import { findAiProviderIconDefinition } from '@/constants/ai-provider-icons';
import type { TAiServicePlatformId } from '@/constants/ai-providers';
import { computed, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  platformId: TAiServicePlatformId;
  title?: string;
  decorative?: boolean;
}>(), {
  title: '',
  decorative: false,
});

const iconDefinition = computed(() => findAiProviderIconDefinition(props.platformId));
const titleText = computed(() => props.title.trim() || iconDefinition.value.label);
const hasImageError = ref(false);
const canShowImage = computed(() => Boolean(iconDefinition.value.iconUrl) && !hasImageError.value);
const shouldShowNeutralFallback = computed(() => !canShowImage.value);

watch(
  () => iconDefinition.value.iconUrl,
  () => {
    hasImageError.value = false;
  },
);
</script>

<template>
  <span
    class="ai-provider-icon"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : titleText"
    :aria-hidden="decorative ? 'true' : undefined"
    :style="{ '--ai-provider-icon-bg': iconDefinition.background }"
  >
    <img
      v-if="canShowImage"
      class="ai-provider-icon__image"
      :src="iconDefinition.iconUrl ?? ''"
      :alt="decorative ? '' : titleText"
      draggable="false"
      @error="hasImageError = true"
    />
    <span v-else-if="shouldShowNeutralFallback" class="ai-provider-icon__fallback" aria-hidden="true">
      <span class="ai-provider-icon__fallback-mark"></span>
    </span>
  </span>
</template>

<style scoped>
.ai-provider-icon {
  --ai-provider-icon-bg: transparent;
  display: block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ai-provider-icon-bg);
  color: var(--accent-foreground);
}

.ai-provider-icon__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ai-provider-icon__fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: var(--text-tertiary);
}

.ai-provider-icon__fallback-mark {
  width: 38%;
  height: 38%;
  border-radius: 999px;
  background: currentColor;
}
</style>
