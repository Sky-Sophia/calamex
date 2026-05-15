export const MAIN_WINDOW_LABEL = 'main';

type TAppWindowLabel = typeof MAIN_WINDOW_LABEL;

const normalizeAppWindowLabel = (): TAppWindowLabel => MAIN_WINDOW_LABEL;

export const getCurrentAppWindowLabel = (): TAppWindowLabel => {
  if (typeof window === 'undefined') {
    return MAIN_WINDOW_LABEL;
  }

  return window.__SH_WINDOW_LABEL__ === MAIN_WINDOW_LABEL
    ? MAIN_WINDOW_LABEL
    : normalizeAppWindowLabel();
};
