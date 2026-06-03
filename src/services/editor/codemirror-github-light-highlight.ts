import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export interface ICodeMirrorStaticTokenStyle {
  color?: string;
  backgroundColor?: string;
  fontStyle?: 'italic';
  fontWeight?: '600' | '700';
  textDecoration?: 'underline' | 'line-through';
}

export const CODEMIRROR_GITHUB_LIGHT_FOREGROUND = '#24292f';
export const CODEMIRROR_GITHUB_LIGHT_BACKGROUND = '#ffffff';

const tokenStyles = {
  'cmh-atom': { color: '#0550ae' },
  'cmh-bool': { color: '#0550ae' },
  'cmh-class-name': { color: '#953800' },
  'cmh-comment': { color: '#57606a' },
  'cmh-deleted': { color: '#cf222e' },
  'cmh-emphasis': { fontStyle: 'italic' },
  'cmh-heading': { color: '#0550ae', fontWeight: '600' },
  'cmh-inserted': { color: '#116329' },
  'cmh-invalid': { backgroundColor: '#cf222e', color: '#ffffff' },
  'cmh-keyword': { color: '#cf222e' },
  'cmh-link': { color: '#0969da', textDecoration: 'underline' },
  'cmh-literal': { color: '#0550ae' },
  'cmh-meta': { color: '#6e7781' },
  'cmh-name': { color: '#24292f' },
  'cmh-number': { color: '#0550ae' },
  'cmh-operator': { color: '#cf222e' },
  'cmh-property-name': { color: '#0550ae' },
  'cmh-punctuation': { color: '#24292f' },
  'cmh-regexp': { color: '#0a3069' },
  'cmh-string': { color: '#0a3069' },
  'cmh-strong': { fontWeight: '700' },
  'cmh-tag-name': { color: '#116329' },
  'cmh-type-name': { color: '#953800' },
  'cmh-variable-name': { color: '#953800' },
} as const satisfies Readonly<Record<string, ICodeMirrorStaticTokenStyle>>;

export const codeMirrorGithubLightHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: 'cmh-comment' },
  { tag: tags.keyword, class: 'cmh-keyword' },
  { tag: tags.operatorKeyword, class: 'cmh-keyword' },
  { tag: tags.controlKeyword, class: 'cmh-keyword' },
  { tag: tags.definitionKeyword, class: 'cmh-keyword' },
  { tag: tags.moduleKeyword, class: 'cmh-keyword' },
  { tag: tags.atom, class: 'cmh-atom' },
  { tag: tags.bool, class: 'cmh-bool' },
  { tag: tags.literal, class: 'cmh-literal' },
  { tag: tags.number, class: 'cmh-number' },
  { tag: tags.string, class: 'cmh-string' },
  { tag: tags.character, class: 'cmh-string' },
  { tag: tags.attributeValue, class: 'cmh-string' },
  { tag: tags.regexp, class: 'cmh-regexp' },
  { tag: tags.escape, class: 'cmh-regexp' },
  { tag: tags.variableName, class: 'cmh-variable-name' },
  { tag: tags.definition(tags.variableName), class: 'cmh-variable-name' },
  { tag: tags.function(tags.variableName), class: 'cmh-variable-name' },
  { tag: tags.propertyName, class: 'cmh-property-name' },
  { tag: tags.definition(tags.propertyName), class: 'cmh-property-name' },
  { tag: tags.attributeName, class: 'cmh-property-name' },
  { tag: tags.typeName, class: 'cmh-type-name' },
  { tag: tags.className, class: 'cmh-class-name' },
  { tag: tags.tagName, class: 'cmh-tag-name' },
  { tag: tags.name, class: 'cmh-name' },
  { tag: tags.operator, class: 'cmh-operator' },
  { tag: tags.punctuation, class: 'cmh-punctuation' },
  { tag: tags.heading, class: 'cmh-heading' },
  { tag: tags.link, class: 'cmh-link' },
  { tag: tags.emphasis, class: 'cmh-emphasis' },
  { tag: tags.strong, class: 'cmh-strong' },
  { tag: tags.meta, class: 'cmh-meta' },
  { tag: tags.inserted, class: 'cmh-inserted' },
  { tag: tags.deleted, class: 'cmh-deleted' },
  { tag: tags.invalid, class: 'cmh-invalid' },
]);

export function resolveCodeMirrorHighlightStyle(classNames: string): ICodeMirrorStaticTokenStyle {
  const merged: ICodeMirrorStaticTokenStyle = {};

  for (const className of classNames.split(/\s+/u)) {
    const style = tokenStyles[className];
    if (!style) {
      continue;
    }

    Object.assign(merged, style);
  }

  return merged;
}
