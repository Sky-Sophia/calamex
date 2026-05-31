import { describe, expect, it } from 'vitest';
import { normalizeAiMath } from '@/components/business/ai/chat/normalize-math';

describe('normalizeAiMath', () => {
  it('不含盒子命令时原样返回（快路径）', () => {
    const source = '普通文本 $E = mc^2$ 与 \\frac{1}{2} 不应被改写';
    expect(normalizeAiMath(source)).toBe(source);
  });

  it('空字符串返回空字符串', () => {
    expect(normalizeAiMath('')).toBe('');
  });

  it('拆包单个 \\boxed 命令', () => {
    expect(normalizeAiMath('$$\\boxed{x + 1}$$')).toBe('$$x + 1$$');
  });

  it('拆包 \\fbox 命令', () => {
    expect(normalizeAiMath('\\fbox{abc}')).toBe('abc');
  });

  it('递归拆包嵌套盒子命令', () => {
    expect(normalizeAiMath('\\boxed{a \\boxed{b} c}')).toBe('a b c');
  });

  it('一段中存在多个盒子命令时全部拆包', () => {
    expect(normalizeAiMath('\\boxed{a} 和 \\fbox{b}')).toBe('a 和 b');
  });

  it('仅前缀相同的其它命令不被改写（词边界）', () => {
    const source = '\\boxedat{x}';
    expect(normalizeAiMath(source)).toBe(source);
  });

  it('分组未闭合时原样保留，闭合后再拆包（流式中途场景）', () => {
    const partial = '前文 \\boxed{x + ';
    expect(normalizeAiMath(partial)).toBe(partial);
    expect(normalizeAiMath('前文 \\boxed{x + 1}')).toBe('前文 x + 1');
  });

  it('保留分组内的 LaTeX 转义大括号', () => {
    expect(normalizeAiMath('\\boxed{a \\{ b \\} c}')).toBe('a \\{ b \\} c');
  });
});
