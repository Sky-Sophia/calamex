export type TFileIconEntryKind = 'file' | 'directory';

export interface IFileIconAsset {
  darkSrc: string;
  lightSrc: string;
}

export interface IPierreFileIconDefinition {
  iconPath: string;
}

export interface IPierreFileIconThemeLight {
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
}

export interface IPierreFileIconTheme {
  iconDefinitions: Record<string, IPierreFileIconDefinition>;
  file: string;
  folder: string;
  folderExpanded: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  light: IPierreFileIconThemeLight;
}

export interface IFileIconResolveOptions {
  kind: TFileIconEntryKind;
  path?: string | null;
  expanded?: boolean;
}
