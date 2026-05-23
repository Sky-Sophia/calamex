import { SHIKI_THEME } from '@/constants/editor/shiki';
import {
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from 'shiki';

const SHIKI_LANGUAGE_LOOKUP: ReadonlyMap<string, BundledLanguage> = (() => {
  const map = new Map<string, BundledLanguage>();
  for (const info of bundledLanguagesInfo) {
    const id = info.id as BundledLanguage;
    map.set(info.id.toLowerCase(), id);
    for (const alias of info.aliases ?? []) {
      map.set(alias.toLowerCase(), id);
    }
  }
  return map;
})();

const BOOTSTRAP_LANGUAGES: BundledLanguage[] = ['typescript'];

const EMBEDDED_LANGUAGE_DEPENDENCIES: Readonly<Partial<Record<BundledLanguage, readonly BundledLanguage[]>>> = {
  vue: ['typescript', 'javascript', 'html', 'css', 'scss', 'sass', 'less', 'stylus', 'json'],
} as const;

let highlighter: Highlighter | null = null;
let installPromise: Promise<void> | null = null;
let installState: 'idle' | 'installing' | 'ready' | 'failed' = 'idle';
const languageLoadPromises = new Map<BundledLanguage, Promise<void>>();

export const toShikiLanguage = (language: string): BundledLanguage | null =>
  SHIKI_LANGUAGE_LOOKUP.get(language.toLowerCase()) ?? null;

const resolveShikiLanguageLoadPlan = (language: BundledLanguage): BundledLanguage[] => {
  const languages = [language, ...(EMBEDDED_LANGUAGE_DEPENDENCIES[language] ?? [])];
  return languages.filter((item, index) => languages.indexOf(item) === index);
};

async function install(): Promise<void> {
  installState = 'installing';

  let nextHighlighter: Highlighter | null = null;
  try {
    nextHighlighter = await createHighlighter({
      themes: [SHIKI_THEME],
      langs: [...BOOTSTRAP_LANGUAGES] as BundledLanguage[],
    });
    const previous = highlighter;
    highlighter = nextHighlighter;
    installState = 'ready';

    if (previous && previous !== nextHighlighter) {
      previous.dispose();
    }
  } catch (error) {
    nextHighlighter?.dispose();
    installState = 'failed';
    throw error;
  }
}

export function ensureShikiReady(): Promise<void> {
  if ((installState === 'ready' || installState === 'installing') && installPromise) {
    return installPromise;
  }

  const promise = install().catch((error) => {
    installPromise = null;
    throw error;
  });
  installPromise = promise;
  return promise;
}

export async function ensureShikiLanguageLoaded(language: string): Promise<BundledLanguage | null> {
  const shikiLanguage = toShikiLanguage(language);
  if (!shikiLanguage) {
    return null;
  }

  const cached = languageLoadPromises.get(shikiLanguage);
  if (cached) {
    await cached;
    return shikiLanguage;
  }

  const loadPromise = ensureShikiReady()
    .then(async () => {
      if (!highlighter) {
        return;
      }
      for (const languageToLoad of resolveShikiLanguageLoadPlan(shikiLanguage)) {
        if (!highlighter.getLoadedLanguages().includes(languageToLoad)) {
          await highlighter.loadLanguage(languageToLoad);
        }
      }
    })
    .catch((error) => {
      languageLoadPromises.delete(shikiLanguage);
      throw error;
    });

  languageLoadPromises.set(shikiLanguage, loadPromise);
  await loadPromise;
  return shikiLanguage;
}

export function getShikiHighlighter(): Highlighter | null {
  return highlighter;
}

export function disposeShikiHighlighter(): void {
  languageLoadPromises.clear();
  highlighter?.dispose();
  highlighter = null;
  installPromise = null;
  installState = 'idle';
}
