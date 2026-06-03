/**
 * AI 助手三模式的单一事实源。
 * chat / agent / plan 的联合类型与运行时守卫只在这里定义,
 * 其余各层(UI / store / token context / assistant 编排)一律从此导入,
 * 避免同一词表被手抄多份产生漂移。
 */
export const AI_ASSISTANT_MODES = ['chat', 'agent', 'plan'] as const;

export type TAiAssistantMode = (typeof AI_ASSISTANT_MODES)[number];

export const isAiAssistantMode = (value: unknown): value is TAiAssistantMode =>
  typeof value === 'string' && (AI_ASSISTANT_MODES as readonly string[]).includes(value);
