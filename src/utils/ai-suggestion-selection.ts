export type TSuggestionShape = 'question' | 'imperative' | 'statement';

export interface IAiSuggestionSelectionItem {
  id: string;
  text: string;
  head: string;
  score: number;
  source?: 'primary' | 'fallback';
}

export interface IPickSuggestionBatchOptions {
  batchSize?: number;
  lambda?: number;
  locale?: string;
  primaryScore?: number;
  fallbackScore?: number;
  random?: () => number;
}

interface IGraphemeSegment {
  segment: string;
}

interface IGraphemeSegmenter {
  segment(value: string): Iterable<IGraphemeSegment>;
}

type TIntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locale: string,
    options: { granularity: 'grapheme' },
  ) => IGraphemeSegmenter;
};

const DEFAULT_LOCALE = 'zh-CN';
const DEFAULT_BATCH_SIZE = 9;
const DEFAULT_MMR_LAMBDA = 0.6;
const DEFAULT_PRIMARY_SCORE = 1;
const DEFAULT_FALLBACK_SCORE = 0.68;
const LEAD_SIGNATURE_GRAPHEMES = 4;
const QUESTION_WINDOW_GRAPHEMES = 8;

// 纯礼貌填充,可安全剥离;情态/疑问词不入此列。
const LEADING_FILLERS = ['麻烦', '请'];

// 句首疑问前缀。同语义族内长前缀必须排在短前缀之前。
const QUESTION_PREFIXES = [
  '可不可以', '值不值得',
  '能不能', '为什么',
  '会不会', '该不该', '要不要',
  '能否', '可以', '是否',
  '如何', '怎么', '为何',
  '哪些', '哪种', '哪类', '哪个',
  '什么', '多少',
  '几种', '几条',
];

// 句中疑问标记。wh- 完整词在前(指纹粒度更细),句末助词作兜底。
// 严禁单字 '么'(误命中 '那么'/'这么')、'哪'(误命中 '哪怕')。
const QUESTION_HINTS = [
  '为什么', '为何',
  '什么',
  '哪些', '哪种', '哪类', '哪个',
  '多少',
  '几种', '几条',
  '是否', '能否',
  '吗', '呢',
];

// 祈使前缀。必须 ≥ 2 字;1 字动词('帮'/'写'/'改')歧义太大,排除。
const IMPERATIVE_PREFIXES = [
  '列一个', '写一段', '写一篇', '讲一个', '做一个',
  '帮我', '给我',
  '推荐', '介绍', '解释', '分享', '生成', '整理',
  '列出', '设计', '安排', '分析',
  '讲讲', '说说',
  '总结', '拆解', '提供',
];

const clampRandomValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(0.999999999, Math.max(0, value));
};

export const normalizeSuggestionText = (value: string): string =>
  value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();

export const normalizeSuggestionPool = (
  suggestions: readonly string[],
  locale = DEFAULT_LOCALE,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const suggestion of suggestions) {
    const normalizedSuggestion = normalizeSuggestionText(suggestion);
    if (!normalizedSuggestion) {
      continue;
    }
    const key = normalizedSuggestion.toLocaleLowerCase(locale);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalizedSuggestion);
  }
  return result;
};

const segmenterCache = new Map<string, IGraphemeSegmenter | null>();

const getSegmenter = (locale: string): IGraphemeSegmenter | null => {
  if (segmenterCache.has(locale)) {
    return segmenterCache.get(locale) ?? null;
  }
  const segmenterConstructor =
    typeof Intl === 'undefined' ? undefined : (Intl as TIntlWithSegmenter).Segmenter;
  const segmenter = segmenterConstructor
    ? new segmenterConstructor(locale, { granularity: 'grapheme' })
    : null;
  segmenterCache.set(locale, segmenter);
  return segmenter;
};

const createGraphemeList = (value: string, locale: string): string[] => {
  const segmenter = getSegmenter(locale);
  if (segmenter) {
    return Array.from(segmenter.segment(value), (item) => item.segment);
  }
  return Array.from(value);
};

const stripLeadingFillers = (value: string): string => {
  let result = value;
  while (true) {
    const matched = LEADING_FILLERS.find(
      (filler) => result.startsWith(filler) && result.length > filler.length,
    );
    if (!matched) {
      break;
    }
    result = result.slice(matched.length).trimStart();
  }
  return result;
};

const findPrefix = (value: string, prefixes: readonly string[]): string | null => {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
};

const findHintInWindow = (
  value: string,
  hints: readonly string[],
  locale: string,
): string | null => {
  const windowText = createGraphemeList(value, locale)
    .slice(0, QUESTION_WINDOW_GRAPHEMES)
    .join('');
  for (const hint of hints) {
    if (windowText.includes(hint)) {
      return hint;
    }
  }
  return null;
};

export const resolveSuggestionShape = (
  value: string,
  locale = DEFAULT_LOCALE,
): TSuggestionShape => {
  const normalizedValue = stripLeadingFillers(
    normalizeSuggestionText(value).toLocaleLowerCase(locale),
  );
  if (!normalizedValue) {
    return 'statement';
  }
  if (/[?？]$/u.test(normalizedValue)) {
    return 'question';
  }
  if (findPrefix(normalizedValue, QUESTION_PREFIXES)) {
    return 'question';
  }
  if (findHintInWindow(normalizedValue, QUESTION_HINTS, locale)) {
    return 'question';
  }
  if (findPrefix(normalizedValue, IMPERATIVE_PREFIXES)) {
    return 'imperative';
  }
  return 'statement';
};

const resolveSuggestionLead = (
  value: string,
  shape: TSuggestionShape,
  locale: string,
): string => {
  const normalizedValue = stripLeadingFillers(
    normalizeSuggestionText(value).toLocaleLowerCase(locale),
  );
  if (!normalizedValue) {
    return '';
  }
  if (shape === 'question') {
    return (
      findPrefix(normalizedValue, QUESTION_PREFIXES)
      ?? findHintInWindow(normalizedValue, QUESTION_HINTS, locale)
      ?? createGraphemeList(normalizedValue, locale).slice(0, LEAD_SIGNATURE_GRAPHEMES).join('')
    );
  }
  if (shape === 'imperative') {
    return (
      findPrefix(normalizedValue, IMPERATIVE_PREFIXES)
      ?? createGraphemeList(normalizedValue, locale).slice(0, LEAD_SIGNATURE_GRAPHEMES).join('')
    );
  }
  return createGraphemeList(normalizedValue, locale).slice(0, LEAD_SIGNATURE_GRAPHEMES).join('');
};

export const resolveSuggestionHead = (
  value: string,
  locale = DEFAULT_LOCALE,
): string => {
  const shape = resolveSuggestionShape(value, locale);
  const lead = resolveSuggestionLead(value, shape, locale);
  return `${shape}:${lead}`;
};

export const suggestionSimilarity = (
  first: IAiSuggestionSelectionItem,
  second: IAiSuggestionSelectionItem,
): 0 | 1 => (first.head === second.head ? 1 : 0);

export const mmr = (
  pool: readonly IAiSuggestionSelectionItem[],
  count = DEFAULT_BATCH_SIZE,
  lambda = DEFAULT_MMR_LAMBDA,
): IAiSuggestionSelectionItem[] => {
  const picked: IAiSuggestionSelectionItem[] = [];
  const rest = [...pool];
  while (picked.length < count && rest.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < rest.length; index += 1) {
      const candidate = rest[index];
      if (!candidate) {
        continue;
      }
      const relevance = candidate.score;
      const diversityPenalty = picked.length > 0
        ? Math.max(...picked.map((item) => suggestionSimilarity(candidate, item)))
        : 0;
      const score = lambda * relevance - (1 - lambda) * diversityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [selected] = rest.splice(bestIndex, 1);
    if (selected) {
      picked.push(selected);
    }
  }
  return picked;
};

const shuffleItems = <T>(items: readonly T[], random: () => number): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(clampRandomValue(random()) * (index + 1));
    const current = result[index];
    const swap = result[swapIndex];
    if (current === undefined || swap === undefined) {
      continue;
    }
    result[index] = swap;
    result[swapIndex] = current;
  }
  return result;
};

/**
 * 返回带元数据(id / head / score / source)的 N 条候选。
 * 用于埋点、调试或 A/B 验证;UI 直接展示请用 pickSuggestionBatch。
 *
 * 注意:random 默认使用 Math.random,跨次调用结果不稳定。
 * 若需要"输入相同→输出相同",传入基于内容 hash 的可重放 PRNG。
 */
export const pickSuggestionBatchDetailed = (
  pool: readonly string[],
  fallback: readonly string[],
  options: IPickSuggestionBatchOptions = {},
): IAiSuggestionSelectionItem[] => {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    lambda = DEFAULT_MMR_LAMBDA,
    locale = DEFAULT_LOCALE,
    primaryScore = DEFAULT_PRIMARY_SCORE,
    fallbackScore = DEFAULT_FALLBACK_SCORE,
    random = Math.random,
  } = options;

  const normalizedPool = normalizeSuggestionPool(pool, locale);
  const normalizedFallback = normalizeSuggestionPool(fallback, locale);

  const seenTextKeys = new Set<string>();
  const combinedItems: IAiSuggestionSelectionItem[] = [];

  const appendItems = (
    suggestions: readonly string[],
    source: 'primary' | 'fallback',
    score: number,
  ): void => {
    for (let index = 0; index < suggestions.length; index += 1) {
      const suggestion = suggestions[index];
      if (!suggestion) {
        continue;
      }
      const textKey = suggestion.toLocaleLowerCase(locale);
      if (seenTextKeys.has(textKey)) {
        continue;
      }
      seenTextKeys.add(textKey);
      combinedItems.push({
        id: `${source}:${index}:${textKey}`,
        text: suggestion,
        head: resolveSuggestionHead(suggestion, locale),
        score,
        source,
      });
    }
  };

  appendItems(shuffleItems(normalizedPool, random), 'primary', primaryScore);
  appendItems(shuffleItems(normalizedFallback, random), 'fallback', fallbackScore);

  return mmr(combinedItems, batchSize, lambda);
};

/**
 * 返回 N 条按钮文案。若需 head/source 等元数据,改用 pickSuggestionBatchDetailed。
 */
export const pickSuggestionBatch = (
  pool: readonly string[],
  fallback: readonly string[],
  options: IPickSuggestionBatchOptions = {},
): string[] =>
  pickSuggestionBatchDetailed(pool, fallback, options).map((item) => item.text);