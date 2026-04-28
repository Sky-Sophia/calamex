import '@/assets/fonts/inter/inter.css';
import { listShellCommandLabels } from './services/shell-command-catalog';
import { pinia } from './store';
import { hydrateSessionStorage } from './store/plugins/tauriSessionStorage';
import { initAppTooltipSystem } from './utils/app-tooltip';
import {
  MAIN_WINDOW_LABEL,
  WELCOME_WINDOW_LABEL,
  type TAppWindowLabel,
} from './utils/app-window';
import { registerRuntimeDiagnostics, setRuntimeError } from './utils/runtime-diagnostics';

interface ITauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
}

registerRuntimeDiagnostics();

const MESSAGES = {
  vueErrorLabel: 'Vue render failed',
  bootstrapErrorLabel: 'Application bootstrap failed',
} as const;

const isWelcomeWindow = (windowLabel: TAppWindowLabel): boolean =>
  windowLabel === WELCOME_WINDOW_LABEL;

const resolveWindowLabelFromLocation = (): TAppWindowLabel => {
  if (typeof window === 'undefined') {
    return MAIN_WINDOW_LABEL;
  }

  return window.location.hash.includes('/welcome') ? WELCOME_WINDOW_LABEL : MAIN_WINDOW_LABEL;
};

const resolveErrorDetail = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

const forceRevealMainWindowOnBootstrapFailure = async (
  currentWindowLabel: TAppWindowLabel,
): Promise<void> => {
  if (isWelcomeWindow(currentWindowLabel) || typeof window === 'undefined') {
    return;
  }

  const invokeFn = (window as Window & { __TAURI_INTERNALS__?: ITauriInternals })
    .__TAURI_INTERNALS__?.invoke;

  if (typeof invokeFn !== 'function') {
    return;
  }

  try {
    await invokeFn('begin_startup_transition');
  } catch {
    // ignore native transition failures during fatal bootstrap fallback
  }

  try {
    await invokeFn('finalize_startup_transition');
  } catch {
    // ignore native transition failures during fatal bootstrap fallback
  }
};

const renderFatalBootstrapError = (error: unknown): void => {
  const host = document.getElementById('app') ?? document.body;
  if (!host) {
    return;
  }

  const wrapper = document.createElement('section');
  wrapper.setAttribute('role', 'alert');
  wrapper.style.cssText = [
    'display:flex',
    'min-height:100vh',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:#08090a',
    'color:#e5e7eb',
    'font-family:Consolas, "JetBrains Mono", monospace',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'width:min(780px,100%)',
    'border:1px solid rgba(255,107,122,.28)',
    'border-radius:12px',
    'background:#1c1c1f',
    'padding:20px 24px',
    'box-shadow:0 24px 72px rgba(0,0,0,.36)',
  ].join(';');

  const title = document.createElement('h1');
  title.textContent = MESSAGES.bootstrapErrorLabel;
  title.style.cssText = 'margin:0 0 12px;font-size:18px;color:#ff9aa5;';

  const pre = document.createElement('pre');
  pre.textContent = resolveErrorDetail(error);
  pre.style.cssText = [
    'margin:0',
    'white-space:pre-wrap',
    'word-break:break-word',
    'font-size:12px',
    'line-height:1.7',
    'color:#cbd5e1',
  ].join(';');

  panel.append(title, pre);
  wrapper.appendChild(panel);
  host.replaceChildren(wrapper);
};

const bootstrap = async (): Promise<void> => {
  const currentWindowLabel = resolveWindowLabelFromLocation();

  try {
    await import('./styles.css');

    window.__SH_WINDOW_LABEL__ = currentWindowLabel;

    const [{ createApp }, { getThemeManager }, { default: App }, { default: router }] =
      await Promise.all([
        import('vue'),
        import('./themes'),
        import('./App.vue'),
        import('./router'),
      ]);

    getThemeManager().init();

    if (!isWelcomeWindow(currentWindowLabel)) {
      queueMicrotask(() => {
        void listShellCommandLabels();
      });
      await hydrateSessionStorage();
    }

    const app = createApp(App);
    app.use(pinia);
    app.use(router);
    app.config.errorHandler = (error) => {
      setRuntimeError(MESSAGES.vueErrorLabel, error);
    };

    await router.isReady();
    app.mount('#app');

    if (!isWelcomeWindow(currentWindowLabel)) {
      initAppTooltipSystem();
    }
  } catch (error) {
    console.error(MESSAGES.bootstrapErrorLabel, error);
    setRuntimeError(MESSAGES.bootstrapErrorLabel, error);
    await forceRevealMainWindowOnBootstrapFailure(currentWindowLabel);
    renderFatalBootstrapError(error);
  }
};

void bootstrap();
