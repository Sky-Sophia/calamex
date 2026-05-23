import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { vue } from '@codemirror/lang-vue';
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { c, cpp, csharp, dart, java, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { python } from '@codemirror/legacy-modes/mode/python';
import { r } from '@codemirror/legacy-modes/mode/r';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { sql } from '@codemirror/legacy-modes/mode/sql';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import type { Extension } from '@codemirror/state';

const streamLanguage = (
  parser: Parameters<typeof StreamLanguage.define>[0],
): LanguageSupport => new LanguageSupport(StreamLanguage.define(parser));

const languageDescriptions: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'Shell',
    alias: ['shellscript', 'bash', 'sh', 'zsh'],
    extensions: ['bash', 'sh', 'zsh'],
    support: streamLanguage(shell),
  }),
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx'],
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts'],
    extensions: ['ts', 'mts', 'cts'],
    support: javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: 'TSX',
    extensions: ['tsx'],
    support: javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: 'HTML',
    extensions: ['html', 'htm'],
    support: html(),
  }),
  LanguageDescription.of({
    name: 'Vue',
    extensions: ['vue'],
    support: vue(),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['scss', 'less'],
    extensions: ['css', 'scss', 'less'],
    support: css(),
  }),
  LanguageDescription.of({
    name: 'JSON',
    alias: ['jsonc'],
    extensions: ['json', 'jsonc'],
    support: json(),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md'],
    extensions: ['md', 'markdown'],
    support: markdown(),
  }),
  LanguageDescription.of({
    name: 'Dockerfile',
    alias: ['docker'],
    filename: /^Dockerfile$/u,
    support: streamLanguage(dockerFile),
  }),
  LanguageDescription.of({
    name: 'Diff',
    alias: ['patch'],
    extensions: ['diff', 'patch'],
    support: streamLanguage(diff),
  }),
  LanguageDescription.of({
    name: 'C',
    extensions: ['c', 'h'],
    support: streamLanguage(c),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp'],
    extensions: ['cpp', 'cc', 'cxx', 'hpp'],
    support: streamLanguage(cpp),
  }),
  LanguageDescription.of({
    name: 'C#',
    alias: ['csharp', 'cs'],
    extensions: ['cs'],
    support: streamLanguage(csharp),
  }),
  LanguageDescription.of({
    name: 'Dart',
    extensions: ['dart'],
    support: streamLanguage(dart),
  }),
  LanguageDescription.of({
    name: 'Go',
    extensions: ['go'],
    support: streamLanguage(go),
  }),
  LanguageDescription.of({
    name: 'Java',
    extensions: ['java'],
    support: streamLanguage(java),
  }),
  LanguageDescription.of({
    name: 'Kotlin',
    alias: ['kt'],
    extensions: ['kt', 'kts'],
    support: streamLanguage(kotlin),
  }),
  LanguageDescription.of({
    name: 'Lua',
    extensions: ['lua'],
    support: streamLanguage(lua),
  }),
  LanguageDescription.of({
    name: 'PowerShell',
    alias: ['ps', 'pwsh'],
    extensions: ['ps1'],
    support: streamLanguage(powerShell),
  }),
  LanguageDescription.of({
    name: 'Protocol Buffers',
    alias: ['proto', 'protobuf'],
    extensions: ['proto'],
    support: streamLanguage(protobuf),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py'],
    support: streamLanguage(python),
  }),
  LanguageDescription.of({
    name: 'R',
    extensions: ['r'],
    support: streamLanguage(r),
  }),
  LanguageDescription.of({
    name: 'Ruby',
    alias: ['rb'],
    extensions: ['rb'],
    support: streamLanguage(ruby),
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rs'],
    extensions: ['rs'],
    support: streamLanguage(rust),
  }),
  LanguageDescription.of({
    name: 'Scala',
    extensions: ['scala'],
    support: streamLanguage(scala),
  }),
  LanguageDescription.of({
    name: 'SQL',
    extensions: ['sql'],
    support: streamLanguage(sql({})),
  }),
  LanguageDescription.of({
    name: 'LaTeX',
    alias: ['stex', 'tex'],
    extensions: ['tex'],
    support: streamLanguage(stex),
  }),
  LanguageDescription.of({
    name: 'Swift',
    extensions: ['swift'],
    support: streamLanguage(swift),
  }),
  LanguageDescription.of({
    name: 'TOML',
    extensions: ['toml'],
    support: streamLanguage(toml),
  }),
  LanguageDescription.of({
    name: 'INI',
    alias: ['properties'],
    extensions: ['ini', 'properties'],
    support: streamLanguage(properties),
  }),
  LanguageDescription.of({
    name: 'XML',
    alias: ['svg'],
    extensions: ['xml', 'svg'],
    support: streamLanguage(xml),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    support: streamLanguage(yaml),
  }),
];

export const resolveCodeMirrorLanguageExtension = (language: string): Extension => {
  return LanguageDescription.matchLanguageName(languageDescriptions, language, true)?.support ?? [];
};

export const isCodeMirrorLanguageSupport = (
  value: Extension,
): value is LanguageSupport => value instanceof LanguageSupport;