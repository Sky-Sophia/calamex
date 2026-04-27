import type { IWorkbenchMotionTokens } from '@/types/motion';

export const WORKBENCH_MOTION_TOKENS: IWorkbenchMotionTokens = {
  duration: {
    instant: 0,
    fast: 140,
    normal: 180,
    slow: 260,
    workbenchOpen: 300,
    workbenchClose: 260,
    reduced: 80,
  },
  easing: {
    standard: 'cubic-bezier(0.22, 1, 0.36, 1)',
    emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    linear: 'linear',
  },
  layer: {
    sidebar: 20,
    overlay: 35,
    workbench: 10,
    terminal: 12,
  },
  reduced: {
    opacityOnly: true,
  },
  dropdown: {
    duration: {
      open: 160,
      close: 110,
      item: 80,
      reduced: 60,
    },
    offsetY: 6,
    openScaleFrom: 0.97,
    openScaleTo: 1,
    closeScaleTo: 0.985,
  },
} as const;

export const WORKBENCH_MOTION_CSS_VARS = {
  durationOpen: '--motion-duration-workbench-open',
  durationClose: '--motion-duration-workbench-close',
  easingStandard: '--motion-easing-standard',
  easingEmphasized: '--motion-easing-emphasized',
  easingExit: '--motion-easing-exit',
} as const;
