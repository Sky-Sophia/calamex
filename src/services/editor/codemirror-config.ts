import type { IEditorSettings } from '@/types/settings';
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

export const resolveCodeMirrorIndentUnit = (editorSettings: IEditorSettings): string => {
  const tabSize = Math.max(1, editorSettings.tabSize);
  return editorSettings.indentation === 'tabs' ? '\t' : ' '.repeat(tabSize);
};

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
  const tabSize = Math.max(1, editorSettings.tabSize);
  const readOnly = options.readOnly ?? false;
  const editable = options.editable ?? !readOnly;
  const showLineNumbers = options.lineNumbers ?? editorSettings.lineNumbers;
  const showActiveLine = options.activeLine ?? true;
  const showFoldGutter = options.foldGutter ?? true;
  const enableAutoClosingPairs = options.autoClosingPairs ?? editorSettings.autoClosingPairs;
  const wrapLines = editorSettings.wordWrap === 'viewport';

  return [
    EditorState.tabSize.of(tabSize),
    indentUnit.of(resolveCodeMirrorIndentUnit(editorSettings)),
    wrapLines ? EditorView.lineWrapping : [],
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(editable),
    drawSelection(),
    showLineNumbers ? lineNumbers() : [],
    showActiveLine ? highlightActiveLine() : [],
    editorSettings.indentGuides ? highlightActiveLineGutter() : [],
    showFoldGutter ? foldGutter() : [],
    enableAutoClosingPairs ? closeBrackets() : [],
  ];
};