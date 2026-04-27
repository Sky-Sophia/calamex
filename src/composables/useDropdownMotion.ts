import { useReducedMotion } from '@/composables/useReducedMotion';
import { WORKBENCH_MOTION_TOKENS } from '@/constants/motion';
import type { TDropdownMotionOrigin, TDropdownMotionState } from '@/types/motion';
import { computed, nextTick, onScopeDispose, readonly, ref, watch, type Ref } from 'vue';

interface IUseDropdownMotionOptions {
  open: Ref<boolean>;
  panelRef: Ref<HTMLElement | null>;
  origin?: Ref<TDropdownMotionOrigin>;
}

const DEFAULT_ORIGIN: TDropdownMotionOrigin = 'top left';

const resolveTranslateY = (origin: TDropdownMotionOrigin, offset: number): number =>
  origin.startsWith('bottom') ? offset : -offset;

export const useDropdownMotion = ({ open, panelRef, origin }: IUseDropdownMotionOptions) => {
  const { isReducedMotion } = useReducedMotion();
  const shouldRender = ref(open.value);
  const motionState = ref<TDropdownMotionState>(open.value ? 'open' : 'closed');
  let activeAnimation: Animation | null = null;
  let motionVersion = 0;

  const transformOrigin = computed(() => origin?.value ?? DEFAULT_ORIGIN);

  const cancelActiveAnimation = (): void => {
    activeAnimation?.cancel();
    activeAnimation = null;
  };

  const clearTemporaryStyles = (element: HTMLElement): void => {
    element.style.willChange = '';
  };

  const animatePanel = async (isOpening: boolean, version: number): Promise<void> => {
    await nextTick();
    const panel = panelRef.value;
    if (!panel || version !== motionVersion) {
      return;
    }

    cancelActiveAnimation();
    panel.style.transformOrigin = transformOrigin.value;
    panel.style.willChange = 'transform, opacity';

    const y = resolveTranslateY(transformOrigin.value, WORKBENCH_MOTION_TOKENS.dropdown.offsetY);
    const duration = isReducedMotion.value
      ? WORKBENCH_MOTION_TOKENS.dropdown.duration.reduced
      : isOpening
        ? WORKBENCH_MOTION_TOKENS.dropdown.duration.open
        : WORKBENCH_MOTION_TOKENS.dropdown.duration.close;
    const easing = isOpening
      ? WORKBENCH_MOTION_TOKENS.easing.emphasized
      : WORKBENCH_MOTION_TOKENS.easing.exit;

    const keyframes: Keyframe[] = isReducedMotion.value
      ? [{ opacity: isOpening ? 0 : 1 }, { opacity: isOpening ? 1 : 0 }]
      : isOpening
        ? [
            {
              opacity: 0,
              transform: `translate3d(0, ${y}px, 0) scale(${WORKBENCH_MOTION_TOKENS.dropdown.openScaleFrom})`,
            },
            {
              opacity: 1,
              transform: `translate3d(0, 0, 0) scale(${WORKBENCH_MOTION_TOKENS.dropdown.openScaleTo})`,
            },
          ]
        : [
            {
              opacity: 1,
              transform: `translate3d(0, 0, 0) scale(${WORKBENCH_MOTION_TOKENS.dropdown.openScaleTo})`,
            },
            {
              opacity: 0,
              transform: `translate3d(0, ${Math.round(y / 2)}px, 0) scale(${WORKBENCH_MOTION_TOKENS.dropdown.closeScaleTo})`,
            },
          ];

    motionState.value = isReducedMotion.value ? 'reduced' : isOpening ? 'entering' : 'leaving';
    if (typeof panel.animate !== 'function') {
      clearTemporaryStyles(panel);
      motionState.value = isOpening ? 'open' : 'closed';
      if (!isOpening) {
        shouldRender.value = false;
      }
      return;
    }

    const animation = panel.animate(keyframes, {
      duration,
      easing,
      fill: 'both',
    });
    activeAnimation = animation;

    await animation.finished.catch(() => undefined);

    if (version !== motionVersion) {
      return;
    }

    activeAnimation = null;
    clearTemporaryStyles(panel);
    motionState.value = isOpening ? 'open' : 'closed';
    if (!isOpening) {
      shouldRender.value = false;
    }
  };

  watch(
    open,
    (nextOpen) => {
      const version = motionVersion + 1;
      motionVersion = version;

      if (nextOpen) {
        shouldRender.value = true;
        void animatePanel(true, version);
        return;
      }

      if (!shouldRender.value) {
        motionState.value = 'closed';
        return;
      }

      void animatePanel(false, version);
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(() => {
    motionVersion += 1;
    cancelActiveAnimation();
  });

  return {
    shouldRender: readonly(shouldRender),
    motionState: readonly(motionState),
    transformOrigin,
  };
};
