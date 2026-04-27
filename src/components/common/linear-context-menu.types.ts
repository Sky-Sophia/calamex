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
  | 'open-external';

export interface ILinearContextMenuItem {
  key: string;
  label: string;
  icon: TLinearContextMenuIcon;
  shortcut?: string[];
  disabled?: boolean;
  children?: ILinearContextMenuItem[];
}

export interface ILinearContextMenuGroup<TItem extends ILinearContextMenuItem = ILinearContextMenuItem> {
  key: string;
  title: string;
  items: TItem[];
}
