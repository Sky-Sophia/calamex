import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('合并多个 class 字符串', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('后出现的 Tailwind 冲突类覆盖先前的类', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('忽略假值并支持数组与条件对象', () => {
    expect(cn('a', false && 'b', null, undefined, ['c'])).toBe('a c');
    expect(cn({ foo: true, bar: false })).toBe('foo');
  });
});
