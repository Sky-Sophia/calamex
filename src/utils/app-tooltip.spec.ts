import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAppTooltipSystem } from './app-tooltip';

const TOOLTIP_TEXT = '延迟显示提示';

const createTooltipTarget = (): HTMLButtonElement => {
  const target = document.createElement('button');
  target.type = 'button';
  target.className = 'app-tooltip-target';
  target.dataset.tooltip = TOOLTIP_TEXT;
  target.getBoundingClientRect = () =>
    ({
      x: 20,
      y: 24,
      width: 80,
      height: 24,
      top: 24,
      right: 100,
      bottom: 48,
      left: 20,
      toJSON: () => undefined,
    }) as DOMRect;

  document.body.appendChild(target);
  return target;
};

const getTooltipElement = (): HTMLDivElement => {
  const tooltipElement = document.querySelector<HTMLDivElement>('#app-global-tooltip');
  if (!tooltipElement) {
    throw new Error('Tooltip element not initialized');
  }

  Object.defineProperty(tooltipElement, 'offsetWidth', {
    configurable: true,
    get: () => 96,
  });
  Object.defineProperty(tooltipElement, 'offsetHeight', {
    configurable: true,
    get: () => 28,
  });

  return tooltipElement;
};

describe('initAppTooltipSystem', () => {
  let hoverHitTarget: Element | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    hoverHitTarget = null;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => hoverHitTarget),
    });
  });

  afterEach(() => {
    window.__SH_APP_TOOLTIP_CLEANUP__?.();
    window.__SH_APP_TOOLTIP_CLEANUP__ = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('鼠标悬停满 3 秒后才显示 tooltip', () => {
    const target = createTooltipTarget();
    hoverHitTarget = target;

    initAppTooltipSystem();
    const tooltipElement = getTooltipElement();

    target.dispatchEvent(new MouseEvent('pointerover', {
      bubbles: true,
      clientX: 36,
      clientY: 32,
    }));

    expect(tooltipElement.classList.contains('is-visible')).toBe(false);

    vi.advanceTimersByTime(2999);
    expect(tooltipElement.classList.contains('is-visible')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(tooltipElement.classList.contains('is-visible')).toBe(true);
    expect(tooltipElement.textContent).toBe(TOOLTIP_TEXT);
  });

  it('鼠标在 3 秒内移出时不显示 tooltip', () => {
    const target = createTooltipTarget();
    hoverHitTarget = target;

    initAppTooltipSystem();
    const tooltipElement = getTooltipElement();

    target.dispatchEvent(new MouseEvent('pointerover', {
      bubbles: true,
      clientX: 36,
      clientY: 32,
    }));
    hoverHitTarget = null;
    target.dispatchEvent(new MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: null,
    }));

    vi.advanceTimersByTime(3000);
    expect(tooltipElement.classList.contains('is-visible')).toBe(false);
    expect(tooltipElement.textContent).toBe('');
  });

  it('键盘 focus 进入时仍然立即显示 tooltip', () => {
    const target = createTooltipTarget();

    initAppTooltipSystem();
    const tooltipElement = getTooltipElement();

    target.dispatchEvent(new FocusEvent('focusin', {
      bubbles: true,
      relatedTarget: null,
    }));

    expect(tooltipElement.classList.contains('is-visible')).toBe(true);
    expect(tooltipElement.textContent).toBe(TOOLTIP_TEXT);
  });
});
