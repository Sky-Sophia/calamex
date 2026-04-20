<template>
  <div class="app-root-stage" :class="{ 'is-splash-mode': isWindowSplashMode }">
    <AppDialogHost />
    <div v-if="isContentMounted && workbenchComponent && !runtimeErrorState" class="app-content-entry"
      :class="{ 'is-visible': isAppContentVisible }">
      <component :is="workbenchComponent" @ready="handleWorkbenchReady" />
    </div>
    <SplashScreen v-if="isSplashVisible" :ready="isApplicationReady" :error="runtimeErrorState"
      @leave-start="handleSplashLeaveStart" @after-leave="handleSplashAfterLeave" />
  </div>
</template>

<script setup lang="ts">
import AppDialogHost from '@/components/common/AppDialogHost.vue';
import SplashScreen from '@/components/common/SplashScreen.vue';
import { runtimeErrorState, setRuntimeError } from '@/utils/runtime-diagnostics';
import type { Component } from 'vue';
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

const MAIN_WINDOW_SIZE = { width: 1500, height: 960 } as const;
const MAIN_WINDOW_MIN_SIZE = { width: 1220, height: 760 } as const;
const MAIN_CONTENT_REVEAL_DELAY_MS = 50;
const SPLASH_MODE_CLASS = 'splash-window-mode';

const isSplashMounted = ref(true);
const isContentMounted = ref(false);
const isAppContentVisible = ref(false);
const isWorkbenchModuleReady = ref(false);
const isWorkbenchViewReady = ref(false);
const workbenchComponent = shallowRef<Component | null>(null);
const isWindowSplashMode = ref(true);

let revealMainWindowPromise: Promise<void> | null = null;
let revealDelayTimerId: number | null = null;
let revealFlowVersion = 0;

// ---------- Tauri window helpers ----------

const applyNativeWindowStage = async (stage: 'splash' | 'main'): Promise<boolean> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('apply_window_stage', { stage });
    return true;
  } catch (error) {
    console.warn(`切换窗口阶段失败：${stage}`, error);
    return false;
  }
};

const applyMainWindowFrameFallback = async (): Promise<void> => {
  const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/dpi'),
  ]);
  const appWindow = getCurrentWindow();
  await appWindow.setResizable(true);
  await appWindow.setSize(new LogicalSize(MAIN_WINDOW_SIZE.width, MAIN_WINDOW_SIZE.height));
  await appWindow.setMinSize(
    new LogicalSize(MAIN_WINDOW_MIN_SIZE.width, MAIN_WINDOW_MIN_SIZE.height),
  );
  await appWindow.center();
  await appWindow.setFocus();
};

const applyMainWindowFrame = async (): Promise<void> => {
  try {
    if (await applyNativeWindowStage('main')) {
      return;
    }
    // Rust 端 apply_window_stage 不可用时的纯前端回退（可能缺少装饰/置顶等副作用处理）
    await applyMainWindowFrameFallback();
  } catch (error) {
    console.warn('恢复主窗口尺寸失败', error);
  }
};

// ---------- Lifecycle flow ----------

const loadWorkbenchModule = async (): Promise<void> => {
  isWorkbenchModuleReady.value = false;
  isWorkbenchViewReady.value = false;
  workbenchComponent.value = null;
  try {
    const module = await import('@/views/ShellWorkbenchView.vue');
    workbenchComponent.value = markRaw(module.default);
    isContentMounted.value = true;
  } catch (error) {
    setRuntimeError('工作台模块加载失败', error);
  } finally {
    isWorkbenchModuleReady.value = true;
  }
};

const isApplicationReady = computed(
  () =>
    !runtimeErrorState.value &&
    isWorkbenchModuleReady.value &&
    isWorkbenchViewReady.value &&
    Boolean(workbenchComponent.value),
);

const isSplashVisible = computed(
  () => isSplashMounted.value || Boolean(runtimeErrorState.value),
);

const setDocumentSplashMode = (enabled: boolean): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const body = document.body;
  if (root) root.classList.toggle(SPLASH_MODE_CLASS, enabled);
  if (body) body.classList.toggle(SPLASH_MODE_CLASS, enabled);
};

const clearRevealDelayTimer = (): void => {
  if (revealDelayTimerId !== null) {
    window.clearTimeout(revealDelayTimerId);
    revealDelayTimerId = null;
  }
};

const waitForMainRevealDelay = (): Promise<void> =>
  new Promise((resolve) => {
    clearRevealDelayTimer();
    revealDelayTimerId = window.setTimeout(() => {
      revealDelayTimerId = null;
      resolve();
    }, MAIN_CONTENT_REVEAL_DELAY_MS);
  });

const waitForStablePaint = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const revealMainWindow = async (): Promise<void> => {
  if (runtimeErrorState.value) {
    return;
  }
  if (revealMainWindowPromise) {
    await revealMainWindowPromise;
    return;
  }

  const currentRevealFlowVersion = revealFlowVersion;

  revealMainWindowPromise = (async () => {
    isWindowSplashMode.value = false;
    setDocumentSplashMode(false);

    if (!isContentMounted.value && workbenchComponent.value) {
      isContentMounted.value = true;
      await nextTick();
    }

    await Promise.all([applyMainWindowFrame(), waitForMainRevealDelay()]);

    if (runtimeErrorState.value || currentRevealFlowVersion !== revealFlowVersion) {
      return;
    }

    await nextTick();
    await waitForStablePaint();

    if (runtimeErrorState.value || currentRevealFlowVersion !== revealFlowVersion) {
      return;
    }

    isAppContentVisible.value = true;
  })().finally(() => {
    revealMainWindowPromise = null;
  });

  await revealMainWindowPromise;
};

// ---------- Event handlers ----------

const handleSplashLeaveStart = (): void => {
  void revealMainWindow();
};

const handleSplashAfterLeave = async (): Promise<void> => {
  if (runtimeErrorState.value) {
    return;
  }

  await revealMainWindow();
  isSplashMounted.value = false;
};

const handleWorkbenchReady = (): void => {
  isWorkbenchViewReady.value = true;
};

// ---------- Watchers ----------

watch(runtimeErrorState, (error: unknown, previousError: unknown) => {
  if (error) {
    // 进入错误态：回到 splash，并丢弃当前加载流水线
    revealFlowVersion += 1;
    revealMainWindowPromise = null;
    clearRevealDelayTimer();
    isWindowSplashMode.value = true;
    setDocumentSplashMode(true);
    isSplashMounted.value = true;
    isContentMounted.value = false;
    isAppContentVisible.value = false;
    isWorkbenchViewReady.value = false;
    return;
  }

  // 从错误态恢复：重新加载 workbench 模块
  if (previousError) {
    void loadWorkbenchModule();
  }
});

watch(isWindowSplashMode, (visible: boolean) => setDocumentSplashMode(visible), { immediate: true });

// ---------- Mount / Unmount ----------

onMounted(() => {
  void loadWorkbenchModule();
});

onBeforeUnmount(() => {
  clearRevealDelayTimer();
  setDocumentSplashMode(false);
});
</script>