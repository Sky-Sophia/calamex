import { closeBrackets } from '@codemirror/autocomplete';
import { foldGutter, indentUnit } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';

import type { IEditorSettings } from '@/types/settings';

export const resolveCodeMirrorIndentUnit = (editorSettings: IEditorSettings): string =>
  editorSettings.indentation === 'tabs' ? '\t' : ' '.repeat(Math.max(1, editorSettings.tabSize));

export interface ICodeMirrorSettingsOptions {
  activeLine?: boolean;
  autoClosingPairs?: boolean;
  editable?: boolean;
  foldGutter?: boolean;
  lineNumbers?: boolean;
  readOnly?: boolean;
}

export const buildCodeMirrorSettingsExtensions = (
  editorSettings: IEditorSettings,
  options: ICodeMirrorSettingsOptions = {},
): Extension[] => {
  const readOnly = options.readOnly ?? false;
  const editable = options.editable ?? !readOnly;
  const showLineNumbers = options.lineNumbers ?? editorSettings.lineNumbers;

  return [
    EditorState.tabSize.of(Math.max(1, editorSettings.tabSize)),
    indentUnit.of(resolveCodeMirrorIndentUnit(editorSettings)),
    editorSettings.wordWrap === 'viewport' ? EditorView.lineWrapping : [],
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(editable),
    drawSelection(),
    showLineNumbers ? lineNumbers() : [],
    options.activeLine ?? true ? highlightActiveLine() : [],
    editorSettings.indentGuides ? highlightActiveLineGutter() : [],
    options.foldGutter ?? true ? foldGutter() : [],
    options.autoClosingPairs ?? editorSettings.autoClosingPairs ? closeBrackets() : [],
  ];
};
