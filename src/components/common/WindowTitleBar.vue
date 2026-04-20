<template>
  <header class="window-titlebar border-b border-(--shell-divider)" @mousedown="handleStartWindowDrag">
    <div class="grid h-10 grid-cols-[minmax(0,1fr)_minmax(240px,420px)_minmax(0,1fr)] items-center gap-3 px-3">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-6 w-6 items-center justify-center rounded-md bg-(--accent-muted) text-(--accent-strong)">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
        </div>

        <nav class="flex min-w-0 items-center gap-1 text-[12px] text-(--text-tertiary)">
          <AppDropdownMenu :items="fileMenuItems" align="left" :min-width="140" @select="handleFileAction">
            <template #trigger="{ open }">
              <button type="button" class="titlebar-menu-button" :class="{ 'is-open': open }">
                文件
              </button>
            </template>
          </AppDropdownMenu>

          <AppDropdownMenu :items="editMenuItems" align="left" :min-width="188" @select="handleEditAction">
            <template #trigger="{ open }">
              <button type="button" class="titlebar-menu-button" :class="{ 'is-open': open }">
                编辑
              </button>
            </template>
          </AppDropdownMenu>

          <AppDropdownMenu :items="viewMenuItems" align="left" :min-width="140" @select="handleViewAction">
            <template #trigger="{ open }">
              <button type="button" class="titlebar-menu-button" :class="{ 'is-open': open }">
                查看
              </button>
            </template>
          </AppDropdownMenu>

          <button type="button" class="titlebar-menu-button">选择</button>
          <button type="button" class="titlebar-menu-button">转到</button>

          <AppDropdownMenu :items="terminalMenuItems" align="left" :min-width="140" @select="handleTerminalAction">
            <template #trigger="{ open }">
              <button type="button" class="titlebar-menu-button" :class="{ 'is-open': open }">
                终端
              </button>
            </template>
          </AppDropdownMenu>

          <button type="button" class="titlebar-menu-button">帮助</button>
        </nav>
      </div>

      <div class="flex justify-center" data-tauri-drag-region @dblclick="handleToggleMaximize">
        <div class="window-command-bar w-full justify-center text-[12px]">
          <svg viewBox="0 0 24 24" class="h-4 w-4 text-(--text-quaternary)" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span class="truncate">my_desktop_app</span>
        </div>
      </div>

      <div class="flex min-w-0 items-center justify-end gap-2">
        <button type="button" class="icon-button relative app-tooltip-target border border-transparent"
          :class="terminalToggleButtonClass" :disabled="!isDesktopRuntime"
          :data-tooltip="isTerminalToggleDisabled ? undefined : terminalToggleTooltip" data-tooltip-placement="bottom"
          :aria-label="terminalToggleTooltip" @click="toggleTerminalVisibility">
          <svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
            <path d="m5.2 7 1.6 1.4-1.6 1.4" />
            <path d="M8.8 10h2" />
          </svg>
        </button>

        <button type="button" class="icon-button relative app-tooltip-target border border-transparent"
          :class="diagnosticsToggleButtonClass" :aria-disabled="!props.canToggleDiagnostics"
          :data-tooltip="isDiagnosticsToggleDisabled ? undefined : diagnosticToggleTooltip"
          data-tooltip-placement="bottom" :aria-label="diagnosticToggleTooltip" @click="handleDiagnosticsToggleClick">
          <svg viewBox="0 0 16 16" aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
            <path d="M9 3.5v9" />
            <path d="M11.1 6.1h1.8" />
            <path d="M11.1 8.2h1.8" />
            <path d="M11.1 10.3h1.1" />
          </svg>

          <span v-if="diagnosticIssueCount > 0"
            class="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full border border-[#3a2f16] bg-[#2a2112] px-1 text-[9px] font-semibold leading-4 text-[#ffcc4d]">
            {{ diagnosticCounterLabel }}
          </span>
        </button>

        <span class="app-tooltip-target inline-flex" :data-tooltip="isRunButtonDisabled ? undefined : runButtonTooltip"
          data-tooltip-placement="bottom">
          <button type="button" class="titlebar-run-button" :disabled="isRunButtonDisabled" aria-label="运行脚本"
            @click="$emit('run')">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16"
              class="titlebar-run-icon h-5 w-5" aria-hidden="true">
              <path fill="currentColor"
                d="M4.506 3.503L12.501 8l-8 4.5zm-.004-1.505C3.718 1.998 3 2.626 3 3.5v9c0 .874.718 1.502 1.502 1.502c.245 0 .496-.061.733-.195l8-4.5c1.019-.573 1.019-2.041 0-2.615l-8-4.499a1.5 1.5 0 0 0-.733-.195" />
            </svg>
          </button>
        </span>

        <span class="max-w-55 truncate text-[11px] text-(--text-quaternary)">
          {{ currentDocumentLabel }}
        </span>

        <div v-if="isDesktopRuntime" class="ml-1 flex items-center gap-0.5">
          <button class="window-control-button app-tooltip-target" type="button" aria-label="最小化" data-tooltip="最小化"
            data-tooltip-placement="bottom" @click="handleMinimize">
            <svg viewBox="0 0 10 10" aria-hidden="true" class="h-3.5 w-3.5">
              <path d="M1 5h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" />
            </svg>
          </button>

          <button class="window-control-button app-tooltip-target" type="button"
            :aria-label="isMaximized ? '向下还原' : '最大化'" :data-tooltip="isMaximized ? '向下还原' : '最大化'"
            data-tooltip-placement="bottom" @click="handleToggleMaximize">
            <svg v-if="!isMaximized" viewBox="0 0 10 10" aria-hidden="true" class="h-3.5 w-3.5">
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" rx="0.5" stroke="currentColor"
                stroke-width="1.1" />
            </svg>
            <svg v-else viewBox="0 0 10 10" aria-hidden="true" class="h-3.5 w-3.5">
              <path d="M3 1.5h5.5V7M7 3H1.5v5.5H7z" fill="none" stroke="currentColor" stroke-linejoin="round"
                stroke-width="1.1" />
            </svg>
          </button>

          <button class="window-control-button app-tooltip-target" type="button" aria-label="关闭" data-tooltip="关闭"
            data-tooltip-placement="bottom" @click="$emit('close-request')">
            <svg viewBox="0 0 10 10" aria-hidden="true" class="h-3.5 w-3.5">
              <path d="M2 2l6 6M8 2L2 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import AppDropdownMenu from '@/components/common/AppDropdownMenu.vue';
import type { TThemeMode } from '@/types/app';
import type { ICommandTemplate } from '@/types/editor';
import { waitForDesktopRuntime } from '@/utils/desktop-runtime';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  documentName: string;
  hasActiveDocument: boolean;
  isDirty: boolean;
  documentKind: 'text' | 'image';
  theme: TThemeMode;
  isRunning: boolean;
  canRun: boolean;
  canSave: boolean;
  isDesktopRuntime: boolean;
  isTerminalVisible: boolean;
  isDiagnosticsVisible: boolean;
  canToggleDiagnostics: boolean;
  diagnosticIssueCount: number;
  commandTemplates: ICommandTemplate[];
  commentTemplates: ICommandTemplate[];
}>();

const emit = defineEmits<{
  new: [];
  open: [];
  'open-folder': [];
  'close-workspace': [];
  'format-document': [];
  save: [];
  'save-as': [];
  'close-request': [];
  run: [];
  'open-terminal': [];
  'hide-terminal': [];
  'toggle-diagnostics': [];
  'toggle-theme': [];
  'insert-template': [value: ICommandTemplate];
}>();

const isMaximized = ref(false);

const currentDocumentLabel = computed(() => {
  if (!props.hasActiveDocument) {
    return '未打开文件';
  }

  return props.documentName;
});

const diagnosticCounterLabel = computed(() =>
  props.diagnosticIssueCount > 99 ? '99+' : String(props.diagnosticIssueCount),
);

const isDiagnosticsToggleDisabled = computed(() => !props.canToggleDiagnostics);
const isTerminalToggleDisabled = computed(() => !props.isDesktopRuntime);
const isRunButtonDisabled = computed(
  () => props.isRunning || !props.isDesktopRuntime || !props.canRun,
);

const diagnosticsToggleButtonClass = computed(() => {
  if (isDiagnosticsToggleDisabled.value) {
    return 'is-inert-control opacity-45';
  }

  if (props.isDiagnosticsVisible) {
    return 'border-white/10 bg-white/[0.06] text-[var(--text-primary)]';
  }

  if (props.diagnosticIssueCount > 0) {
    return 'text-[var(--warning)]';
  }

  return '';
});

const terminalToggleButtonClass = computed(() => {
  if (isTerminalToggleDisabled.value) {
    return 'is-inert-control opacity-45';
  }

  if (props.isTerminalVisible) {
    return 'border-white/10 bg-white/[0.06] text-[var(--text-primary)]';
  }

  return '';
});

const fileMenuItems = computed(() => [
  { key: 'new', label: '新建脚本' },
  {
    key: 'open',
    label: '打开文件',
    disabled: !props.isDesktopRuntime,
  },
  {
    key: 'open-folder',
    label: '打开文件夹',
    disabled: !props.isDesktopRuntime,
  },
  {
    key: 'close-workspace',
    label: '关闭工作区',
  },
  {
    key: 'save',
    label: '保存',
    disabled: !props.isDesktopRuntime || !props.canSave,
  },
  {
    key: 'save-as',
    label: '另存为…',
    disabled: !props.isDesktopRuntime || !props.canSave,
  },
]);

const editMenuItems = computed(() => [
  {
    key: 'format-document',
    label: 'shfmt 格式化',
    disabled: !props.canSave,
  },
  ...props.commandTemplates.map((item, index) => ({
    key: `template:${item.id}`,
    label: item.title,
    separatorBefore: index === 0,
  })),
  ...props.commentTemplates.map((item, index) => ({
    key: `template:${item.id}`,
    label: item.title,
    separatorBefore: props.commandTemplates.length === 0 ? index === 0 : index === 0,
  })),
]);

const viewMenuItems = computed(() => [
  {
    key: 'toggle-theme',
    label: props.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
  },
]);

const terminalMenuItems = computed(() => [
  {
    key: 'toggle-terminal',
    label: props.isTerminalVisible ? '隐藏终端' : '打开终端',
  },
]);

const runButtonTooltip = computed(() => {
  if (props.isRunning) {
    return '脚本正在执行';
  }

  if (!props.isDesktopRuntime) {
    return '当前为浏览器预览，无法直接执行';
  }

  if (!props.hasActiveDocument) {
    return '请先打开脚本';
  }

  if (!props.canRun) {
    return props.documentKind === 'image' ? '图片预览不支持执行' : '当前脚本内容不可执行';
  }

  return '运行脚本';
});

const diagnosticToggleTooltip = computed(() => {
  if (!props.hasActiveDocument) {
    return '请先打开脚本文件';
  }

  if (!props.canToggleDiagnostics) {
    return '当前文件类型不支持代码检查面板';
  }

  if (props.isDiagnosticsVisible) {
    return '关闭代码检查面板';
  }

  if (props.diagnosticIssueCount > 0) {
    return `打开代码检查面板（${props.diagnosticIssueCount} 项问题）`;
  }

  return '打开代码检查面板';
});

const terminalToggleTooltip = computed(() => {
  if (!props.isDesktopRuntime) {
    return '仅桌面端可用';
  }

  return props.isTerminalVisible ? '隐藏终端' : '打开终端';
});

let unlistenResize: UnlistenFn | null = null;

const getAppWindow = async () => {
  const runtimeReady = await waitForDesktopRuntime();
  if (!runtimeReady) {
    return null;
  }

  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
};

const syncWindowState = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    isMaximized.value = await appWindow.isMaximized();
  } catch (error) {
    console.warn('读取窗口最大化状态失败', error);
  }
};

const handleFileAction = (key: string): void => {
  switch (key) {
    case 'new':
      emit('new');
      break;
    case 'open':
      emit('open');
      break;
    case 'open-folder':
      emit('open-folder');
      break;
    case 'close-workspace':
      emit('close-workspace');
      break;
    case 'save':
      emit('save');
      break;
    case 'save-as':
      emit('save-as');
      break;
    default:
      break;
  }
};

const handleEditAction = (key: string): void => {
  if (key === 'format-document') {
    emit('format-document');
    return;
  }

  const templateId = key.replace('template:', '');
  const targetTemplate = [...props.commandTemplates, ...props.commentTemplates].find(
    (item) => item.id === templateId,
  );
  if (targetTemplate) {
    emit('insert-template', targetTemplate);
  }
};

const handleViewAction = (key: string): void => {
  if (key === 'toggle-theme') {
    emit('toggle-theme');
  }
};

const handleTerminalAction = (key: string): void => {
  if (key === 'toggle-terminal') {
    if (props.isTerminalVisible) {
      emit('hide-terminal');
      return;
    }

    emit('open-terminal');
  }
};

const handleDiagnosticsToggleClick = (): void => {
  if (!props.canToggleDiagnostics) {
    return;
  }

  emit('toggle-diagnostics');
};

const toggleTerminalVisibility = (): void => {
  if (!props.isDesktopRuntime) {
    return;
  }

  if (props.isTerminalVisible) {
    emit('hide-terminal');
    return;
  }

  emit('open-terminal');
};

const handleMinimize = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.minimize();
};

const handleToggleMaximize = async (): Promise<void> => {
  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await appWindow.toggleMaximize();
  await syncWindowState();
};

const handleStartWindowDrag = async (event: MouseEvent): Promise<void> => {
  if (!props.isDesktopRuntime || event.button !== 0) {
    return;
  }

  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      'button, a, input, textarea, select, [role="button"], [role="menu"], [data-no-window-drag]',
    )
  ) {
    return;
  }

  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    await appWindow.startDragging();
  } catch (error) {
    console.warn('窗口拖动失败', error);
  }
};

onMounted(async () => {
  if (!props.isDesktopRuntime) {
    return;
  }

  const appWindow = await getAppWindow();
  if (!appWindow) {
    return;
  }

  await syncWindowState();
  unlistenResize = await appWindow.onResized(() => {
    void syncWindowState();
  });
});

onBeforeUnmount(() => {
  if (unlistenResize) {
    unlistenResize();
    unlistenResize = null;
  }
});
</script>
