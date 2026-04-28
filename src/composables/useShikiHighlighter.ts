import { isAiSupportedLang } from '@/services/modules/ai-code-detect';
import { getThemeManager, onThemeChanged } from '@/themes';
import type { TAiSupportedLang } from '@/types/ai-code';
import { createHighlighter } from 'shiki';
import { readonly, ref } from 'vue';

type THighlighter = Awaited<ReturnType<typeof createHighlighter>>;
type TShikiTheme = 'github-dark-default' | 'github-light-default';
type TRenderableShikiLang = Exclude<TAiSupportedLang, 'patch'> | 'diff';

let highlighterPromise: Promise<THighlighter> | null = null;
const shikiThemeVersion = ref(0);

const SHIKI_THEMES: readonly TShikiTheme[] = ['github-dark-default', 'github-light-default'];
const SHIKI_LANGS = ['plaintext', 'bash', 'sh', 'diff', 'ts', 'js', 'json'] as const;

let currentThemeName: TShikiTheme = getThemeManager().getMode() === 'light'
  ? 'github-light-default'
  : 'github-dark-default';
let isThemeListenerBound = false;

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const resolveThemeName = (mode: 'dark' | 'light'): TShikiTheme => (
  mode === 'light' ? 'github-light-default' : 'github-dark-default'
);

const resolveShikiLanguage = (
  lang: TAiSupportedLang,
): TRenderableShikiLang => (
  lang === 'patch' ? 'diff' : lang
);

const syncShikiTheme = async (themeName: TShikiTheme): Promise<void> => {
  if (themeName === currentThemeName) {
    return;
  }

  currentThemeName = themeName;
  shikiThemeVersion.value += 1;

  if (!highlighterPromise) {
    return;
  }

  const highlighter = await highlighterPromise;
  await highlighter.loadTheme(themeName);
  highlighter.setTheme(themeName);
};

const ensureThemeListener = (): void => {
  if (isThemeListenerBound) {
    return;
  }

  isThemeListenerBound = true;
  onThemeChanged(({ mode }) => {
    void syncShikiTheme(resolveThemeName(mode));
  });
};

const getHighlighter = (): Promise<THighlighter> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...SHIKI_THEMES],
      langs: [...SHIKI_LANGS],
    }).then((highlighter) => {
      highlighter.setTheme(currentThemeName);
      return highlighter;
    });
  }

  return highlighterPromise;
};

export const highlightAiCode = async (
  code: string,
  lang: TAiSupportedLang,
): Promise<string> => {
  if (!isAiSupportedLang(lang)) {
    return `<pre class="shiki ai-code-plain"><code>${escapeHtml(code)}</code></pre>`;
  }

  try {
    const highlighter = await getHighlighter();
    const shikiLang = resolveShikiLanguage(lang);
    await highlighter.loadLanguage(
      shikiLang as Parameters<THighlighter['loadLanguage']>[0],
    ).catch(() => undefined);
    return highlighter.codeToHtml(code, {
      lang: shikiLang,
      theme: currentThemeName,
    });
  } catch {
    return `<pre class="shiki ai-code-plain"><code>${escapeHtml(code)}</code></pre>`;
  }
};

export const useShikiHighlighter = () => {
  ensureThemeListener();

  return {
    highlightAiCode,
    themeVersion: readonly(shikiThemeVersion),
  };
};
