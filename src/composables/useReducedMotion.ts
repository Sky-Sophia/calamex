import { onScopeDispose, readonly, ref } from 'vue';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const useReducedMotion = () => {
  const isReducedMotion = ref(false);

  if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
    return {
      isReducedMotion: readonly(isReducedMotion),
    };
  }

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  const syncReducedMotion = (): void => {
    isReducedMotion.value = mediaQuery.matches;
  };

  syncReducedMotion();
  mediaQuery.addEventListener('change', syncReducedMotion);

  onScopeDispose(() => {
    mediaQuery.removeEventListener('change', syncReducedMotion);
  });

  return {
    isReducedMotion: readonly(isReducedMotion),
  };
};
