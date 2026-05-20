import { SHIKI_THEME } from '@/constants/shiki';
import type { TThemeMode } from '@/types/app';

import 'monaco-editor/esm/nls.messages.zh-cn.js';
import 'monaco-editor/min/vs/editor/editor.main.css';
import * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestMemory.js';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// ---------------------------------------------------------------------------
// Local types & constants
// ---------------------------------------------------------------------------

type TMonacoEnvironment = {
  getWorker: () => Worker;
};

const READY_FLAG_KEY = '__SH_EDITOR_MONACO_READY__' as const;
let suggestContributionPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Official Monaco namespace
// ---------------------------------------------------------------------------

const monaco = MonacoApi;

// ---------------------------------------------------------------------------
// Global scope guards
// ---------------------------------------------------------------------------

const globalScope = self as typeof self & {
  MonacoEnvironment?: TMonacoEnvironment;
  [READY_FLAG_KEY]?: boolean;
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
  globalScope[READY_FLAG_KEY] = true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 根据文件路径（或文件名）推断 Monaco 语言 ID。
 * 未能识别时回退到 `'shell'`（主编辑器默认语言）。
 */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: 'shell',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  conf: 'ini',
  cpp: 'cpp',
  css: 'css',
  cts: 'typescript',
  cxx: 'cpp',
  dockerfile: 'dockerfile',
  env: 'ini',
  gemspec: 'ruby',
  go: 'go',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  ksh: 'shell',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  ps1: 'powershell',
  psd1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rake: 'ruby',
  rb: 'ruby',
  rbw: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shell',
  sql: 'sql',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
} as const;

const resolveLanguageForPath = (filePath: string | null | undefined): string => {
  if (!filePath) {
    return 'shell';
  }
  const lower = filePath.toLowerCase().split(/[?#]/)[0] ?? '';
  const fileName = lower.split('/').at(-1) ?? lower.split('\\').at(-1) ?? '';

  if (fileName === 'dockerfile' || fileName.endsWith('.dockerfile')) {
    return 'dockerfile';
  }
  if (fileName === 'makefile' || fileName === 'gnumakefile') {
    return 'make';
  }

  const ext = fileName.includes('.') ? fileName.split('.').at(-1) : undefined;
  return ext ? (LANGUAGE_BY_EXTENSION[ext] ?? 'shell') : 'shell';
};

const applyMonacoTheme = (theme: TThemeMode): void => {
  void theme;
  monaco.editor.setTheme(SHIKI_THEME);
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

export { applyMonacoTheme, ensureMonacoSuggestContribution, monaco, resolveLanguageForPath };
