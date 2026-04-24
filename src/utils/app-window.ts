export const MAIN_WINDOW_LABEL = 'main';
export const WELCOME_WINDOW_LABEL = 'welcome';

export type TAppWindowLabel = typeof MAIN_WINDOW_LABEL | typeof WELCOME_WINDOW_LABEL;
export type TBootstrapRouteName = 'home' | 'welcome';

export const normalizeAppWindowLabel = (value: unknown): TAppWindowLabel =>
  value === WELCOME_WINDOW_LABEL ? WELCOME_WINDOW_LABEL : MAIN_WINDOW_LABEL;

export const getCurrentAppWindowLabel = (): TAppWindowLabel => {
  if (typeof window === 'undefined') {
    return MAIN_WINDOW_LABEL;
  }

  return normalizeAppWindowLabel(window.__SH_WINDOW_LABEL__);
};

export const isWelcomeWindow = (): boolean => getCurrentAppWindowLabel() === WELCOME_WINDOW_LABEL;

export const getBootstrapRouteName = (): TBootstrapRouteName =>
  isWelcomeWindow() ? 'welcome' : 'home';
