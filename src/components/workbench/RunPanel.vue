<template>
  <section class="run-panel-shell">
    <header class="run-panel-toolbar">
      <div class="run-panel-toolbar-spacer" />

      <div class="run-panel-actions">
        <button type="button" class="icon-button app-tooltip-target run-panel-action-button" data-tooltip="重连终端"
          data-tooltip-placement="top" aria-label="重连终端" @click="void handleRestartTerminal()">
          <span aria-hidden="true" class="icon-[lucide--refresh-ccw]" />
        </button>

        <button type="button" class="icon-button app-tooltip-target run-panel-action-button" data-tooltip="清屏"
          data-tooltip-placement="top" aria-label="清屏" :disabled="!isTerminalReady" @click="void handleClearTerminal()">
          <span aria-hidden="true" class="icon-[lucide--eraser]" />
        </button>

        <button type="button" class="icon-button app-tooltip-target run-panel-action-button"
          :data-tooltip="props.isMaximized ? '还原终端高度' : '最大化终端'" data-tooltip-placement="top"
          :aria-label="props.isMaximized ? '还原终端高度' : '最大化终端'" :aria-pressed="props.isMaximized"
          @click="$emit('toggle-maximize')">
          <span v-if="!props.isMaximized" aria-hidden="true" class="icon-[lucide--maximize-2]" />
          <span v-else aria-hidden="true" class="icon-[lucide--minimize-2]" />
        </button>

        <button type="button" class="icon-button app-tooltip-target run-panel-action-button" data-tooltip="关闭终端面板"
          data-tooltip-placement="top" aria-label="关闭终端面板" @click="$emit('hide')">
          <span aria-hidden="true" class="icon-[lucide--x]" />
        </button>
      </div>
    </header>

    <div class="run-panel-body">
      <div class="run-panel-view is-terminal">
        <EmbeddedTerminal :visible="props.visible" :theme="props.theme"
          :terminal-settings="props.terminalSettings" @status-change="handleTerminalStatusChange"
          @run-chunk="$emit('terminal-run-chunk', $event)" @run-completed="$emit('terminal-run-completed', $event)" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import EmbeddedTerminal from '@/components/workbench/EmbeddedTerminal.vue';
import { useIntegratedTerminalControls } from '@/composables/useIntegratedTerminal';
import { useMessage } from '@/composables/useMessage';
import type { TThemeMode } from '@/types/app';
import type { ITerminalSettings } from '@/types/settings';
import type {
  ITerminalRunChunkPayload,
  ITerminalRunCompletedPayload,
  ITerminalStatusChangePayload,
} from '@/types/terminal';
import { toErrorMessage } from '@/utils/error';

const props = defineProps<{
  theme: TThemeMode;
  terminalSettings: ITerminalSettings;
  visible: boolean;
  isMaximized: boolean;
}>();

defineEmits<{
  hide: [];
  'terminal-run-chunk': [payload: ITerminalRunChunkPayload];
  'terminal-run-completed': [payload: ITerminalRunCompletedPayload];
  'toggle-maximize': [];
}>();

const message = useMessage();

const terminalStatus = ref<ITerminalStatusChangePayload>({
  state: 'connecting',
  message: '正在连接 WSL2 终端…',
});

const { retry, clearScreen } = useIntegratedTerminalControls();

const isTerminalReady = computed(() => terminalStatus.value.state === 'ready');

const handleTerminalStatusChange = (payload: ITerminalStatusChangePayload): void => {
  terminalStatus.value = payload;
};

const runTerminalAction = async (
  task: () => Promise<void>,
  fallbackMessage: string,
): Promise<void> => {
  try {
    await task();
  } catch (error) {
    message.error(toErrorMessage(error, fallbackMessage));
  }
};

const handleRestartTerminal = (): Promise<void> => runTerminalAction(retry, '重连终端失败');

const handleClearTerminal = (): Promise<void> => runTerminalAction(clearScreen, '清屏失败');
</script>
