<template>
  <section class="search-sidebar" aria-label="搜索">
    <header class="search-panel-header">
      <span class="search-panel-title">搜索</span>

      <button
        type="button"
        class="search-panel-icon-btn"
        aria-label="切换到替换"
        title="切换到替换"
        @click="handleReplaceAction"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 7h11" />
          <path d="M3 17h8" />
          <path d="m16 14 4 3-4 3" />
          <path d="m20 4-4 3 4 3" />
        </svg>
      </button>
    </header>

    <div class="search-panel-search">
      <label class="search-panel-input-shell">
        <span class="search-panel-input-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>

        <input
          v-model="searchQuery"
          type="text"
          placeholder="输入关键字搜索…"
          autocomplete="off"
          spellcheck="false"
        />

        <button
          v-if="hasSearchQuery"
          type="button"
          class="search-panel-clear-btn"
          aria-label="清空搜索"
          title="清空搜索"
          @click.stop="searchQuery = ''"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      </label>
    </div>

    <div class="search-panel-chip-row">
      <button
        v-for="chip in scopeChips"
        :key="chip.key"
        type="button"
        class="search-panel-chip"
        :class="{ 'is-active': activeScope === chip.key }"
        :aria-pressed="activeScope === chip.key"
        @click="activeScope = chip.key"
      >
        <span>{{ chip.label }}</span>
        <span class="search-panel-chip-count">{{ chip.count }}</span>
      </button>
    </div>

    <div class="search-panel-option-row" aria-label="搜索选项">
      <button
        type="button"
        class="search-panel-option-btn"
        :class="{ 'is-active': matchCase }"
        :aria-pressed="matchCase"
        title="区分大小写"
        @click="matchCase = !matchCase"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 18 8 6l4 12" />
          <path d="M5.5 14h5" />
          <path d="M14 12a3 3 0 1 1 5 2v2" />
        </svg>
      </button>

      <button
        type="button"
        class="search-panel-option-btn"
        :class="{ 'is-active': wholeWord }"
        :aria-pressed="wholeWord"
        title="全字匹配"
        @click="wholeWord = !wholeWord"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
          <path d="M3 10v4" />
          <path d="M21 10v4" />
          <path d="M7 14V10" />
          <path d="M11 14V10" />
          <path d="M15 14V10" />
        </svg>
      </button>

      <button
        type="button"
        class="search-panel-option-btn"
        :class="{ 'is-active': useRegex }"
        :aria-pressed="useRegex"
        title="正则表达式"
        @click="useRegex = !useRegex"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 4v10" />
          <path d="M7.3 6.5 16.7 11.5" />
          <path d="M16.7 6.5 7.3 11.5" />
          <circle cx="7" cy="19" r="1.4" />
        </svg>
      </button>

      <button
        type="button"
        class="search-panel-option-btn"
        :class="{ 'is-active': showPathFilters }"
        :aria-pressed="showPathFilters"
        title="包含 / 排除路径"
        @click="showPathFilters = !showPathFilters"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 7h10" />
          <path d="M4 12h10" />
          <path d="M4 17h6" />
          <path d="M20 14v6" />
          <path d="M17 17h6" />
        </svg>
      </button>
    </div>

    <div v-if="showPathFilters" class="search-panel-path-filter-row">
      <label class="search-panel-path-filter">
        <span>包含</span>
        <input
          v-model="includePattern"
          type="text"
          placeholder="例如 src/**/*.vue"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="search-panel-path-filter">
        <span>排除</span>
        <input
          v-model="excludePattern"
          type="text"
          placeholder="例如 target/**"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    </div>

    <div class="search-panel-results" role="listbox">
      <div
        v-if="hasSearchQuery && !searchError && !activeScopeIsPending"
        class="search-panel-summary"
      >
        <b>{{ activeResults.length }}</b> 条结果 · 来自 <b>{{ matchedFileCount }}</b> 个文件
      </div>

      <div v-if="!props.isDesktopRuntime" class="search-panel-empty-state">
        <p class="search-panel-empty-title">浏览器预览不提供本地搜索</p>
        <p class="search-panel-empty-text">请在 Tauri 桌面端打开工作区后使用搜索面板。</p>
      </div>

      <div v-else-if="!props.workspaceRootPath" class="search-panel-empty-state">
        <p class="search-panel-empty-title">尚未打开工作区</p>
        <p class="search-panel-empty-text">先打开一个目录，再在这里按文件名或路径快速定位。</p>
      </div>

      <div v-else-if="searchIndexing && indexedFileCount === 0" class="search-panel-empty-state">
        <p class="search-panel-empty-title">正在建立搜索索引</p>
        <p class="search-panel-empty-text">稍等片刻，面板会自动汇总当前工作区的文件名与路径。</p>
      </div>

      <div v-else-if="searchError" class="search-panel-empty-state">
        <p class="search-panel-empty-title">无法完成搜索</p>
        <p class="search-panel-empty-text">{{ searchError }}</p>
      </div>

      <div v-else-if="matcherError" class="search-panel-empty-state">
        <p class="search-panel-empty-title">正则表达式无效</p>
        <p class="search-panel-empty-text">{{ matcherError }}</p>
      </div>

      <div v-else-if="activeScopeIsPending" class="search-panel-empty-state">
        <p class="search-panel-empty-title">该类别待接入</p>
        <p class="search-panel-empty-text">当前已接入文件名与路径搜索，符号与内容结果稍后补齐。</p>
      </div>

      <div
        v-else-if="hasSearchQuery && activeResults.length === 0"
        class="search-panel-empty-state"
      >
        <p class="search-panel-empty-title">没有匹配结果</p>
        <p class="search-panel-empty-text">试试更短的关键字，或调整大小写、正则和路径过滤条件。</p>
      </div>

      <button
        v-for="result in activeResults"
        :key="result.resultKey"
        type="button"
        class="search-panel-result"
        :class="{ 'is-selected': selectedResultPath === result.path }"
        role="option"
        :aria-selected="selectedResultPath === result.path"
        @click="handleResultClick(result.path)"
      >
        <span class="search-panel-result-icon" aria-hidden="true">
          <ExplorerEntryIcon kind="file" :path="result.path" />
        </span>

        <span class="search-panel-result-body">
          <span class="search-panel-result-snippet">
            <template
              v-for="(segment, index) in result.snippetSegments"
              :key="`${result.resultKey}-snippet-${index}`"
            >
              <mark v-if="segment.matched">{{ segment.text }}</mark>
              <span v-else>{{ segment.text }}</span>
            </template>
          </span>

          <span class="search-panel-result-loc">
            <template
              v-for="(segment, index) in result.locationSegments"
              :key="`${result.resultKey}-location-${index}`"
            >
              <mark v-if="segment.matched">{{ segment.text }}</mark>
              <span v-else>{{ segment.text }}</span>
            </template>
            <span class="search-panel-result-sep">·</span>
            <span class="search-panel-result-kind">{{ result.reasonLabel }}</span>
          </span>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import ExplorerEntryIcon from '@/components/workbench/ExplorerEntryIcon.vue';
import { useMessage } from '@/composables/useMessage';
import { tauriService } from '@/services/tauri';
import type { IWorkspaceDirectoryPayload } from '@/types/editor';
import type {
  IWorkspaceSearchResult,
  TWorkspaceSearchResultKind,
  TWorkspaceSearchScope,
} from '@/types/search';
import { toErrorMessage } from '@/utils/error';
import { computed, onScopeDispose, ref, watch } from 'vue';

type TSearchReason = TWorkspaceSearchResultKind;

interface IHighlightedSegment {
  text: string;
  matched: boolean;
}

interface ISearchResultItem {
  path: string;
  resultKey: string;
  reason: TSearchReason;
  reasonLabel: string;
  snippetSegments: IHighlightedSegment[];
  locationSegments: IHighlightedSegment[];
  score: number;
  lineNumber: number | null;
}

interface ISearchMatcher {
  hasQuery: boolean;
  errorMessage: string;
  highlight: (value: string) => IHighlightedSegment[];
}

const props = defineProps<{
  documentPath: string | null;
  isDesktopRuntime: boolean;
  workspaceRootPath: string | null;
  preloadedWorkspaceRoot: IWorkspaceDirectoryPayload | null;
}>();

const emit = defineEmits<{
  'open-file': [path: string];
}>();

const SEARCH_SCOPE_LABELS: Record<TWorkspaceSearchScope, string> = {
  all: '全部',
  'file-name': '文件名',
  symbol: '符号',
  content: '内容',
};

const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_RESULT_LIMIT = 200;

const message = useMessage();
const searchQuery = ref('');
const includePattern = ref('');
const excludePattern = ref('');
const activeScope = ref<TWorkspaceSearchScope>('all');
const matchCase = ref(false);
const wholeWord = ref(false);
const useRegex = ref(false);
const showPathFilters = ref(false);
const searchIndexing = ref(false);
const searchError = ref('');
const selectedResultPath = ref<string | null>(null);
const scannedFileCount = ref(0);
const backendResults = ref<IWorkspaceSearchResult[]>([]);
let searchRequestId = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let activeAbortController: AbortController | null = null;

const isWordCharacter = (value: string | undefined): boolean =>
  Boolean(value) && /[A-Za-z0-9_\-\u4E00-\u9FFF]/u.test(value);

const splitPatternList = (value: string): string[] =>
  value
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

const collectPlainMatchRanges = (
  value: string,
  query: string,
  caseSensitive: boolean,
  fullWord: boolean,
): Array<[number, number]> => {
  const source = caseSensitive ? value : value.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const ranges: Array<[number, number]> = [];

  if (!needle) {
    return ranges;
  }

  let searchIndex = 0;
  while (searchIndex < source.length) {
    const nextMatchIndex = source.indexOf(needle, searchIndex);
    if (nextMatchIndex === -1) {
      break;
    }

    const matchEndIndex = nextMatchIndex + needle.length;
    const beforeCharacter = value[nextMatchIndex - 1];
    const afterCharacter = value[matchEndIndex];
    const passesWordBoundary =
      !fullWord || (!isWordCharacter(beforeCharacter) && !isWordCharacter(afterCharacter));

    if (passesWordBoundary) {
      ranges.push([nextMatchIndex, matchEndIndex]);
    }

    searchIndex = nextMatchIndex + Math.max(needle.length, 1);
  }

  return ranges;
};

const collectRegExpMatchRanges = (value: string, pattern: RegExp): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  pattern.lastIndex = 0;

  let nextMatch = pattern.exec(value);
  while (nextMatch) {
    const matchedValue = nextMatch[0] ?? '';
    if (!matchedValue) {
      pattern.lastIndex += 1;
      nextMatch = pattern.exec(value);
      continue;
    }

    ranges.push([nextMatch.index, nextMatch.index + matchedValue.length]);
    nextMatch = pattern.exec(value);
  }

  pattern.lastIndex = 0;
  return ranges;
};

const buildHighlightedSegments = (
  value: string,
  ranges: Array<[number, number]>,
): IHighlightedSegment[] => {
  if (ranges.length === 0) {
    return [{ text: value, matched: false }];
  }

  const segments: IHighlightedSegment[] = [];
  let previousIndex = 0;

  for (const [startIndex, endIndex] of ranges) {
    if (startIndex > previousIndex) {
      segments.push({ text: value.slice(previousIndex, startIndex), matched: false });
    }

    segments.push({ text: value.slice(startIndex, endIndex), matched: true });
    previousIndex = endIndex;
  }

  if (previousIndex < value.length) {
    segments.push({ text: value.slice(previousIndex), matched: false });
  }

  return segments.filter((segment) => segment.text.length > 0);
};

const resolveMatcher = (): ISearchMatcher => {
  const query = searchQuery.value.trim();
  if (!query) {
    return {
      hasQuery: false,
      errorMessage: '',
      highlight: (value) => [{ text: value, matched: false }],
    };
  }

  if (useRegex.value) {
    try {
      const baseFlags = matchCase.value ? 'gu' : 'giu';
      const highlightPattern = new RegExp(query, baseFlags);
      return {
        hasQuery: true,
        errorMessage: '',
        highlight: (value: string) =>
          buildHighlightedSegments(value, collectRegExpMatchRanges(value, highlightPattern)),
      };
    } catch (error) {
      return {
        hasQuery: true,
        errorMessage: toErrorMessage(error, '请输入有效的正则表达式。'),
        highlight: (value) => [{ text: value, matched: false }],
      };
    }
  }

  return {
    hasQuery: true,
    errorMessage: '',
    highlight: (value: string) =>
      buildHighlightedSegments(
        value,
        collectPlainMatchRanges(value, query, matchCase.value, wholeWord.value),
      ),
  };
};

const matcher = computed(resolveMatcher);
const matcherError = computed(() => matcher.value.errorMessage);
const hasSearchQuery = computed(() => searchQuery.value.trim().length > 0);
const indexedFileCount = computed(() => scannedFileCount.value);
const includePatterns = computed(() => splitPatternList(includePattern.value));
const excludePatterns = computed(() => splitPatternList(excludePattern.value));

const toResultItem = (result: IWorkspaceSearchResult): ISearchResultItem => {
  const lineSuffix = result.lineNumber ? `:${result.lineNumber}` : '';
  const locationText = `${result.relativePath}${lineSuffix}`;
  const reasonLabels: Record<TSearchReason, string> = {
    'file-name': '文件名匹配',
    content: '内容匹配',
    symbol: '符号匹配',
  };

  return {
    path: result.path,
    resultKey: `${result.kind}:${result.path}:${result.lineNumber ?? 0}`,
    reason: result.kind,
    reasonLabel: reasonLabels[result.kind],
    snippetSegments: matcher.value.highlight(result.lineText ?? result.name),
    locationSegments: matcher.value.highlight(locationText),
    score: result.score,
    lineNumber: result.lineNumber,
  };
};

const allResults = computed(() => backendResults.value.map(toResultItem));
const searchResultsByScope = computed<Record<TWorkspaceSearchScope, ISearchResultItem[]>>(() => {
  const nextResults: Record<TWorkspaceSearchScope, ISearchResultItem[]> = {
    all: allResults.value,
    'file-name': allResults.value.filter((result) => result.reason === 'file-name'),
    symbol: allResults.value.filter((result) => result.reason === 'symbol'),
    content: allResults.value.filter((result) => result.reason === 'content'),
  };

  return nextResults;
});

const scopeChips = computed(() =>
  (Object.keys(SEARCH_SCOPE_LABELS) as TWorkspaceSearchScope[]).map((scopeKey) => ({
    key: scopeKey,
    label: SEARCH_SCOPE_LABELS[scopeKey],
    count: searchResultsByScope.value[scopeKey].length,
  })),
);

const activeScopeIsPending = computed(() => false);
const activeResults = computed(() => searchResultsByScope.value[activeScope.value]);
const matchedFileCount = computed(
  () => new Set(activeResults.value.map((result) => result.path)).size,
);

const cancelPendingSearch = (): void => {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }

  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
};

const runSearch = async (): Promise<void> => {
  if (!props.isDesktopRuntime || !props.workspaceRootPath) {
    scannedFileCount.value = 0;
    backendResults.value = [];
    searchIndexing.value = false;
    searchError.value = '';
    return;
  }

  if (matcherError.value) {
    backendResults.value = [];
    searchIndexing.value = false;
    searchError.value = '';
    return;
  }

  const requestId = searchRequestId + 1;
  searchRequestId = requestId;
  activeAbortController?.abort();
  const abortController = new AbortController();
  activeAbortController = abortController;
  searchIndexing.value = true;
  searchError.value = '';

  try {
    const payload = await tauriService.searchWorkspace({
      workspaceRootPath: props.workspaceRootPath,
      query: searchQuery.value.trim(),
      scope: activeScope.value,
      matchCase: matchCase.value,
      wholeWord: wholeWord.value,
      useRegex: useRegex.value,
      includePatterns: showPathFilters.value ? includePatterns.value : [],
      excludePatterns: showPathFilters.value ? excludePatterns.value : [],
      limit: SEARCH_RESULT_LIMIT,
    });

    if (requestId !== searchRequestId) {
      return;
    }

    scannedFileCount.value = payload.scannedFileCount;
    backendResults.value = payload.results;
  } catch (error) {
    if (abortController.signal.aborted || requestId !== searchRequestId) {
      return;
    }

    backendResults.value = [];
    searchError.value = toErrorMessage(error, '搜索失败。');
  } finally {
    if (requestId === searchRequestId) {
      searchIndexing.value = false;
      activeAbortController = null;
    }
  }
};

const scheduleSearch = (): void => {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }

  searchTimer = setTimeout(() => {
    searchTimer = null;
    void runSearch();
  }, SEARCH_DEBOUNCE_MS);
};

const handleReplaceAction = (): void => {
  message.info('替换面板待接入');
};

const handleResultClick = (path: string): void => {
  selectedResultPath.value = path;
  emit('open-file', path);
};

watch(
  [
    () => props.isDesktopRuntime,
    () => props.workspaceRootPath,
    () => props.preloadedWorkspaceRoot,
    searchQuery,
    activeScope,
    matchCase,
    wholeWord,
    useRegex,
    showPathFilters,
    includePattern,
    excludePattern,
  ],
  scheduleSearch,
  { immediate: true },
);

watch(
  () => props.workspaceRootPath,
  () => {
    searchQuery.value = '';
    includePattern.value = '';
    excludePattern.value = '';
    activeScope.value = 'all';
    selectedResultPath.value = null;
  },
);

watch(
  [activeResults, () => props.documentPath],
  ([results, documentPath]) => {
    const availablePaths = results.map((result) => result.path);

    if (documentPath && availablePaths.includes(documentPath)) {
      selectedResultPath.value = documentPath;
      return;
    }

    if (selectedResultPath.value && availablePaths.includes(selectedResultPath.value)) {
      return;
    }

    selectedResultPath.value = availablePaths[0] ?? null;
  },
  { immediate: true },
);

onScopeDispose(cancelPendingSearch);
</script>
