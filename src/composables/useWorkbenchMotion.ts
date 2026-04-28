import { nextTick, onScopeDispose, readonly, ref, type Ref } from 'vue';

import { useElementFlip } from '@/composables/useElementFlip';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { WORKBENCH_MOTION_TOKENS } from '@/constants/motion';
import type { IFlipElementDescriptor, TWorkbenchMotionState } from '@/types/motion';
import {
  SHELL_WINDOW_RESIZE_END_EVENT,
  SHELL_WINDOW_RESIZE_START_EVENT,
} from '@/utils/window-resize-events';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface IUseWorkbenchMotionOptions {
  shellRef: Ref<HTMLElement | null>;
  sidebarRef: Ref<HTMLElement | null>;
  rightSidebarRef: Ref<HTMLElement | null>;
  terminalRef: Ref<HTMLElement | null>;
  setLayoutTransitionsEnabled: (enabled: boolean) => void;
}

/** 描述一次 FLIP 过渡的"差异部分"。公共骨架由 runFlipTransition 复用。 */
interface IFlipTransitionSpec {
  resolveElements: () => IFlipElementDescriptor[];
  openingState: TWorkbenchMotionState;
  closingState: TWorkbenchMotionState;
  transformOrigin: 'top left' | 'top right' | 'bottom left';
  opacity: boolean;
  /** 是否在主路径与 reduced 路径中广播 resize START / END 事件。 */
  dispatchResizeEvents: boolean;
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

const dispatchWorkbenchResizeEvent = (eventName: string): void => {
  window.dispatchEvent(new Event(eventName));
};

const resolveSingleElement = (
  target: Ref<HTMLElement | null>,
  key: string,
  transformOrigin?: string,
): IFlipElementDescriptor[] => {
  const el = target.value;
  return el ? [{ key, element: el, opacity: true, transformOrigin }] : [];
};

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export const useWorkbenchMotion = ({
  shellRef,
  sidebarRef,
  rightSidebarRef,
  terminalRef,
  setLayoutTransitionsEnabled,
}: IUseWorkbenchMotionOptions) => {
  const motionState = ref<TWorkbenchMotionState>('idle');
  const { isReducedMotion } = useReducedMotion();
  const flip = useElementFlip();

  let activeController: { cancel: () => void } | null = null;
  let transitionVersion = 0;

  const resolveFlipElements = (): IFlipElementDescriptor[] =>
    resolveSingleElement(sidebarRef, 'sidebar', 'top left');

  const resolveTerminalFlipElements = (): IFlipElementDescriptor[] =>
    resolveSingleElement(terminalRef, 'terminal', 'bottom left');

  const resolveRightSidebarFlipElements = (): IFlipElementDescriptor[] =>
    resolveSingleElement(rightSidebarRef, 'right-sidebar', 'top right');

  const resolveSidebarsFlipElements = (
    includeSidebar: boolean,
    includeRightSidebar: boolean,
  ): IFlipElementDescriptor[] => [
    ...(includeSidebar ? resolveFlipElements() : []),
    ...(includeRightSidebar ? resolveRightSidebarFlipElements() : []),
  ];

  const settleWorkbench = async (
    version: number,
    elements: readonly IFlipElementDescriptor[],
    shouldDispatchResizeEvents = true,
  ): Promise<void> => {
    if (version !== transitionVersion) return;

    motionState.value = 'settling';
    activeController = null;
    flip.clearTemporaryStyles(elements);

    if (shouldDispatchResizeEvents) {
      dispatchWorkbenchResizeEvent(SHELL_WINDOW_RESIZE_END_EVENT);
    }

    await nextTick();
    setLayoutTransitionsEnabled(true);
    motionState.value = 'idle';
  };

  const runReducedTransition = async (
    version: number,
    elements: readonly IFlipElementDescriptor[],
    shouldDispatchResizeEvents = true,
  ): Promise<void> => {
    motionState.value = 'reduced';

    if (shouldDispatchResizeEvents) {
      dispatchWorkbenchResizeEvent(SHELL_WINDOW_RESIZE_START_EVENT);
    }

    await nextTick();
    await settleWorkbench(version, elements, shouldDispatchResizeEvents);
  };

  /**
   * 通用 FLIP 过渡执行器：捕获首帧 → 切 motion state → 触发 resize START
   * → nextTick → animate → finished → settleWorkbench。
   */
  const runFlipTransition = async (
    nextVisible: boolean,
    spec: IFlipTransitionSpec,
  ): Promise<void> => {
    const version = ++transitionVersion;
    const elements = spec.resolveElements();

    activeController?.cancel();
    activeController = null;
    setLayoutTransitionsEnabled(false);

    if (!shellRef.value || elements.length === 0 || isReducedMotion.value) {
      await runReducedTransition(version, elements, spec.dispatchResizeEvents);
      return;
    }

    const firstRects = flip.captureRects(elements);
    motionState.value = nextVisible ? spec.openingState : spec.closingState;

    if (spec.dispatchResizeEvents) {
      dispatchWorkbenchResizeEvent(SHELL_WINDOW_RESIZE_START_EVENT);
    }

    await nextTick();
    if (version !== transitionVersion) return;

    const controller = await flip.animateFromFirstRects(elements, firstRects, {
      duration: nextVisible
        ? WORKBENCH_MOTION_TOKENS.duration.workbenchOpen
        : WORKBENCH_MOTION_TOKENS.duration.workbenchClose,
      easing: nextVisible
        ? WORKBENCH_MOTION_TOKENS.easing.emphasized
        : WORKBENCH_MOTION_TOKENS.easing.standard,
      opacity: spec.opacity,
      transformOrigin: spec.transformOrigin,
    });
    activeController = controller;

    await controller.finished;
    await settleWorkbench(version, elements, spec.dispatchResizeEvents);
  };

  const transitionSidebar = (nextVisible: boolean): Promise<void> =>
    runFlipTransition(nextVisible, {
      resolveElements: resolveFlipElements,
      openingState: 'opening',
      closingState: 'closing',
      transformOrigin: 'top left',
      opacity: false,
      dispatchResizeEvents: false,
    });

  const transitionRightSidebar = (nextVisible: boolean): Promise<void> =>
    runFlipTransition(nextVisible, {
      resolveElements: resolveRightSidebarFlipElements,
      openingState: 'right-sidebar-opening',
      closingState: 'right-sidebar-closing',
      transformOrigin: 'top right',
      opacity: false,
      dispatchResizeEvents: false,
    });

  const transitionSidebars = (
    sidebarVisible: boolean,
    rightSidebarVisible: boolean,
    options: {
      sidebarChanged: boolean;
      rightSidebarChanged: boolean;
    },
  ): Promise<void> => {
    const isOpening = rightSidebarVisible || (options.sidebarChanged && sidebarVisible);
    return runFlipTransition(isOpening, {
      resolveElements: () =>
        resolveSidebarsFlipElements(options.sidebarChanged, options.rightSidebarChanged),
      openingState: rightSidebarVisible ? 'right-sidebar-opening' : 'opening',
      closingState: options.rightSidebarChanged ? 'right-sidebar-closing' : 'closing',
      transformOrigin: 'top left',
      opacity: false,
      dispatchResizeEvents: false,
    });
  };

  const transitionTerminal = (nextVisible: boolean): Promise<void> =>
    runFlipTransition(nextVisible, {
      resolveElements: resolveTerminalFlipElements,
      openingState: 'terminal-opening',
      closingState: 'terminal-closing',
      transformOrigin: 'bottom left',
      opacity: true,
      dispatchResizeEvents: true,
    });

  onScopeDispose(() => {
    transitionVersion += 1;
    activeController?.cancel();
    activeController = null;
    flip.cancelActiveAnimations();
  });

  return {
    motionState: readonly(motionState),
    transitionSidebar,
    transitionRightSidebar,
    transitionSidebars,
    transitionTerminal,
  };
};
