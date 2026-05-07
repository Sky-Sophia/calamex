<script setup lang="ts">
import FileEntryIcon from '@/components/common/FileEntryIcon.vue';
import { Skeleton } from '@/components/ui/skeleton';
import type { TStartupShellState } from '@/types/startup-shell';
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  state: TStartupShellState;
  showTerminal?: boolean;
  terminalHeight?: number;
}>(), {
  showTerminal: false,
  terminalHeight: 236,
});

const activeTab = computed(() =>
  props.state.openTabs.find((item) => item.isActive) ?? props.state.openTabs[0] ?? null,
);

const visibleTabs = computed(() => props.state.openTabs.slice(0, 8));
const placeholderTabs = ['primary', 'secondary', 'tertiary'] as const;

const terminalPanelStyle = computed(() => ({
  height: `${Math.max(140, Math.round(props.terminalHeight))}px`,
}));

const editorLineWidths = [
  '62%',
  '46%',
  '72%',
  '38%',
  '66%',
  '54%',
  '78%',
  '42%',
] as const;
</script>

<template>
  <section class="startup-workbench-shell" aria-hidden="true">
    <header class="startup-workbench-shell__tabbar">
      <div class="startup-workbench-shell__tabs">
        <div
          v-for="tab in visibleTabs"
          :key="tab.id"
          class="startup-workbench-shell__tab"
          :class="{ 'is-active': tab.isActive }"
        >
          <FileEntryIcon kind="file" :path="tab.path" class="startup-workbench-shell__tab-icon" />
          <span class="startup-workbench-shell__tab-title">{{ tab.title }}</span>
        </div>
        <div
          v-for="tab in placeholderTabs"
          v-show="visibleTabs.length === 0"
          :key="tab"
          class="startup-workbench-shell__tab is-placeholder"
        >
          <Skeleton class="startup-workbench-shell__tab-placeholder-icon" />
          <Skeleton class="startup-workbench-shell__tab-placeholder-title" />
        </div>
      </div>
      <div class="startup-workbench-shell__actions">
        <Skeleton class="startup-workbench-shell__action-dot" />
        <Skeleton class="startup-workbench-shell__action-dot" />
        <Skeleton class="startup-workbench-shell__action-dot" />
      </div>
    </header>

    <div v-if="activeTab?.path" class="startup-workbench-shell__breadcrumb">
      <span>{{ activeTab.path }}</span>
    </div>

    <div class="startup-workbench-shell__body" :class="{ 'has-terminal': showTerminal }">
      <div class="startup-workbench-shell__editor">
        <template v-if="activeTab?.kind === 'image'">
          <div class="startup-workbench-shell__image-stage">
            <Skeleton class="startup-workbench-shell__image-frame" />
            <Skeleton class="startup-workbench-shell__image-caption" />
          </div>
        </template>

        <template v-else>
          <div class="startup-workbench-shell__gutter">
            <span v-for="line in editorLineWidths.length" :key="line">{{ line }}</span>
          </div>
          <div class="startup-workbench-shell__code">
            <Skeleton
              v-for="(width, index) in editorLineWidths"
              :key="index"
              class="startup-workbench-shell__code-line"
              :style="{ width }"
            />
          </div>
        </template>
      </div>

      <section v-if="showTerminal" class="startup-workbench-shell__terminal" :style="terminalPanelStyle">
        <div class="startup-workbench-shell__terminal-header">
          <Skeleton class="startup-workbench-shell__terminal-title" />
          <Skeleton class="startup-workbench-shell__terminal-chip" />
        </div>
        <div class="startup-workbench-shell__terminal-body">
          <Skeleton class="startup-workbench-shell__terminal-prompt" />
          <Skeleton class="startup-workbench-shell__terminal-line is-wide" />
          <Skeleton class="startup-workbench-shell__terminal-line" />
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.startup-workbench-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--workbench-content-bg);
}

.startup-workbench-shell__tabbar {
  display: flex;
  min-height: 36px;
  align-items: stretch;
  justify-content: space-between;
  border-bottom: 1px solid var(--shell-divider);
  background: var(--tabbar-bg);
}

.startup-workbench-shell__tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.startup-workbench-shell__tab {
  display: inline-flex;
  min-width: 112px;
  max-width: 190px;
  align-items: center;
  gap: 7px;
  border-right: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  padding: 0 12px;
  color: var(--text-tertiary);
}

.startup-workbench-shell__tab.is-active {
  background: var(--tab-active-bg);
  color: var(--text-primary);
}

.startup-workbench-shell__tab.is-placeholder {
  width: 144px;
}

.startup-workbench-shell__tab-icon {
  --file-icon-size: 15px;
}

.startup-workbench-shell__tab-title {
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.startup-workbench-shell__tab-placeholder-icon {
  width: 15px;
  height: 15px;
  border-radius: 4px;
}

.startup-workbench-shell__tab-placeholder-title {
  width: 82px;
  height: 10px;
  border-radius: 999px;
}

.startup-workbench-shell__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.startup-workbench-shell__action-dot {
  width: 15px;
  height: 15px;
  border-radius: 5px;
}

.startup-workbench-shell__breadcrumb {
  display: flex;
  min-height: 28px;
  align-items: center;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--shell-divider) 68%, transparent);
  padding: 0 14px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.startup-workbench-shell__breadcrumb span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.startup-workbench-shell__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.startup-workbench-shell__editor {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 52px minmax(0, 1fr);
  overflow: hidden;
  background: var(--editor-bg);
}

.startup-workbench-shell__gutter {
  display: grid;
  align-content: start;
  gap: 14px;
  border-right: 1px solid color-mix(in srgb, var(--shell-divider) 48%, transparent);
  padding: 18px 12px 0 0;
  color: color-mix(in srgb, var(--text-quaternary) 78%, transparent);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1;
  text-align: right;
}

.startup-workbench-shell__code {
  display: grid;
  align-content: start;
  gap: 15px;
  padding: 18px 22px;
}

.startup-workbench-shell__code-line {
  height: 10px;
  border-radius: 999px;
}

.startup-workbench-shell__image-stage {
  grid-column: 1 / -1;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 14px;
  min-height: 0;
  padding: 24px;
}

.startup-workbench-shell__image-frame {
  width: min(72%, 520px);
  aspect-ratio: 16 / 10;
  border-radius: 8px;
}

.startup-workbench-shell__image-caption {
  width: min(42%, 280px);
  height: 10px;
  border-radius: 999px;
}

.startup-workbench-shell__terminal {
  flex: 0 0 auto;
  min-height: 140px;
  overflow: hidden;
  border-top: 1px solid var(--shell-divider);
  background: var(--panel-bg);
}

.startup-workbench-shell__terminal-header {
  display: flex;
  height: 36px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid color-mix(in srgb, var(--shell-divider) 70%, transparent);
  padding: 0 14px;
}

.startup-workbench-shell__terminal-title {
  width: 128px;
  height: 10px;
  border-radius: 999px;
}

.startup-workbench-shell__terminal-chip {
  width: 72px;
  height: 20px;
  border-radius: 999px;
}

.startup-workbench-shell__terminal-body {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 12px;
  padding: 16px 18px;
}

.startup-workbench-shell__terminal-prompt {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.startup-workbench-shell__terminal-line {
  grid-column: 2;
  width: 48%;
  height: 10px;
  border-radius: 999px;
}

.startup-workbench-shell__terminal-line.is-wide {
  width: 76%;
}

@media (max-width: 720px) {
  .startup-workbench-shell__tab {
    min-width: 96px;
  }

  .startup-workbench-shell__actions {
    display: none;
  }

  .startup-workbench-shell__editor {
    grid-template-columns: 42px minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .startup-workbench-shell :deep(.animate-pulse) {
    animation: none;
  }
}
</style>
