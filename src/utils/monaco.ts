import { buildMonacoThemeForVariant, getThemeManager, onThemeChanged } from '@/themes';
import type { TThemeMode } from '@/types/app';

import 'monaco-editor/esm/nls.messages.zh-cn.js';
import {
  conf as shellLanguageConfig,
  language as shellLanguageDefinition,
} from 'monaco-editor/esm/vs/basic-languages/shell/shell.js';
import { Range } from 'monaco-editor/esm/vs/editor/common/core/range.js';
import { Selection } from 'monaco-editor/esm/vs/editor/common/core/selection.js';
import {
  EditorOption,
  MarkerSeverity,
} from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';
// 走顶层包入口拿类型,避开 monaco-editor exports map 不开放 editor.api 子路径的问题。
import type * as MonacoApi from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess';
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';
import {
  createDiffEditor as createStandaloneDiffEditor,
  create as createStandaloneEditor,
  createModel as createStandaloneModel,
  defineTheme as defineStandaloneTheme,
  setModelMarkers as setStandaloneModelMarkers,
  setTheme as setStandaloneTheme,
} from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneEditor.js';
import { createMonacoLanguagesAPI } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneLanguages.js';
import 'monaco-editor/min/vs/editor/editor.main.css';

// ---------------------------------------------------------------------------
// Local types & constants
// ---------------------------------------------------------------------------

type TMonacoEnvironment = {
  getWorker: () => Worker;
};

type TMonacoThemeName = 'sh-dark' | 'sh-light';

const MONACO_THEME_NAME_DARK: TMonacoThemeName = 'sh-dark';
const MONACO_THEME_NAME_LIGHT: TMonacoThemeName = 'sh-light';

const SHELL_LANGUAGE_ID = 'shell';
const SHELL_FILE_EXTENSIONS = ['.sh', '.bash'];
const SHELL_LANGUAGE_ALIASES = ['Shell', 'sh'];

const READY_FLAG_KEY = '__SH_EDITOR_MONACO_READY__' as const;
const SHELL_READY_FLAG_KEY = '__SH_EDITOR_MONACO_SHELL_READY__' as const;
let suggestContributionPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Monaco facade
// ---------------------------------------------------------------------------

const languages = createMonacoLanguagesAPI();

/**
 * 拼装一个最小可用的 monaco namespace,只暴露本工程实际用到的 API。
 * cast 成 typeof MonacoApi 是为了让消费方按 monaco-editor 公共类型来用,
 * 但只有下面这些字段是真的被赋了值——访问其他字段会得到 undefined。
 */
const monaco = {
  editor: {
    create: createStandaloneEditor,
    createDiffEditor: createStandaloneDiffEditor,
    createModel: createStandaloneModel,
    defineTheme: defineStandaloneTheme,
    setModelMarkers: setStandaloneModelMarkers,
    setTheme: setStandaloneTheme,
    EditorOption,
  },
  languages,
  MarkerSeverity,
  Range,
  Selection,
} as unknown as typeof MonacoApi;

// ---------------------------------------------------------------------------
// Global scope guards
// ---------------------------------------------------------------------------

const globalScope = self as typeof self & {
  MonacoEnvironment?: TMonacoEnvironment;
  [READY_FLAG_KEY]?: boolean;
  [SHELL_READY_FLAG_KEY]?: boolean;
};

// ---------------------------------------------------------------------------
// Theme name mapping
// ---------------------------------------------------------------------------

const resolveMonacoThemeName = (theme: TThemeMode): TMonacoThemeName =>
  theme === 'light' ? MONACO_THEME_NAME_LIGHT : MONACO_THEME_NAME_DARK;

// ---------------------------------------------------------------------------
// Language registration
// ---------------------------------------------------------------------------

const registerShellLanguage = (): void => {
  if (globalScope[SHELL_READY_FLAG_KEY]) {
    return;
  }
  globalScope[SHELL_READY_FLAG_KEY] = true;

  monaco.languages.register({
    id: SHELL_LANGUAGE_ID,
    extensions: SHELL_FILE_EXTENSIONS,
    aliases: SHELL_LANGUAGE_ALIASES,
  });
  monaco.languages.setMonarchTokensProvider(SHELL_LANGUAGE_ID, shellLanguageDefinition);
  monaco.languages.setLanguageConfiguration(SHELL_LANGUAGE_ID, shellLanguageConfig);
};

// ---------------------------------------------------------------------------
// Theme registration
// ---------------------------------------------------------------------------

/**
 * 使用主题管理器中的 L2 Roles 为 Monaco 注册(或刷新)所有变体的主题定义。
 * 颜色逻辑统一由 src/themes/derive/monaco.ts 维护,此处只调用注册 API。
 */
const registerMonacoThemesFromManager = (): void => {
  const manager = getThemeManager();
  for (const variant of manager.list()) {
    const themeData = buildMonacoThemeForVariant(variant);
    monaco.editor.defineTheme(
      resolveMonacoThemeName(variant.mode),
      themeData as MonacoApi.editor.IStandaloneThemeData,
    );
  }
};

// ---------------------------------------------------------------------------
// One-shot bootstrap (module evaluation side-effects)
// ---------------------------------------------------------------------------

if (!globalScope.MonacoEnvironment) {
  globalScope.MonacoEnvironment = {
    getWorker: () => new editorWorker(),
  };
}

if (!globalScope[READY_FLAG_KEY]) {
  registerShellLanguage();
  registerMonacoThemesFromManager();
  globalScope[READY_FLAG_KEY] = true;

  onThemeChanged(() => {
    registerMonacoThemesFromManager();
    monaco.editor.setTheme(resolveMonacoThemeName(getThemeManager().getMode()));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const applyMonacoTheme = (theme: TThemeMode): void => {
  monaco.editor.setTheme(resolveMonacoThemeName(theme));
};

const ensureMonacoSuggestContribution = async (): Promise<void> => {
  if (!suggestContributionPromise) {
    suggestContributionPromise = import(
      'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js'
    )
      .then(() => undefined)
      .catch((error) => {
        suggestContributionPromise = null;
        throw error;
      });
  }

  return suggestContributionPromise;
};

export { applyMonacoTheme, ensureMonacoSuggestContribution, monaco };
