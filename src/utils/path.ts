export interface INormalizeFileSystemPathOptions {
  collapseDuplicateSeparators?: boolean;
  trimTrailingSeparator?: boolean;
  foldWindowsCase?: boolean;
}

const WINDOWS_PATH_PATTERN = /^[a-zA-Z]:\//;
const UNC_PATH_PATTERN = /^\/\//;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[a-zA-Z]:\/$/;
const UNC_SHARE_ROOT_PATTERN = /^\/\/[^/]+\/[^/]+\/?$/;
const WINDOWS_VERBATIM_UNC_PREFIX = '\\\\?\\UNC\\';
const WINDOWS_VERBATIM_PREFIX = '\\\\?\\';
const NORMALIZED_WINDOWS_VERBATIM_UNC_PREFIX = '//?/UNC/';
const NORMALIZED_WINDOWS_VERBATIM_PREFIX = '//?/';

const stripWindowsVerbatimPrefix = (value: string): string => {
  const lowerValue = value.toLowerCase();

  if (lowerValue.startsWith(WINDOWS_VERBATIM_UNC_PREFIX.toLowerCase())) {
    return `\\\\${value.slice(WINDOWS_VERBATIM_UNC_PREFIX.length)}`;
  }

  if (lowerValue.startsWith(WINDOWS_VERBATIM_PREFIX.toLowerCase())) {
    return value.slice(WINDOWS_VERBATIM_PREFIX.length);
  }

  if (lowerValue.startsWith(NORMALIZED_WINDOWS_VERBATIM_UNC_PREFIX.toLowerCase())) {
    return `//${value.slice(NORMALIZED_WINDOWS_VERBATIM_UNC_PREFIX.length)}`;
  }

  if (lowerValue.startsWith(NORMALIZED_WINDOWS_VERBATIM_PREFIX.toLowerCase())) {
    return value.slice(NORMALIZED_WINDOWS_VERBATIM_PREFIX.length);
  }

  return value;
};

const collapseDuplicateSeparators = (value: string): string => {
  if (value.startsWith('//')) {
    return `//${value.slice(2).replace(/\/+/g, '/')}`;
  }

  return value.replace(/\/+/g, '/');
};

const isWindowsStylePath = (value: string): boolean =>
  WINDOWS_PATH_PATTERN.test(value) || UNC_PATH_PATTERN.test(value);

const trimTrailingSeparator = (value: string): string => {
  if (!value || value === '/' || WINDOWS_DRIVE_ROOT_PATTERN.test(value) || UNC_SHARE_ROOT_PATTERN.test(value)) {
    return value;
  }

  return value.replace(/\/+$/g, '');
};

export const normalizeFileSystemPath = (
  value: string | null | undefined,
  options: INormalizeFileSystemPathOptions = {},
): string => {
  if (!value) {
    return '';
  }

  let normalized = stripWindowsVerbatimPrefix(value).replace(/\\/g, '/');
  normalized = stripWindowsVerbatimPrefix(normalized);

  if (options.collapseDuplicateSeparators) {
    normalized = collapseDuplicateSeparators(normalized);
  }

  if (options.trimTrailingSeparator) {
    normalized = trimTrailingSeparator(normalized);
  }

  if (options.foldWindowsCase ?? isWindowsStylePath(normalized)) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
};

export const areFileSystemPathsEqual = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean =>
  normalizeFileSystemPath(left, {
    trimTrailingSeparator: true,
  }) ===
  normalizeFileSystemPath(right, {
    trimTrailingSeparator: true,
  });

export const getPathBaseName = (value: string | null | undefined): string => {
  const normalized = normalizeFileSystemPath(value, {
    trimTrailingSeparator: true,
  });
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? normalized;
};

export const getRelativeFileSystemPath = (
  fullPath: string | null | undefined,
  rootPath: string | null | undefined,
): string | null => {
  const normalizedFullPath = normalizeFileSystemPath(fullPath, {
    collapseDuplicateSeparators: true,
    trimTrailingSeparator: true,
  });
  const normalizedRootPath = normalizeFileSystemPath(rootPath, {
    collapseDuplicateSeparators: true,
    trimTrailingSeparator: true,
  });

  if (!normalizedFullPath || !normalizedRootPath) {
    return null;
  }

  if (normalizedFullPath === normalizedRootPath) {
    return '';
  }

  if (!normalizedFullPath.startsWith(`${normalizedRootPath}/`)) {
    return null;
  }

  return normalizedFullPath.slice(normalizedRootPath.length + 1);
};

export const getPathDirectory = (value: string | null | undefined): string => {
  const normalized = normalizeFileSystemPath(value, {
    trimTrailingSeparator: true,
  });
  if (!normalized) {
    return '';
  }

  const lastSlashIndex = normalized.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : normalized.slice(0, lastSlashIndex + 1);
};
