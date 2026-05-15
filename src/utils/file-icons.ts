import pierreIconTheme from '@/assets/icons/pierre/theme-complete.json';
import { getPathBaseName } from '@/utils/path';
import type {
  IFileIconAsset,
  IFileIconResolveOptions,
  IPierreFileIconTheme,
} from '@/types/file-icon';

const PIERRE_ICON_THEME = pierreIconTheme as IPierreFileIconTheme;
const PIERRE_MONOCHROME_DARK_FILL = '#adadb1';
const PIERRE_MONOCHROME_LIGHT_FILL = '#6c6c71';
const PIERRE_COLOR_CACHE = new Map<string, IFileIconAsset>();

const FILE_ICON_ASSET_MODULES = import.meta.glob('../assets/icons/pierre/*.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>;
const FILE_ICON_RAW_MODULES = import.meta.glob('../assets/icons/pierre/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const FILE_NAME_ICON_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  'cargo.lock': 'lang-rust',
  'cargo.toml': 'lang-rust',
});
const PIERRE_PALETTE = Object.freeze({
  red: { dark: '#ff6762', light: '#d52c36' },
  vermilion: { dark: '#ff8c5b', light: '#d5512f' },
  orange: { dark: '#ffa359', light: '#d47628' },
  yellow: { dark: '#ffd452', light: '#d5a910' },
  green: { dark: '#5ecc71', light: '#199f43' },
  mint: { dark: '#61d5c0', light: '#16a994' },
  teal: { dark: '#64d1db', light: '#17a5af' },
  cyan: { dark: '#68cdf2', light: '#1ca1c7' },
  blue: { dark: '#69b1ff', light: '#1a85d4' },
  indigo: { dark: '#9d6afb', light: '#693acf' },
  purple: { dark: '#d568ea', light: '#a631be' },
  pink: { dark: '#ff678d', light: '#d32a61' },
  brown: { dark: '#c3987b', light: '#956b4f' },
});

type TPierrePaletteHue = keyof typeof PIERRE_PALETTE;

const MONOCHROME_ICON_COLOR_POOLS: Readonly<Record<string, readonly TPierrePaletteHue[]>> =
  Object.freeze({
    'bash-duo': ['green', 'mint', 'teal'],
    braces: ['yellow', 'orange', 'indigo'],
    'file-duo': ['blue', 'cyan', 'indigo', 'purple', 'teal'],
    'file-symlink-duo': ['blue', 'cyan', 'teal'],
    'file-table-duo': ['green', 'mint', 'teal', 'cyan'],
    'file-text-duo': ['green', 'mint', 'teal', 'cyan'],
    'file-zip-duo': ['yellow', 'orange', 'brown', 'vermilion'],
    'folder-duo': ['yellow', 'orange', 'brown'],
    'folder-open-duo': ['yellow', 'orange', 'brown'],
    font: ['purple', 'pink', 'indigo'],
    'image-duo': ['orange', 'pink', 'purple', 'blue'],
    'lang-markdown': ['teal', 'mint', 'cyan'],
    nextjs: ['indigo', 'purple', 'blue'],
    'server-duo': ['cyan', 'blue', 'indigo'],
    stylelint: ['mint', 'teal', 'green'],
  });

const MONOCHROME_ICON_COLOR_SEED_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  'folder-open-duo': 'folder-duo',
});

const normalizeThemeMap = (
  value: Record<string, string> | undefined,
): Record<string, string> => {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, iconKey]) => [key.toLowerCase(), iconKey]),
  );
};

const FILE_NAME_ICON_MAP: Readonly<Record<string, string>> = Object.freeze({
  ...normalizeThemeMap(PIERRE_ICON_THEME.fileNames),
  ...FILE_NAME_ICON_OVERRIDES,
});

const FILE_EXTENSION_ICON_MAP: Readonly<Record<string, string>> = Object.freeze(
  normalizeThemeMap(PIERRE_ICON_THEME.fileExtensions),
);

const hasThemeIconDefinition = (key: string): boolean =>
  Object.prototype.hasOwnProperty.call(PIERRE_ICON_THEME.iconDefinitions, key);

const getFileName = (path: string | null | undefined): string => {
  if (!path) {
    return '';
  }

  return getPathBaseName(path).toLowerCase();
};

const getExtensionCandidates = (fileName: string): string[] => {
  const segments = fileName.split('.');
  if (segments.length <= 1) {
    return [];
  }

  const candidates: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(index).join('.'));
  }

  return candidates;
};

const resolveMappedKey = (value: string | undefined): string | null => {
  if (!value || !hasThemeIconDefinition(value)) {
    return null;
  }

  return value;
};

const resolveNamedFileIconKey = (fileName: string): string | null => {
  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return 'file-text-duo';
  }

  if (fileName === 'readme' || fileName.startsWith('readme.')) {
    return 'lang-markdown';
  }

  if (
    fileName === 'license'
    || fileName.startsWith('license.')
    || fileName === 'licence'
    || fileName.startsWith('licence.')
  ) {
    return 'file-text-duo';
  }

  return resolveMappedKey(FILE_NAME_ICON_MAP[fileName]);
};

const resolveAssetModuleKey = (iconPath: string): string =>
  `../assets/icons/pierre/${iconPath.replace(/^\.\//, '')}`;

const hashText = (value: string): number => {
  let hash = 5381;

  for (const character of value) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  }

  return hash >>> 0;
};

const encodeSvgDataUri = (svg: string): string =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

const applyPierreFallbackColor = (
  svg: string,
  fillColor: string,
  monochromeFill: string,
): string => svg.replace(new RegExp(monochromeFill, 'gi'), fillColor);

const resolveColorizedFallbackIconAsset = (key: string): IFileIconAsset | null => {
  const palettePool = MONOCHROME_ICON_COLOR_POOLS[key];
  const darkDefinition = PIERRE_ICON_THEME.iconDefinitions[key];

  if (!palettePool || !darkDefinition) {
    return null;
  }

  const cacheKey = key;
  const cachedAsset = PIERRE_COLOR_CACHE.get(cacheKey);
  if (cachedAsset) {
    return cachedAsset;
  }

  const lightDefinition = PIERRE_ICON_THEME.iconDefinitions[`${key}_light`] ?? darkDefinition;
  const darkRaw =
    FILE_ICON_RAW_MODULES[resolveAssetModuleKey(darkDefinition.iconPath)] ?? null;
  const lightRaw =
    FILE_ICON_RAW_MODULES[resolveAssetModuleKey(lightDefinition.iconPath)] ?? darkRaw;

  if (!darkRaw || !lightRaw) {
    return null;
  }

  const paletteSeed = MONOCHROME_ICON_COLOR_SEED_OVERRIDES[key] ?? key;
  const paletteHue = palettePool[hashText(paletteSeed) % palettePool.length];
  const colors = PIERRE_PALETTE[paletteHue];

  const asset: IFileIconAsset = {
    darkSrc: encodeSvgDataUri(
      applyPierreFallbackColor(darkRaw, colors.dark, PIERRE_MONOCHROME_DARK_FILL),
    ),
    lightSrc: encodeSvgDataUri(
      applyPierreFallbackColor(lightRaw, colors.light, PIERRE_MONOCHROME_LIGHT_FILL),
    ),
  };

  PIERRE_COLOR_CACHE.set(cacheKey, asset);

  return asset;
};

const resolveThemeIconAssetByKey = (key: string): IFileIconAsset | null => {
  const colorizedFallbackAsset = resolveColorizedFallbackIconAsset(key);
  if (colorizedFallbackAsset) {
    return colorizedFallbackAsset;
  }

  const darkDefinition = PIERRE_ICON_THEME.iconDefinitions[key];
  if (!darkDefinition) {
    return null;
  }

  const lightDefinition =
    PIERRE_ICON_THEME.iconDefinitions[`${key}_light`] ?? darkDefinition;

  const darkSrc = FILE_ICON_ASSET_MODULES[resolveAssetModuleKey(darkDefinition.iconPath)] ?? null;
  const lightSrc =
    FILE_ICON_ASSET_MODULES[resolveAssetModuleKey(lightDefinition.iconPath)] ?? darkSrc;

  if (!darkSrc && !lightSrc) {
    return null;
  }

  const fallbackSrc = darkSrc ?? lightSrc;
  if (!fallbackSrc) {
    return null;
  }

  return {
    darkSrc: darkSrc ?? fallbackSrc,
    lightSrc: lightSrc ?? fallbackSrc,
  };
};

const resolveRequiredThemeIconAsset = (key: string): IFileIconAsset => {
  const asset = resolveThemeIconAssetByKey(key);
  if (!asset) {
    throw new Error(`Pierre Icons 资源缺失：${key}`);
  }

  return asset;
};

const DEFAULT_FILE_ICON_ASSET = resolveRequiredThemeIconAsset(PIERRE_ICON_THEME.file);

const resolveFileIconKey = ({
  kind,
  path,
  expanded = false,
}: IFileIconResolveOptions): string => {
  if (kind === 'directory') {
    return expanded ? PIERRE_ICON_THEME.folderExpanded : PIERRE_ICON_THEME.folder;
  }

  const fileName = getFileName(path);
  if (!fileName) {
    return PIERRE_ICON_THEME.file;
  }

  const namedKey = resolveNamedFileIconKey(fileName);
  if (namedKey) {
    return namedKey;
  }

  for (const candidate of getExtensionCandidates(fileName)) {
    const mappedKey = resolveMappedKey(FILE_EXTENSION_ICON_MAP[candidate]);
    if (mappedKey) {
      return mappedKey;
    }
  }

  return PIERRE_ICON_THEME.file;
};

export const resolveFileIconAsset = (options: IFileIconResolveOptions): IFileIconAsset =>
  resolveColorizedFallbackIconAsset(resolveFileIconKey(options))
  ?? resolveThemeIconAssetByKey(resolveFileIconKey(options))
  ?? DEFAULT_FILE_ICON_ASSET;
