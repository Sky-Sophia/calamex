import svgRaw from '@/assets/svg/welcome-isometric.svg?raw';

const WELCOME_STAGE = 'welcome';
const STARTUP_WELCOME_EPOCH_STORAGE_KEY = 'sh.startup.welcomeEpochMs';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const TAURI_RUNTIME_WAIT_TIMEOUT_MS = 2_000;
const TAURI_RUNTIME_POLL_INTERVAL_MS = 16;

interface ITauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;
}

const rootElement = document.getElementById('welcome-root');

if (!rootElement) {
  throw new Error('missing welcome root element');
}

try {
  window.localStorage.setItem(STARTUP_WELCOME_EPOCH_STORAGE_KEY, String(Date.now()));
} catch {
  // ignore storage write failures in preview or privacy-restricted environments
}

rootElement.innerHTML = svgRaw;

const getWelcomeSvg = (): SVGSVGElement | null => {
  const element = rootElement.querySelector('svg');
  if (!element) {
    return null;
  }

  if (typeof SVGSVGElement !== 'undefined' && element instanceof SVGSVGElement) {
    return element;
  }

  return element as SVGSVGElement;
};

const waitForNextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const waitForTauriRuntime = async (timeoutMs = TAURI_RUNTIME_WAIT_TIMEOUT_MS): Promise<boolean> => {
  const resolveInvoke = (): unknown =>
    (window as Window & { __TAURI_INTERNALS__?: ITauriInternals }).__TAURI_INTERNALS__?.invoke;

  if (typeof resolveInvoke() === 'function') {
    return true;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, TAURI_RUNTIME_POLL_INTERVAL_MS);
    });

    if (typeof resolveInvoke() === 'function') {
      return true;
    }
  }

  return typeof resolveInvoke() === 'function';
};

const invokeRuntimeCommand = async (
  command: string,
  args?: Record<string, unknown>,
): Promise<void> => {
  const invokeFn = (window as Window & { __TAURI_INTERNALS__?: ITauriInternals })
    .__TAURI_INTERNALS__?.invoke;

  if (typeof invokeFn !== 'function') {
    return;
  }

  await invokeFn(command, args);
};

const applyReducedMotionPreference = (matches: boolean): void => {
  const svgElement = getWelcomeSvg();
  if (!svgElement) {
    return;
  }

  if (matches) {
    svgElement.pauseAnimations();
    return;
  }

  svgElement.unpauseAnimations();
};

const bootWelcomeSurface = async (): Promise<void> => {
  const reducedMotionMediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  const handleReducedMotionChange = (event: MediaQueryListEvent): void => {
    applyReducedMotionPreference(event.matches);
  };

  applyReducedMotionPreference(reducedMotionMediaQuery.matches);
  reducedMotionMediaQuery.addEventListener('change', handleReducedMotionChange);
  window.addEventListener(
    'beforeunload',
    () => {
      reducedMotionMediaQuery.removeEventListener('change', handleReducedMotionChange);
      getWelcomeSvg()?.pauseAnimations();
    },
    { once: true },
  );

  await waitForNextPaint();

  if (await waitForTauriRuntime()) {
    await invokeRuntimeCommand('apply_window_stage', { stage: WELCOME_STAGE });
  }
};

void bootWelcomeSurface().catch((error) => {
  console.error('failed to bootstrap welcome surface', error);
});
