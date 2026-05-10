import type { ComputedRef, InjectionKey } from 'vue';
import { inject } from 'vue';

export interface ICodeBlockContext {
  code: ComputedRef<string>;
}

export const CodeBlockKey: InjectionKey<ICodeBlockContext> = Symbol('CodeBlock');

export function useCodeBlockContext(): ICodeBlockContext {
  const context = inject(CodeBlockKey);

  if (!context) {
    throw new Error('CodeBlockCopyButton 必须在 <CodeBlock /> 内使用');
  }

  return context;
}
