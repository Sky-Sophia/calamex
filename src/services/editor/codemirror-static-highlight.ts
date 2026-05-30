import type { LanguageSupport } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import {
  CODEMIRROR_GITHUB_LIGHT_BACKGROUND,
  CODEMIRROR_GITHUB_LIGHT_FOREGROUND,
  codeMirrorGithubLightHighlightStyle,
  type ICodeMirrorStaticTokenStyle,
  resolveCodeMirrorHighlightStyle,
} from '@/services/editor/codemirror-github-light-highlight';
import {
  loadCodeMirrorLanguageSupport,
  resolveCodeMirrorLanguageId,
  resolveCodeMirrorLanguageSupport,
} from '@/services/editor/codemirror-language';

export interface ICodeMirrorHighlightToken {
  content: string;
  color?: string;
  bgColor?: string;
  htmlStyle?: Readonly<Record<string, string>>;
  fontStyle?: number;
}

export interface ITokenizedCode {
  tokens: ICodeMirrorHighlightToken[][];
  fg: string;
  bg: string;
}

interface IHighlightedRange {
  from: number;
  to: number;
  classNames: string;
}

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const TOKENS_CACHE_LIMIT = 120;

const tokensCache = new Map<string, ITokenizedCode>();

export const isItalic = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & FONT_STYLE_ITALIC) !== 0);

export const isBold = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & FONT_STYLE_BOLD) !== 0);

export const isUnderline = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & FONT_STYLE_UNDERLINE) !== 0);

const getTokensCacheKey = (code: string, language: string): string => {
  const languageId = resolveCodeMirrorLanguageId(language);
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : '';
  return `${languageId}:${code.length}:${start}:${end}`;
};

const rememberTokens = (key: string, value: ITokenizedCode): void => {
  if (tokensCache.size >= TOKENS_CACHE_LIMIT) {
    const firstKey = tokensCache.keys().next().value;
    if (typeof firstKey === 'string') {
      tokensCache.delete(firstKey);
    }
  }

  tokensCache.set(key, value);
};

const toFontStyle = (style: ICodeMirrorStaticTokenStyle): number | undefined => {
  let fontStyle = 0;

  if (style.fontStyle === 'italic') {
    fontStyle |= FONT_STYLE_ITALIC;
  }
  if (style.fontWeight) {
    fontStyle |= FONT_STYLE_BOLD;
  }
  if (style.textDecoration === 'underline') {
    fontStyle |= FONT_STYLE_UNDERLINE;
  }

  return fontStyle === 0 ? undefined : fontStyle;
};

const toToken = (content: string, style?: ICodeMirrorStaticTokenStyle): ICodeMirrorHighlightToken => {
  if (!style) {
    return { content, color: 'inherit' };
  }

  const fontStyle = toFontStyle(style);
  return {
    content,
    color: style.color,
    bgColor: style.backgroundColor,
    fontStyle,
  };
};

const appendTokenContent = (
  lines: ICodeMirrorHighlightToken[][],
  content: string,
  style?: ICodeMirrorStaticTokenStyle,
): void => {
  if (!content) {
    return;
  }

  const parts = content.split('\n');
  for (const [partIndex, part] of parts.entries()) {
    if (partIndex > 0) {
      lines.push([]);
    }
    if (part) {
      const currentLine = lines.at(-1);
      currentLine?.push(toToken(part, style));
    }
  }
};

export const createRawTokens = (code: string): ITokenizedCode => ({
  tokens: code.split('\n').map((line) => (line === '' ? [] : [toToken(line)])),
  fg: CODEMIRROR_GITHUB_LIGHT_FOREGROUND,
  bg: CODEMIRROR_GITHUB_LIGHT_BACKGROUND,
});

// 用已加载的语法支持把代码解析成 token 行。
const buildTokenizedFromSupport = (
  code: string,
  support: LanguageSupport,
): ITokenizedCode | null => {
  try {
    const tree = support.language.parser.parse(code);
    const ranges: IHighlightedRange[] = [];
    highlightTree(tree, codeMirrorGithubLightHighlightStyle, (from, to, classNames) => {
      if (from < to && classNames) {
        ranges.push({ from, to, classNames });
      }
    });

    const lines: ICodeMirrorHighlightToken[][] = [[]];
    let position = 0;

    for (const range of ranges) {
      if (range.from > position) {
        appendTokenContent(lines, code.slice(position, range.from));
      }

      appendTokenContent(
        lines,
        code.slice(range.from, range.to),
        resolveCodeMirrorHighlightStyle(range.classNames),
      );
      position = range.to;
    }

    if (position < code.length) {
      appendTokenContent(lines, code.slice(position));
    }

    return {
      tokens: lines,
      fg: CODEMIRROR_GITHUB_LIGHT_FOREGROUND,
      bg: CODEMIRROR_GITHUB_LIGHT_BACKGROUND,
    };
  } catch (error) {
    console.error('CodeMirror 静态代码高亮失败', error);
    return null;
  }
};

/**
 * 同步高亮:仅当目标语法"已按需加载"时返回结果,否则返回 null。
 * 调用方应先用 createRawTokens 兜底,并通过 highlightCodeAsync 在语法加载后升级。
 */
export const highlightCodeSync = (
  code: string,
  language: string,
): ITokenizedCode | null => {
  const languageId = resolveCodeMirrorLanguageId(language);
  if (languageId === 'text') {
    return null;
  }

  const tokensCacheKey = getTokensCacheKey(code, languageId);
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }

  const support = resolveCodeMirrorLanguageSupport(languageId);
  if (!support) {
    return null;
  }

  const tokenized = buildTokenizedFromSupport(code, support);
  if (tokenized) {
    rememberTokens(tokensCacheKey, tokenized);
  }
  return tokenized;
};

/**
 * 异步高亮:按需加载目标语法后再解析高亮。语法包通过动态 import 代码分割。
 */
export const highlightCodeAsync = async (
  code: string,
  language: string,
): Promise<ITokenizedCode | null> => {
  const languageId = resolveCodeMirrorLanguageId(language);
  if (languageId === 'text') {
    return null;
  }

  const tokensCacheKey = getTokensCacheKey(code, languageId);
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }

  const support = await loadCodeMirrorLanguageSupport(languageId);
  if (!support) {
    return null;
  }

  const tokenized = buildTokenizedFromSupport(code, support);
  if (tokenized) {
    rememberTokens(tokensCacheKey, tokenized);
  }
  return tokenized;
};

/** @deprecated 使用 highlightCodeSync(同步缓存) 或 highlightCodeAsync(按需加载)。 */
export const highlightCode = highlightCodeSync;

const escapeHtml = (value: string): string =>
  value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const tokenStyleToHtml = (token: ICodeMirrorHighlightToken): string => {
  const declarations: string[] = [];
  if (token.color && token.color !== 'inherit') {
    declarations.push(`color:${token.color}`);
  }
  if (token.bgColor) {
    declarations.push(`background-color:${token.bgColor}`);
  }
  if (isItalic(token.fontStyle)) {
    declarations.push('font-style:italic');
  }
  if (isBold(token.fontStyle)) {
    declarations.push('font-weight:600');
  }
  if (isUnderline(token.fontStyle)) {
    declarations.push('text-decoration:underline');
  }

  return declarations.length > 0 ? ` style="${declarations.join(';')}"` : '';
};

const tokenToHtml = (token: ICodeMirrorHighlightToken): string =>
  `<span${tokenStyleToHtml(token)}>${escapeHtml(token.content)}</span>`;

/**
 * 同步生成高亮 HTML(供 LSP 文档等同步渲染场景)。
 * 若语法尚未加载,本次先用原始文本兜底,同时后台预热加载,下次渲染即可高亮。
 */
export const highlightCodeToHtml = (code: string, language: string): string => {
  const tokenized = highlightCodeSync(code, language);
  if (!tokenized && resolveCodeMirrorLanguageId(language) !== 'text') {
    // 后台按需加载,预热缓存(本次仍用兜底)。
    void loadCodeMirrorLanguageSupport(language);
  }

  const finalTokenized = tokenized ?? createRawTokens(code);
  const html = finalTokenized.tokens
    .map((line) => line.map((token) => tokenToHtml(token)).join(''))
    .join('\n');

  return `<pre class="cm-static-highlight" style="background-color:${finalTokenized.bg};color:${finalTokenized.fg}"><code>${html}</code></pre>`;
};
