import {
  parseOfficialAcontextState,
  type IOfficialAcontextStateItem,
  type IOfficialAcontextToolSummary,
} from './default-state.js';

export interface IOfficialAcontextEnvelopeBudget {
  maxEnvelopeChars: number;
  maxSessionSummaryChars: number;
  maxRecentFocusChars: number;
  maxToolSummaryChars: number;
  maxConstraints: number;
  maxDecisions: number;
  maxImportantFacts: number;
  maxOpenQuestions: number;
  maxToolSummaries: number;
}

export const DEFAULT_ACONTEXT_ENVELOPE_BUDGET: IOfficialAcontextEnvelopeBudget = {
  maxEnvelopeChars: 6000,
  maxSessionSummaryChars: 1200,
  maxRecentFocusChars: 600,
  maxToolSummaryChars: 600,
  maxConstraints: 10,
  maxDecisions: 10,
  maxImportantFacts: 20,
  maxOpenQuestions: 10,
  maxToolSummaries: 5,
};

export const ACONTEXT_ENVELOPE_START = '<ACONTEXT_ENVELOPE>';
export const ACONTEXT_ENVELOPE_END = '</ACONTEXT_ENVELOPE>';

const escapeRegExp = (content: string): string =>
  content.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const truncateCodePointSafe = (content: string, maxChars: number): string => {
  const normalized = content.normalize('NFC');
  const codePoints = Array.from(normalized);

  if (codePoints.length <= maxChars) {
    return normalized;
  }

  return `${codePoints.slice(0, maxChars).join('')}...`;
};

const takeRecent = <T>(items: T[], count: number): T[] =>
  count <= 0 ? [] : items.slice(-count);

const formatStateItems = (
  items: IOfficialAcontextStateItem[],
  emptyText: string,
): string => {
  if (!items.length) {
    return emptyText;
  }

  return items
    .map((item) => `- ${item.content}（source=${item.source}, confidence=${item.confidence}）`)
    .join('\n');
};

const formatToolSummaries = (
  items: IOfficialAcontextToolSummary[],
  maxChars: number,
): string => {
  if (!items.length) {
    return '无';
  }

  return items
    .map((item) => [
      `- tool=${item.tool}, status=${item.status}`,
      `  summary=${truncateCodePointSafe(item.summary, maxChars)}`,
    ].join('\n'))
    .join('\n');
};

export const buildOfficialAcontextEnvelope = (
  rawState: unknown,
  budget: IOfficialAcontextEnvelopeBudget = DEFAULT_ACONTEXT_ENVELOPE_BUDGET,
): string => {
  const state = parseOfficialAcontextState(rawState);
  const envelope = [
    'SESSION_CONTEXT',
    '当前任务目标：',
    state.currentTask.goal ?? '未记录',
    '',
    '当前阶段：',
    state.currentTask.phase,
    '',
    '当前约束：',
    formatStateItems(
      takeRecent(state.context.constraints, budget.maxConstraints),
      '无',
    ),
    '',
    '已确认事实：',
    formatStateItems(
      takeRecent(state.context.importantFacts, budget.maxImportantFacts),
      '无',
    ),
    '',
    '已做决策：',
    formatStateItems(
      takeRecent(state.context.decisions, budget.maxDecisions),
      '无',
    ),
    '',
    '未解决问题：',
    formatStateItems(
      takeRecent(state.context.openQuestions, budget.maxOpenQuestions),
      '无',
    ),
    '',
    '会话摘要：',
    truncateCodePointSafe(state.context.sessionSummary || '无', budget.maxSessionSummaryChars),
    '',
    '最近关注：',
    truncateCodePointSafe(state.context.recentFocus || '无', budget.maxRecentFocusChars),
    '',
    '工具结果摘要：',
    formatToolSummaries(
      takeRecent(state.toolContext.toolSummaries, budget.maxToolSummaries),
      budget.maxToolSummaryChars,
    ),
    '',
    '<CONTEXT_RULES>',
    '1. 当前用户请求优先级最高。',
    '2. ACONTEXT_ENVELOPE 只代表当前 session 的结构化状态，不是永久记忆。',
    '3. 如果当前用户请求与 ACONTEXT_ENVELOPE 冲突，以当前用户请求为准。',
    '4. 不要编造 state 中没有的信息。',
    '5. 工具结果摘要只代表当前 session 已发生的工具调用。',
    '6. AgentState 只是存储；只有本 Envelope 中出现的状态才是本次模型调用可见上下文。',
    '</CONTEXT_RULES>',
  ].join('\n');

  return truncateCodePointSafe(envelope, budget.maxEnvelopeChars);
};

export const wrapOfficialAcontextEnvelope = (envelopeBody: string): string =>
  [
    ACONTEXT_ENVELOPE_START,
    envelopeBody.trim(),
    ACONTEXT_ENVELOPE_END,
  ].join('\n');

export const injectOrReplaceContextEnvelope = (
  systemPrompt: string | undefined,
  envelopeBody: string,
): string => {
  const envelope = wrapOfficialAcontextEnvelope(envelopeBody);
  const basePrompt = systemPrompt ?? '';
  const pattern = new RegExp(
    `${escapeRegExp(ACONTEXT_ENVELOPE_START)}[\\s\\S]*?${escapeRegExp(ACONTEXT_ENVELOPE_END)}`,
    'gu',
  );
  const cleanedPrompt = basePrompt.replace(pattern, '').trim();

  return cleanedPrompt.length > 0
    ? `${cleanedPrompt}\n\n${envelope}`
    : envelope;
};
