import type { BundledLanguage, BundledTheme, HighlighterGeneric, ThemedToken } from 'shiki';
import { createHighlighter } from 'shiki';

export interface ITokenizedCode {
  tokens: ThemedToken[][];
  fg: string;
  bg: string;
}

const HIGHLIGHTER_CACHE = new Map<string, Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>>();
const TOKENS_CACHE = new Map<string, ITokenizedCode>();
const SUBSCRIBERS = new Map<string, Set<(result: ITokenizedCode) => void>>();

export const isItalic = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & 1) !== 0);

export const isBold = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & 2) !== 0);

export const isUnderline = (fontStyle: number | undefined): boolean =>
  Boolean(fontStyle && (fontStyle & 4) !== 0);

const getTokensCacheKey = (code: string, language: BundledLanguage): string => {
  const start = code.slice(0, 100);
  const end = code.length > 100 ? code.slice(-100) : '';
  return `${language}:${code.length}:${start}:${end}`;
};

const getHighlighter = (
  language: BundledLanguage,
): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> => {
  const cached = HIGHLIGHTER_CACHE.get(language);

  if (cached) {
    return cached;
  }

  const highlighterPromise = createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [language],
  });

  HIGHLIGHTER_CACHE.set(language, highlighterPromise);
  return highlighterPromise;
};

export const createRawTokens = (code: string): ITokenizedCode => ({
  tokens: code.split('\n').map((line) =>
    line === ''
      ? []
      : [{
          content: line,
          color: 'inherit',
        } as ThemedToken],
  ),
  fg: 'inherit',
  bg: 'transparent',
});

export const highlightCode = (
  code: string,
  language: BundledLanguage,
  callback?: (result: ITokenizedCode) => void,
): ITokenizedCode | null => {
  const tokensCacheKey = getTokensCacheKey(code, language);
  const cached = TOKENS_CACHE.get(tokensCacheKey);

  if (cached) {
    return cached;
  }

  if (callback) {
    const existingSubscribers = SUBSCRIBERS.get(tokensCacheKey);

    if (existingSubscribers) {
      existingSubscribers.add(callback);
    } else {
      SUBSCRIBERS.set(tokensCacheKey, new Set([callback]));
    }
  }

  void getHighlighter(language)
    .then((highlighter) => {
      const availableLanguages = highlighter.getLoadedLanguages();
      const languageToUse = availableLanguages.includes(language) ? language : 'text';
      const result = highlighter.codeToTokens(code, {
        lang: languageToUse,
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
      });
      const tokenized: ITokenizedCode = {
        tokens: result.tokens,
        fg: result.fg ?? 'inherit',
        bg: result.bg ?? 'transparent',
      };

      TOKENS_CACHE.set(tokensCacheKey, tokenized);

      const subscribers = SUBSCRIBERS.get(tokensCacheKey);

      if (!subscribers) {
        return;
      }

      for (const subscriber of subscribers) {
        subscriber(tokenized);
      }

      SUBSCRIBERS.delete(tokensCacheKey);
    })
    .catch((error: unknown) => {
      console.error('代码高亮失败', error);
      SUBSCRIBERS.delete(tokensCacheKey);
    });

  return null;
};
