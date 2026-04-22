/**
 * src/composables/useIntegratedTerminal.ts
 * UI 适配器层（<=200 行）— 负责 Vue 生命周期绑定 / DOM 挂载 / 响应式 watcher。
 * 所有终端会话逻辑由 TerminalSession（src/terminal/session.ts）封装。
 *
 * R-18.4.1 / R-20.2.1 / R-20.2.3
 */
import { tauriService } from '@/services/tauri';
import { useEditorStore } from '@/store/editor';
import { useTerminalRegistryStore } from '@/terminal/registry';
import type { TThemeMode } from '@/types/app';
import type { ITerminalSettings } from '@/types/settings';
import type {
  ITerminalRunCompletePayload,
  ITerminalRunOutputEvent,
  ITerminalStatusChangePayload,
} from '@/types/terminal';
import { DEFAULT_TERMINAL_SESSION_ID } from '@/types/terminal';
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  watch,
  type Ref,
} from 'vue';

// --- 选项类型 ---

type TUseIntegratedTerminalOptions = {
  settings: Ref<ITerminalSettings>;
  visible: Ref<boolean>;
  theme: Ref<TThemeMode>;
  sessionId?: string;
  onStatusChange?: (payload: ITerminalStatusChangePayload) => void;
  onOutput?: (payload: ITerminalRunOutputEvent) => void;
  onRunComplete?: (payload: ITerminalRunCompletePayload) => void;
};

// --- 对外只读状态钩子 ---

/**
 * 读取当前活跃终端会话的连接状态。
 * registry 持有该 ref，无论 session 是否已创建均返回相同的响应式对象（Fix-3）。
 */
export const useIntegratedTerminalStatus = () => {
  const registry = useTerminalRegistryStore();
  const { status, statusMessage } = registry.getStatusRefs(DEFAULT_TERMINAL_SESSION_ID);
  return {
    status: readonly(status),
    statusMessage: readonly(statusMessage),
  };
};

/**
 * 读取当前活跃终端会话的完整控制接口。
 * status/statusMessage 永远与 session 同源（经 registry refs）；action 在调用时惰性查找 session。
 */
export const useIntegratedTerminalControls = () => {
  const registry = useTerminalRegistryStore();
  const { status, statusMessage } = registry.getStatusRefs(DEFAULT_TERMINAL_SESSION_ID);
  return {
    status: readonly(status),
    statusMessage: readonly(statusMessage),
    // session payload 在 connect 前为 null，这是正常语义
    get session() {
      const s = registry.get(DEFAULT_TERMINAL_SESSION_ID);
      return s ? readonly(s.session) : readonly(ref(null));
    },
    retry: async (): Promise<void> => {
      await registry.get(DEFAULT_TERMINAL_SESSION_ID)?.retry();
    },
    clearScreen: async (): Promise<void> => {
      await registry.get(DEFAULT_TERMINAL_SESSION_ID)?.clearScreen();
    },
    interrupt: async (): Promise<void> => {
      await registry.get(DEFAULT_TERMINAL_SESSION_ID)?.interrupt();
    },
    sendCommand: async (command: string): Promise<void> => {
      await registry.get(DEFAULT_TERMINAL_SESSION_ID)?.sendCommand(command);
    },
  };
};

// --- 主 composable ---

export const useIntegratedTerminal = ({
  settings,
  visible,
  theme,
  sessionId = DEFAULT_TERMINAL_SESSION_ID,
  onStatusChange,
  onOutput,
  onRunComplete,
}: TUseIntegratedTerminalOptions) => {
  const editorStore = useEditorStore();
  const registry = useTerminalRegistryStore();
  const hostRef = ref<HTMLElement | null>(null);

  // 同步创建/获取会话（setup 阶段即可被 useIntegratedTerminalStatus 读取）
  const session = registry.getOrCreate({
    sessionId,
    tauriService,
    onStatusChange,
    onOutput,
    onRunComplete,
  });
  // 每次 composable 被调用时更新回调（组件重挂载场景）
  session.updateCallbacks({ onStatusChange, onOutput, onRunComplete });

  // --- 生命周期 ---

  onMounted(async () => {
    const el = hostRef.value;
    if (!el) return;
    session.setVisible(visible.value);
    session.initWithHost(el, theme.value, settings.value);
    session.bindRenderRecoveryListeners();
    await session.registerEventListeners();
    await session.ensureConnect();
  });

  onBeforeUnmount(() => {
    session.detach();
  });

  // --- Watchers ---

  watch(
    () => ({ settings: settings.value, theme: theme.value }),
    () => {
      session.applySettings(theme.value, settings.value);
    },
    { deep: true },
  );

  watch(
    () => visible.value,
    async (nextVisible) => {
      session.setVisible(nextVisible);
      if (!nextVisible) return;
      await nextTick();
      session.handleBecomeVisible();
    },
  );

  watch(
    () => editorStore.pendingTerminalRunId,
    (nextRunId) => {
      session.trackRun(nextRunId);
    },
    { flush: 'sync' },
  );

  // --- 返回值 ---

  return {
    hostRef,
    status: readonly(session.status),
    statusMessage: readonly(session.statusMessage),
    retry: async (): Promise<void> => session.retry(),
    focusTerminal: (): void => session.focusTerminal(),
  };
};