export type TLinearContextMenuIcon =
  | 'branch'
  | 'check'
  | 'commit'
  | 'format'
  | 'search'
  | 'refresh'
  | 'command'
  | 'comment'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'select-all'
  | 'goto'
  | 'undo'
  | 'redo'
  | 'link'
  | 'open-external'
  | 'rename'
  | 'upload'
  | 'download'
  | 'wrench'
  | 'flask'
  | 'terminal'
  | 'play'
  | 'sparkles';

export interface ILinearContextMenuItem {
  key: string;
  label: string;
  icon?: TLinearContextMenuIcon;
  inset?: boolean;
  shortcut?: string[];
  disabled?: boolean;
  variant?: 'default' | 'destructive';
  children?: ILinearContextMenuItem[];
}

export interface ILinearContextMenuGroup<TItem extends ILinearContextMenuItem = ILinearContextMenuItem> {
  key: string;
  title?: string;
  items: TItem[];
}
