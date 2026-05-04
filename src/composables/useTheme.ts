import { setWindowBackground } from '@/services/modules/window';
import { useAppStore } from '@/store/app';
import { applyResolvedThemeEffect } from '@/themes/effects';
import { resolveTheme } from '@/themes/manager';
import { readCssVarAsRgba } from '@/utils/color';
import { logger } from '@/utils/logger';
import { computed, onScopeDispose, watch } from 'vue';

export const useTheme = () => {
  const appStore = useAppStore();
  let lastNativeBackground = '';

  const syncNativeWindowBackground = async (): Promise<void> => {
    try {
      const { r, g, b, a } = readCssVarAsRgba('--window-underlay-bg');
      const nextKey = `${r}:${g}:${b}:${a}`;
      if (nextKey === lastNativeBackground) {
        return;
      }

      lastNativeBackground = nextKey;
      await setWindowBackground({ r, g, b, a });
    } catch (err) {
      logger.warn({
        event: 'window.set_background.failed',
        err,
      });
    }
  };

  const stop = watch(
    () => ({
      settings: appStore.settings,
      effectiveTheme: appStore.effectiveTheme,
    }),
    ({ settings, effectiveTheme }) => {
      const resolved = resolveTheme(effectiveTheme);
      applyResolvedThemeEffect(settings, resolved.variant);
      void syncNativeWindowBackground();
    },
    { deep: true, immediate: true, flush: 'post' },
  );

  onScopeDispose(stop);

  return {
    resolvedTheme: computed(() => resolveTheme(appStore.effectiveTheme)),
  };
};
