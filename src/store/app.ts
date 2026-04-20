import type { TThemeMode } from '@/types/app';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'sh-editor-theme';
const DEFAULT_THEME: TThemeMode = 'dark';

declare global {
  interface Window {
    __SH_THEME_STORAGE_SYNC_CLEANUP__?: (() => void) | undefined;
  }
}

const KNOWN_THEMES = ['light', 'dark'] as const satisfies ReadonlyArray<TThemeMode>;
const isKnownTheme = (value: unknown): value is TThemeMode =>
  typeof value === 'string' && KNOWN_THEMES.some((theme) => theme === value);

const hasWindow = (): boolean => typeof window !== 'undefined';
const hasDocument = (): boolean => typeof document !== 'undefined';

const readStoredTheme = (): TThemeMode | null => {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isKnownTheme(raw) ? raw : null;
  } catch {
    return null;
  }
};

const writeStoredTheme = (value: TThemeMode): void => {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 隐私模式 / 存储配额满 / 被策略禁用时忽略
  }
};

const applyThemeToDocument = (effective: TThemeMode): void => {
  if (!hasDocument()) return;
  const root = document.documentElement;
  if (!root) return;
  root.dataset.theme = effective;
  // classList 兼容一些只认 class 的 UI 库（Tailwind dark mode 等）
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('light', effective === 'light');
};

const disposeThemeStorageSync = (): void => {
  if (!hasWindow()) {
    return;
  }

  const cleanup = window.__SH_THEME_STORAGE_SYNC_CLEANUP__;
  if (!cleanup) {
    return;
  }

  cleanup();
  if (window.__SH_THEME_STORAGE_SYNC_CLEANUP__ === cleanup) {
    window.__SH_THEME_STORAGE_SYNC_CLEANUP__ = undefined;
  }
};

const bindThemeStorageSync = (onThemeChange: (value: TThemeMode) => void): void => {
  if (!hasWindow()) {
    return;
  }

  disposeThemeStorageSync();

  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) {
      return;
    }

    const nextTheme = isKnownTheme(event.newValue) ? event.newValue : null;
    if (!nextTheme) {
      return;
    }

    onThemeChange(nextTheme);
  };

  window.addEventListener('storage', handleStorage);
  window.__SH_THEME_STORAGE_SYNC_CLEANUP__ = () => {
    window.removeEventListener('storage', handleStorage);
  };
};

export const useAppStore = defineStore('app', () => {
  const theme = ref<TThemeMode>(readStoredTheme() ?? DEFAULT_THEME);
  const effectiveTheme = computed(() => theme.value);

  const isDark = computed(() => theme.value === 'dark');

  const applyTheme = (value: TThemeMode): void => {
    if (!isKnownTheme(value)) return;
    if (theme.value === value) return;
    theme.value = value;
  };

  const toggleTheme = (): void => {
    applyTheme(isDark.value ? 'light' : 'dark');
  };

  // theme 变动：写盘 + 同步到 DOM
  watch(theme, (value) => {
    writeStoredTheme(value);
    applyThemeToDocument(value);
  }, { immediate: true });

  bindThemeStorageSync((nextTheme) => {
    if (nextTheme !== theme.value) {
      theme.value = nextTheme;
    }
  });

  return {
    theme,
    effectiveTheme,
    isDark,
    applyTheme,
    toggleTheme,
  };
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeThemeStorageSync();
  });
}
