<template>
  <footer
    class="workbench-statusbar flex h-7 w-full min-w-0 shrink-0 items-center justify-between border-t border-(--shell-divider) px-1 text-[11px]">
    <div class="flex h-full items-center gap-0.5">
      <!-- Git branch + changes -->
      <button
        v-if="gitBranchName"
        type="button"
        class="statusbar-segment statusbar-segment-button statusbar-git-branch"
        :title="`分支 ${gitBranchName}，点击打开源代码管理`"
        @click="$emit('open-source-control')"
      >
        <svg class="inline-block" style="width:10px;height:10px;margin-right:4px;vertical-align:-1px" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="4" cy="3" r="1.5" /><circle cx="4" cy="13" r="1.5" /><circle cx="12" cy="8" r="1.5" />
          <path d="M4 4.5v7" /><path d="M12 9.5v-1a4 4 0 0 0-4-4H6" />
        </svg>
        <span>{{ gitBranchName }}</span>
        <span v-if="gitAddedCount > 0" class="statusbar-git-added"> +{{ gitAddedCount }}</span>
        <span v-if="gitRemovedCount > 0" class="statusbar-git-removed"> −{{ gitRemovedCount }}</span>
      </button>

      <span v-if="statusMessage" class="statusbar-segment statusbar-segment-passive statusbar-segment-flash">
        {{ statusMessage }}
      </span>

      <span v-if="hasActiveDocument && documentKind === 'image'" class="statusbar-segment statusbar-segment-passive">
        图片预览
      </span>
    </div>

    <div class="flex h-full items-center gap-0.5">
      <template v-if="hasActiveDocument && documentKind === 'text'">
        <span
class="statusbar-segment statusbar-segment-button app-tooltip-target"
          :data-tooltip="cursorPositionTooltip" data-tooltip-placement="top">
          {{ cursorLine }}:{{ cursorColumn }}
        </span>
        <span
class="statusbar-segment statusbar-segment-button app-tooltip-target" :data-tooltip="charCountTooltip"
          data-tooltip-placement="top">
          {{ charCount }} char
        </span>
        <span
class="statusbar-segment statusbar-segment-button app-tooltip-target" data-tooltip="LF 行尾序列"
          data-tooltip-placement="top">
          LF
        </span>

        <AppDropdownMenu :items="encodingItems" align="right" :min-width="118" @select="handleEncodingChange">
          <template #trigger="{ open }">
            <button
type="button" class="statusbar-segment statusbar-segment-button app-tooltip-target"
              :class="{ 'is-open': open }" :data-tooltip="encodingTooltip" data-tooltip-placement="top">
              {{ encodingLabel }}
            </button>
          </template>
        </AppDropdownMenu>

        <span
class="statusbar-segment app-tooltip-target" :class="{ 'statusbar-segment-passive': !isTerminalReady }"
          :data-tooltip="executorTooltip" data-tooltip-placement="top">
          {{ executorLabel }}
        </span>
      </template>

      <template v-else-if="hasActiveDocument && documentKind === 'image'">
        <span class="statusbar-segment statusbar-segment-passive">只读</span>
      </template>
    </div>
  </footer>
</template>

<script setup lang="ts">
import AppDropdownMenu from '@/components/common/AppDropdownMenu.vue';
import { useIntegratedTerminalStatus } from '@/composables/useIntegratedTerminal';
import type { TDocumentEncoding, TExecutorKind } from '@/types/editor';
import { ENCODING_OPTIONS, getExecutorLabel } from '@/utils/templates';
import { computed } from 'vue';

const props = defineProps<{
  hasActiveDocument: boolean;
  documentKind: 'text' | 'image';
  statusMessage?: string | null;
  encoding: TDocumentEncoding;
  executor: TExecutorKind;
  cursorLine: number;
  cursorColumn: number;
  charCount: number;
  gitBranchName?: string | null;
  gitAddedCount?: number;
  gitRemovedCount?: number;
}>();

const emit = defineEmits<{
  'change-encoding': [value: TDocumentEncoding];
  'open-source-control': [];
}>();

const { status: terminalStatus, statusMessage: terminalStatusMessage } =
  useIntegratedTerminalStatus();

const encodingLabel = computed(
  () =>
    ENCODING_OPTIONS.find((item) => item.value === props.encoding)?.label ??
    props.encoding.toUpperCase(),
);

const executorLabel = computed(() => getExecutorLabel(props.executor));
const isTerminalReady = computed(() => terminalStatus.value === 'ready');
const cursorPositionTooltip = computed(
  () => `第 ${props.cursorLine} 行，第 ${props.cursorColumn} 列`,
);
const charCountTooltip = computed(() => `${props.charCount} 个字符`);
const encodingTooltip = computed(() => `${encodingLabel.value} 编码`);
const executorTooltip = computed(() =>
  isTerminalReady.value
    ? '执行环境固定为 WSL2，终端已连接'
    : terminalStatusMessage.value || '执行环境固定为 WSL2',
);

const encodingItems = computed(() =>
  ENCODING_OPTIONS.map((item) => ({
    key: item.value,
    label: item.label,
    selected: item.value === props.encoding,
  })),
);

const handleEncodingChange = (key: string): void => {
  emit('change-encoding', key as TDocumentEncoding);
};
</script>
