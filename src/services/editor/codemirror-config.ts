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
    // highlightActiveLineGutter 是“高亮当前行”在行号槽中的对应部分，应跟随 activeLine 设置，
    // 而非与之语义无关的 indentGuides。当前依赖未提供缩进参考线扩展，indentGuides 暂未接线。
    showActiveLine ? highlightActiveLineGutter() : [],
    showFoldGutter ? foldGutter() : [],
    enableAutoClosingPairs ? closeBrackets() : [],
  ];
};
