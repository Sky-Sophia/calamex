import {
  ACCENT_COLORS,
  RADIUS_PRESETS,
  THEME_PREFERENCES,
  UI_DENSITIES,
  type TAccentColor,
  type TRadiusPreset,
  type TThemeMode,
  type TThemePreference,
  type TUiDensity,
} from '@/types/app';
import {
  createDefaultAppSettings,
  type IAppSettings,
  type TAppSettingsSectionKey,
} from '@/types/settings';
import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';

import { APP_STORE_KEY } from './index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THEME: TThemeMode = 'dark';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** [min, max] 闭区间。clampNumber 会先 Math.round,再夹紧到该区间。 */
type TNumberRange = readonly [min: number, max: number];

const RANGE_INTERFACE_FONT_SIZE = [12, 16] as const satisfies TNumberRange;
const RANGE_RECENT_FILE_LIMIT = [5, 100] as const satisfies TNumberRange;
const RANGE_EDITOR_FONT_SIZE = [11, 20] as const satisfies TNumberRange;
const RANGE_EDITOR_TAB_SIZE = [2, 8] as const satisfies TNumberRange;
const RANGE_SUGGESTION_DELAY_MS = [0, 2000] as const satisfies TNumberRange;
const RANGE_TERMINAL_FONT_SIZE = [11, 20] as const satisfies TNumberRange;
const RANGE_TERMINAL_SCROLLBACK = [1000, 20000] as const satisfies TNumberRange;
const RANGE_RUN_STOP_TIMEOUT_S = [1, 30] as const satisfies TNumberRange;
const RANGE_PRESERVED_TERMINAL_COUNT = [1, 20] as const satisfies TNumberRange;
const RANGE_SHFMT_INDENT_SIZE = [2, 8] as const satisfies TNumberRange;
const RANGE_RULER_COLUMN = [60, 240] as const satisfies TNumberRange;
const RANGE_SSH_CONNECT_TIMEOUT_S = [3, 60] as const satisfies TNumberRange;
const RANGE_AI_PANEL_WIDTH = [350, 550] as const satisfies TNumberRange;
const DEFAULT_AI_PANEL_WIDTH = 450;
const RANGE_TERMINAL_PANEL_HEIGHT = [140, 2000] as const satisfies TNumberRange;
const DEFAULT_TERMINAL_PANEL_HEIGHT = 236;

const MAX_COMPLETION_TRIGGERS = 12;
const MAX_IGNORED_RULES = 16;
const MAX_ENVIRONMENT_VARIABLES = 20;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const hasWindow = (): boolean => typeof window !== 'undefined';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

/** 由有限字符串元组生成 type guard,所有 isKnown* 共用。 */
const createTupleGuard =
  <T extends string>(allowed: readonly T[]) =>
    (value: unknown): value is T =>
      typeof value === 'string' && (allowed as readonly string[]).includes(value);

const isKnownThemePreference = createTupleGuard<TThemePreference>(THEME_PREFERENCES);
const isKnownAccentColor = createTupleGuard<TAccentColor>(ACCENT_COLORS);
const isKnownUiDensity = createTupleGuard<TUiDensity>(UI_DENSITIES);
const isKnownRadiusPreset = createTupleGuard<TRadiusPreset>(RADIUS_PRESETS);

/** value 通过 guard 时返回自身,否则回退 fallback。 */
const coerceEnum = <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
  fallback: T,
): T => (guard(value) ? value : fallback);

const clampNumber = (value: number, [min, max]: TNumberRange): number =>
  Math.min(max, Math.max(min, Math.round(value)));

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

const resolveSystemTheme = (): TThemeMode => {
  if (!hasWindow() || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME;
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
};

const resolveEffectiveTheme = (
  themePreference: TThemePreference,
  systemTheme: TThemeMode,
): TThemeMode => (themePreference === 'system' ? systemTheme : themePreference);

// ---------------------------------------------------------------------------
// Settings normalization
// ---------------------------------------------------------------------------

/** persist 钩子里只关心 settings 字段,投影出局部形状以避开 pinia 通用 Store 类型缺字段的问题。 */
interface IAppStorePersistShape {
  settings: IAppSettings;
  aiPanelWidth?: number;
  terminalPanelHeight?: number;
}

/**
 * 按 defaults 的形状深度合并 value:
 * - 数组:value 必须是数组才被采纳;不再递归合并元素(由调用方做形状校验/裁剪)。
 * - 对象:仅保留 defaults 的键(白名单),递归合并子值。
 * - 数字 / 布尔 / 字符串:类型不符或非有限数则回退到 defaults。
 * - 其他:直接返回 defaults。
 */
const mergeSettingsValue = <T>(defaults: T, value: unknown): T => {
  if (Array.isArray(defaults)) {
    return (Array.isArray(value) ? value : defaults) as T;
  }
  if (isPlainObject(defaults)) {
    if (!isPlainObject(value)) {
      return defaults;
    }
    const defaultsRecord = defaults as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    Object.keys(defaultsRecord).forEach((key) => {
      merged[key] = mergeSettingsValue(defaultsRecord[key], value[key]);
    });
    return merged as T;
  }
  if (typeof defaults === 'number') {
    return (typeof value === 'number' && Number.isFinite(value) ? value : defaults) as T;
  }
  if (typeof defaults === 'boolean') {
    return (typeof value === 'boolean' ? value : defaults) as T;
  }
  if (typeof defaults === 'string') {
    return (typeof value === 'string' ? value : defaults) as T;
  }
  return defaults;
};

const normalizeAppearance = (
  appearance: IAppSettings['appearance'],
  defaults: IAppSettings['appearance'],
): IAppSettings['appearance'] => ({
  ...appearance,
  themePreference: coerceEnum(
    appearance.themePreference,
    isKnownThemePreference,
    defaults.themePreference,
  ),
  accentColor: coerceEnum(appearance.accentColor, isKnownAccentColor, defaults.accentColor),
  uiDensity: coerceEnum(appearance.uiDensity, isKnownUiDensity, defaults.uiDensity),
  radiusPreset: coerceEnum(appearance.radiusPreset, isKnownRadiusPreset, defaults.radiusPreset),
  interfaceFontSize: clampNumber(appearance.interfaceFontSize, RANGE_INTERFACE_FONT_SIZE),
});

const normalizeSettings = (value: unknown): IAppSettings => {
  const defaults = createDefaultAppSettings();
  const merged = mergeSettingsValue(defaults, value);

  merged.appearance = normalizeAppearance(merged.appearance, defaults.appearance);

  merged.general.recentFileLimit = clampNumber(
    merged.general.recentFileLimit,
    RANGE_RECENT_FILE_LIMIT,
  );

  merged.editor.fontSize = clampNumber(merged.editor.fontSize, RANGE_EDITOR_FONT_SIZE);
  merged.editor.tabSize = clampNumber(merged.editor.tabSize, RANGE_EDITOR_TAB_SIZE);
  merged.editor.suggestionDelay = clampNumber(
    merged.editor.suggestionDelay,
    RANGE_SUGGESTION_DELAY_MS,
  );

  merged.terminal.fontSize = clampNumber(merged.terminal.fontSize, RANGE_TERMINAL_FONT_SIZE);
  merged.terminal.scrollback = clampNumber(merged.terminal.scrollback, RANGE_TERMINAL_SCROLLBACK);

  merged.run.stopTimeoutSeconds = clampNumber(
    merged.run.stopTimeoutSeconds,
    RANGE_RUN_STOP_TIMEOUT_S,
  );
  merged.run.preservedTerminalCount = clampNumber(
    merged.run.preservedTerminalCount,
    RANGE_PRESERVED_TERMINAL_COUNT,
  );

  merged.style.shfmtIndentSize = clampNumber(
    merged.style.shfmtIndentSize,
    RANGE_SHFMT_INDENT_SIZE,
  );
  merged.style.rulerColumn = clampNumber(merged.style.rulerColumn, RANGE_RULER_COLUMN);

  merged.integrations.sshConnectTimeoutSeconds = clampNumber(
    merged.integrations.sshConnectTimeoutSeconds,
    RANGE_SSH_CONNECT_TIMEOUT_S,
  );

  merged.editor.completionTriggers = merged.editor.completionTriggers
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPLETION_TRIGGERS);

  merged.style.ignoredRules = merged.style.ignoredRules
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_IGNORED_RULES);

  merged.run.environmentVariables = merged.run.environmentVariables
    .filter((item) => Boolean(item.id))
    .slice(0, MAX_ENVIRONMENT_VARIABLES);

  return merged;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAppStore = defineStore(
  'app',
  () => {
    // 初始值:由 pinia-plugin-persistedstate 在 hydrate 阶段从 localStorage 恢复;
    // 此处使用默认值,afterHydrate 钩子会完成 normalize。
    const settings = ref<IAppSettings>(createDefaultAppSettings());
    const aiPanelWidth = ref(DEFAULT_AI_PANEL_WIDTH);
    const terminalPanelHeight = ref(DEFAULT_TERMINAL_PANEL_HEIGHT);
    const systemTheme = ref<TThemeMode>(resolveSystemTheme());

    const themePreference = computed(() => settings.value.appearance.themePreference);
    const theme = computed<TThemeMode>(() =>
      resolveEffectiveTheme(themePreference.value, systemTheme.value),
    );
    const isDark = computed(() => theme.value === 'dark');

    // ── 系统主题监听(媒体查询,非 localStorage)──────────────────────────────
    if (hasWindow() && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
      const handleChange = (event: MediaQueryListEvent): void => {
        const next: TThemeMode = event.matches ? 'dark' : 'light';
        if (next !== systemTheme.value) {
          systemTheme.value = next;
        }
      };
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        onScopeDispose(() => {
          mediaQuery.removeEventListener('change', handleChange);
        });
      }
    }

    const applyTheme = (value: TThemePreference): void => {
      if (!isKnownThemePreference(value)) {
        return;
      }
      settings.value.appearance.themePreference = value;
    };

    const toggleTheme = (): void => {
      applyTheme(isDark.value ? 'light' : 'dark');
    };

    const replaceSettings = (nextSettings: IAppSettings): void => {
      settings.value = normalizeSettings(nextSettings);
    };

    const setAiPanelWidth = (value: number): void => {
      aiPanelWidth.value = clampNumber(value, RANGE_AI_PANEL_WIDTH);
    };

    const setTerminalPanelHeight = (value: number): void => {
      terminalPanelHeight.value = clampNumber(value, RANGE_TERMINAL_PANEL_HEIGHT);
    };

    // 用泛型把 section 收紧到具体字面量 key,两侧都成为 IAppSettings[K],
    // 避免 union key 索引赋值时 TS 取交集导致 ts(2322) "不能分配"。
    const resetSettingsSection = <K extends TAppSettingsSectionKey>(section: K): void => {
      settings.value[section] = createDefaultAppSettings()[section];
    };

    return {
      settings,
      aiPanelWidth,
      terminalPanelHeight,
      systemTheme,
      themePreference,
      theme,
      // 历史 API 兼容:effectiveTheme 与 theme 同源,新代码请直接用 theme。
      effectiveTheme: theme,
      isDark,
      applyTheme,
      toggleTheme,
      replaceSettings,
      setAiPanelWidth,
      setTerminalPanelHeight,
      resetSettingsSection,
    };
  },
  {
    persist: {
      key: APP_STORE_KEY,
      // 只持久化用户设置与工作台布局偏好,排除派生状态(systemTheme 来自系统,不需持久化)
      pick: ['settings', 'aiPanelWidth', 'terminalPanelHeight'],
      // hydrate 完成后 normalize 确保存储数据合法
      afterHydrate(ctx) {
        // ctx.store 是 pinia 通用 Store<...> 类型,缺少 settings 字段;
        // 必须经过 unknown 中转(否则 ts(2352) "不能充分重叠")。
        const store = ctx.store as unknown as IAppStorePersistShape;
        store.settings = normalizeSettings(store.settings);
        store.aiPanelWidth = typeof store.aiPanelWidth === 'number'
          ? clampNumber(store.aiPanelWidth, RANGE_AI_PANEL_WIDTH)
          : DEFAULT_AI_PANEL_WIDTH;
        store.terminalPanelHeight = typeof store.terminalPanelHeight === 'number'
          ? clampNumber(store.terminalPanelHeight, RANGE_TERMINAL_PANEL_HEIGHT)
          : DEFAULT_TERMINAL_PANEL_HEIGHT;
      },
    },
  },
);