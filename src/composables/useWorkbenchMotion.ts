import { useElementFlip } from '@/composables/useElementFlip';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { WORKBENCH_MOTION_TOKENS } from '@/constants/motion';
import type { IFlipElementDescriptor, TWorkbenchMotionState } from '@/types/motion';
import {
  SHELL_WINDOW_RESIZE_END_EVENT,
  SHELL_WINDOW_RESIZE_START_EVENT,
} from '@/utils/window-resize-events';
import { nextTick, onScopeDispose, readonly, ref, type Ref } from 'vue';

interface IUseWorkbenchMotionOptions {
  shellRef: Ref<HTMLElement | null>;
  sidebarRef: Ref<HTMLElement | null>;
  terminalRef: Ref<HTMLElement | null>;
  setLayoutTransitionsEnabled: (enabled: boolean) => void;
}

const dispatchWorkbenchResizeEvent = (eventName: string): void => {
  window.dispatchEvent(new Event(eventName));
};

export const useWorkbenchMotion = ({
  shellRef,
  sidebarRef,
  terminalRef,
  setLayoutTransitionsEnabled,
}: IUseWorkbenchMotionOptions) => {
  const motionState = ref<TWorkbenchMotionState>('idle');
  const { isReducedMotion } = useReducedMotion();
  const flip = useElementFlip();
  let activeController: { cancel: () => void } | null = null;
  let transitionVersion = 0;

  const resolveFlipElements = (): IFlipElementDescriptor[] => {
    const elements: IFlipElementDescriptor[] = [];

    if (sidebarRef.value) {
      elements.push({ key: 'sidebar', element: sidebarRef.value, opacity: true });
    }

    return elements;
  };

  const resolveTerminalFlipElements = (): IFlipElementDescriptor[] => {
    const elements: IFlipElementDescriptor[] = [];

    if (terminalRef.value) {
      elements.push({ key: 'terminal', element: terminalRef.value, opacity: true });
    }

    return elements;
  };

  const settleWorkbench = async (
    version: number,
    elements: readonly IFlipElementDescriptor[],
    shouldDispatchResizeEvents = true,
  ): Promise<void> => {
    if (version !== transitionVersion) {
      return;
    }

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
    shouldDispatchResizeEvents = true,
  ): Promise<void> => {
    motionState.value = 'reduced';
    if (shouldDispatchResizeEvents) {
      dispatchWorkbenchResizeEvent(SHELL_WINDOW_RESIZE_START_EVENT);
    }
    await nextTick();
    await settleWorkbench(version, resolveFlipElements(), shouldDispatchResizeEvents);
  };

  const transitionSidebar = async (nextVisible: boolean): Promise<void> => {
    const version = transitionVersion + 1;
    transitionVersion = version;
    const direction: TWorkbenchMotionState = nextVisible ? 'opening' : 'closing';
    const elements = resolveFlipElements();

    activeController?.cancel();
    activeController = null;
    setLayoutTransitionsEnabled(false);

    if (!shellRef.value || elements.length === 0 || isReducedMotion.value) {
      await runReducedTransition(version, false);
      return;
    }

    const firstRects = flip.captureRects(elements);
    motionState.value = direction;

    await nextTick();

    if (version !== transitionVersion) {
      return;
    }

    const controller = await flip.animateFromFirstRects(elements, firstRects, {
      duration: nextVisible
        ? WORKBENCH_MOTION_TOKENS.duration.workbenchOpen
        : WORKBENCH_MOTION_TOKENS.duration.workbenchClose,
      easing: nextVisible
        ? WORKBENCH_MOTION_TOKENS.easing.emphasized
        : WORKBENCH_MOTION_TOKENS.easing.standard,
      opacity: false,
      transformOrigin: 'top left',
    });
    activeController = controller;
    await controller.finished;
    await settleWorkbench(version, elements, false);
  };

  const transitionTerminal = async (nextVisible: boolean): Promise<void> => {
    const version = transitionVersion + 1;
    transitionVersion = version;
    const elements = resolveTerminalFlipElements();

    activeController?.cancel();
    activeController = null;
    setLayoutTransitionsEnabled(false);

    if (!shellRef.value || elements.length === 0 || isReducedMotion.value) {
      await runReducedTransition(version);
      return;
    }

    const firstRects = flip.captureRects(elements);
    motionState.value = nextVisible ? 'terminal-opening' : 'terminal-closing';
    dispatchWorkbenchResizeEvent(SHELL_WINDOW_RESIZE_START_EVENT);

    await nextTick();

    if (version !== transitionVersion) {
      return;
    }

    const controller = await flip.animateFromFirstRects(elements, firstRects, {
      duration: nextVisible
        ? WORKBENCH_MOTION_TOKENS.duration.workbenchOpen
        : WORKBENCH_MOTION_TOKENS.duration.workbenchClose,
      easing: nextVisible
        ? WORKBENCH_MOTION_TOKENS.easing.emphasized
        : WORKBENCH_MOTION_TOKENS.easing.standard,
      opacity: true,
      transformOrigin: 'bottom left',
    });
    activeController = controller;
    await controller.finished;
    await settleWorkbench(version, elements);
  };

  onScopeDispose(() => {
    transitionVersion += 1;
    activeController?.cancel();
    activeController = null;
    flip.cancelActiveAnimations();
  });

  return {
    motionState: readonly(motionState),
    transitionSidebar,
    transitionTerminal,
  };
};
