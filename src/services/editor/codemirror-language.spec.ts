import { describe, expect, it } from 'vitest';

import { LanguageSupport, StreamLanguage } from '@codemirror/language';

import { resolveCodeMirrorLanguageExtension } from './codemirror-language';

describe('resolveCodeMirrorLanguageExtension', () => {
  it('为 Vue 文件使用官方 Vue 语言支持', () => {
    const extension = resolveCodeMirrorLanguageExtension('vue');

    expect(extension).toBeInstanceOf(LanguageSupport);
    expect((extension as LanguageSupport).language.name).toBe('vue');
  });

  it('为 Shell 文件使用 CodeMirror 官方 legacy shell mode', () => {
    const extension = resolveCodeMirrorLanguageExtension('shell');

    expect(extension).toBeInstanceOf(StreamLanguage);
  });
});
