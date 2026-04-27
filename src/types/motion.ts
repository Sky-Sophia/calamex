export type TWorkbenchMotionState =
  | 'idle'
  | 'opening'
  | 'closing'
  | 'terminal-opening'
  | 'terminal-closing'
  | 'settling'
  | 'reduced';

export interface IWorkbenchMotionDurations {
  instant: number;
  fast: number;
  normal: number;
  slow: number;
  workbenchOpen: number;
  workbenchClose: number;
  reduced: number;
}

export interface IDropdownMotionDurations {
  open: number;
  close: number;
  item: number;
  reduced: number;
}

export interface IWorkbenchMotionEasings {
  standard: string;
  emphasized: string;
  exit: string;
  linear: string;
}

export interface IWorkbenchMotionLayers {
  sidebar: number;
  overlay: number;
  workbench: number;
  terminal: number;
}

export interface IDropdownMotionTokens {
  duration: IDropdownMotionDurations;
  offsetY: number;
  openScaleFrom: number;
  openScaleTo: number;
  closeScaleTo: number;
}

export interface IWorkbenchMotionTokens {
  duration: IWorkbenchMotionDurations;
  easing: IWorkbenchMotionEasings;
  layer: IWorkbenchMotionLayers;
  reduced: {
    opacityOnly: boolean;
  };
  dropdown: IDropdownMotionTokens;
}

export type TDropdownMotionOrigin =
  | 'top left'
  | 'top center'
  | 'top right'
  | 'bottom left'
  | 'bottom center'
  | 'bottom right';

export type TDropdownMotionState = 'entering' | 'open' | 'leaving' | 'closed' | 'reduced';

export interface IFlipElementDescriptor {
  element: HTMLElement;
  key: string;
  opacity?: boolean;
}

export interface IFlipAnimationOptions {
  duration: number;
  easing: string;
  opacity?: boolean;
  transformOrigin?: string;
}

export interface IFlipAnimationController {
  finished: Promise<void>;
  cancel: () => void;
}
