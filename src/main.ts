import '@/assets/fonts/inter/inter.css';
import { listShellCommandLabels } from './services/shell-command-catalog';
import { pinia } from './store';
import { hydrateSessionStorage } from './store/plugins/tauriSessionStorage';
import { initAppTooltipSystem } from './utils/app-tooltip';
import { MAIN_WINDOW_LABEL } from './utils/app-window';
import { renderFatalBootstrapError } from './utils/bootstrap-fatal-error';
import { registerRuntimeDiagnostics, setRuntimeError } from './utils/runtime-diagnostics';

registerRuntimeDiagnostics();

const MESSAGES = {
  vueErrorLabel: 'Vue render failed',
  bootstrapErrorLabel: 'Application bootstrap failed',
} as const;

const bootstrap = async (): Promise<void> => {
  try {
    await import('./styles.css');

    window.__SH_WINDOW_LABEL__ = MAIN_WINDOW_LABEL;

    const [{ createApp }, { getThemeManager }, { default: App }, { default: router }] =
      await Promise.all([
        import('vue'),
        import('./themes'),
        import('./App.vue'),
        import('./router'),
      ]);

    getThemeManager().init();

    queueMicrotask(() => {
      void listShellCommandLabels();
    });
    await hydrateSessionStorage();

    const app = createApp(App);
    app.use(pinia);
    app.use(router);
    app.config.errorHandler = (error) => {
      setRuntimeError(MESSAGES.vueErrorLabel, error);
    };

    await router.isReady();
    app.mount('#app');

    initAppTooltipSystem();
  } catch (error) {
    console.error(MESSAGES.bootstrapErrorLabel, error);
    setRuntimeError(MESSAGES.bootstrapErrorLabel, error);
    renderFatalBootstrapError(error);
  }
};

void bootstrap();
