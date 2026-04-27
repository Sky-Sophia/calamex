import type {
  IFlipAnimationController,
  IFlipAnimationOptions,
  IFlipElementDescriptor,
} from '@/types/motion';
import { onScopeDispose } from 'vue';

type TFlipRectMap = Map<string, DOMRect>;

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const resolveScale = (firstSize: number, lastSize: number): number => {
  if (firstSize <= 0 || lastSize <= 0) {
    return 1;
  }

  return firstSize / lastSize;
};

const buildFlipTransform = (first: DOMRect, last: DOMRect): string => {
  const deltaX = first.left - last.left;
  const deltaY = first.top - last.top;
  const scaleX = resolveScale(first.width, last.width);
  const scaleY = resolveScale(first.height, last.height);

  return `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
};

const shouldSkipTransform = (first: DOMRect, last: DOMRect): boolean => {
  const deltaX = Math.abs(first.left - last.left);
  const deltaY = Math.abs(first.top - last.top);
  const deltaWidth = Math.abs(first.width - last.width);
  const deltaHeight = Math.abs(first.height - last.height);

  return deltaX < 0.5 && deltaY < 0.5 && deltaWidth < 0.5 && deltaHeight < 0.5;
};

export const useElementFlip = () => {
  let activeAnimations: Animation[] = [];

  const cancelActiveAnimations = (): void => {
    for (const animation of activeAnimations) {
      animation.cancel();
    }
    activeAnimations = [];
  };

  const captureRects = (items: readonly IFlipElementDescriptor[]): TFlipRectMap => {
    const rects: TFlipRectMap = new Map();

    for (const item of items) {
      rects.set(item.key, item.element.getBoundingClientRect());
    }

    return rects;
  };

  const clearTemporaryStyles = (items: readonly IFlipElementDescriptor[]): void => {
    for (const item of items) {
      item.element.style.transform = '';
      item.element.style.opacity = '';
      item.element.style.transformOrigin = '';
      item.element.style.willChange = '';
    }
  };

  const animateFromFirstRects = async (
    items: readonly IFlipElementDescriptor[],
    firstRects: TFlipRectMap,
    options: IFlipAnimationOptions,
  ): Promise<IFlipAnimationController> => {
    cancelActiveAnimations();
    clearTemporaryStyles(items);
    await frame();

    const animations: Animation[] = [];

    for (const item of items) {
      const first = firstRects.get(item.key);
      if (!first) {
        continue;
      }

      const last = item.element.getBoundingClientRect();
      item.element.style.transformOrigin = options.transformOrigin ?? 'top left';
      item.element.style.willChange = item.opacity || options.opacity ? 'transform, opacity' : 'transform';

      const keyframes: Keyframe[] = [];
      if (!shouldSkipTransform(first, last)) {
        keyframes.push({
          transform: buildFlipTransform(first, last),
          opacity: item.opacity || options.opacity ? 0.82 : undefined,
        });
        keyframes.push({
          transform: 'translate(0, 0) scale(1, 1)',
          opacity: 1,
        });
      } else if (item.opacity || options.opacity) {
        keyframes.push({ opacity: 0.88 });
        keyframes.push({ opacity: 1 });
      }

      if (keyframes.length === 0) {
        item.element.style.willChange = '';
        item.element.style.transformOrigin = '';
        continue;
      }

      const animation = item.element.animate(keyframes, {
        duration: options.duration,
        easing: options.easing,
        fill: 'both',
      });
      animations.push(animation);
    }

    activeAnimations = animations;

    const finished = Promise.all(
      animations.map((animation) =>
        animation.finished
          .then(() => undefined)
          .catch(() => undefined),
      ),
    ).then(() => {
      if (activeAnimations === animations) {
        activeAnimations = [];
      }
      clearTemporaryStyles(items);
    });

    return {
      finished,
      cancel: () => {
        for (const animation of animations) {
          animation.cancel();
        }
        if (activeAnimations === animations) {
          activeAnimations = [];
        }
        clearTemporaryStyles(items);
      },
    };
  };

  onScopeDispose(() => {
    cancelActiveAnimations();
  });

  return {
    captureRects,
    clearTemporaryStyles,
    animateFromFirstRects,
    cancelActiveAnimations,
  };
};
