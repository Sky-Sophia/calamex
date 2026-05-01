import type { IAiChatMessage } from '@/types/ai';
import { aiChatMessageSchema } from '@/types/ai.schema';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { z } from 'zod';

export const AI_CONVERSATION_HISTORY_LIMIT = 20;

export interface IAiConversationThread {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messages: IAiChatMessage[];
}

const aiConversationThreadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.string().min(1),
  createdAt: z.string().min(1),
  messages: z.array(aiChatMessageSchema),
});

const aiConversationPersistSchema = z.object({
  activeThreadId: z.string().min(1).nullable(),
  threads: z.array(aiConversationThreadSchema),
});

const legacyPersistSchema = z.object({
  activeMessages: z.array(aiChatMessageSchema),
});

type IAiConversationPersistShape = z.infer<typeof aiConversationPersistSchema>;

const createThreadId = (): string => `ai-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeHydratedMessage = (message: IAiChatMessage): IAiChatMessage => {
  if (message.stream?.status !== 'streaming') return message;
  return {
    ...message,
    stream: {
      ...message.stream,
      status: 'cancelled',
    },
  };
};

const normalizeMessages = (messages: IAiChatMessage[]): IAiChatMessage[] =>
  messages.map(normalizeHydratedMessage);

const getThreadTitle = (messages: IAiChatMessage[]): string => {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  const source = firstUserMessage?.content.trim() ?? messages[0]?.content.trim() ?? '';
  if (!source) return '新对话';
  const normalized = source.replace(/\s+/g, ' ').trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
};

const createThread = (messages: IAiChatMessage[] = []): IAiConversationThread => {
  const timestamp = new Date().toISOString();
  return {
    id: createThreadId(),
    title: getThreadTitle(messages),
    updatedAt: messages.at(-1)?.createdAt ?? timestamp,
    createdAt: timestamp,
    messages,
  };
};

const syncThreadMeta = (thread: IAiConversationThread): IAiConversationThread => ({
  ...thread,
  title: getThreadTitle(thread.messages),
  updatedAt: thread.messages.at(-1)?.createdAt ?? thread.updatedAt,
});

const trimThreads = (
  threads: IAiConversationThread[],
  activeThreadId: string | null,
): IAiConversationThread[] => {
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null;
  const trimmedNonEmptyThreads = threads
    .filter((thread) => thread.messages.length > 0)
    .slice(-AI_CONVERSATION_HISTORY_LIMIT);

  if (activeThread && activeThread.messages.length === 0) {
    return [...trimmedNonEmptyThreads, activeThread];
  }

  return trimmedNonEmptyThreads;
};

const normalizeThreads = (
  threads: IAiConversationThread[],
  activeThreadId: string | null,
): IAiConversationThread[] =>
  trimThreads(
    threads.map((thread) => syncThreadMeta(thread)),
    activeThreadId,
  );

const normalizeHydratedThreads = (
  threads: IAiConversationThread[],
  activeThreadId: string | null,
): IAiConversationThread[] =>
  trimThreads(
    threads.map((thread) => syncThreadMeta({
      ...thread,
      messages: normalizeMessages(thread.messages),
    })),
    activeThreadId,
  );

const migrateLegacyMessages = (messages: IAiChatMessage[]): IAiConversationPersistShape => {
  const normalizedMessages = normalizeMessages(messages);
  if (normalizedMessages.length === 0) {
    const emptyThread = createThread();
    return {
      activeThreadId: emptyThread.id,
      threads: [emptyThread],
    };
  }

  const thread = createThread(normalizedMessages);
  return {
    activeThreadId: thread.id,
    threads: [thread],
  };
};

const ensureActiveThread = (
  activeThreadId: string | null,
  threads: IAiConversationThread[],
): IAiConversationPersistShape => {
  if (threads.length === 0) {
    const emptyThread = createThread();
    return {
      activeThreadId: emptyThread.id,
      threads: [emptyThread],
    };
  }

  const resolvedActiveThreadId = activeThreadId && threads.some((thread) => thread.id === activeThreadId)
    ? activeThreadId
    : threads.at(-1)?.id ?? null;

  return {
    activeThreadId: resolvedActiveThreadId,
    threads,
  };
};

export const useAiConversationStore = defineStore('ai-conversation', () => {
  const threads = ref<IAiConversationThread[]>([createThread()]);
  const activeThreadId = ref<string | null>(threads.value[0]?.id ?? null);

  const activeThread = computed<IAiConversationThread | null>(() =>
    threads.value.find((thread) => thread.id === activeThreadId.value) ?? null,
  );

  const activeMessages = computed<IAiChatMessage[]>(() => activeThread.value?.messages ?? []);
  const historyThreads = computed<IAiConversationThread[]>(() =>
    threads.value.filter((thread) => thread.messages.length > 0),
  );
  const hasMessages = computed(() => activeMessages.value.length > 0);

  const replaceThreadsState = (nextState: IAiConversationPersistShape): void => {
    const normalizedThreads = normalizeThreads(nextState.threads, nextState.activeThreadId);
    const resolvedState = ensureActiveThread(nextState.activeThreadId, normalizedThreads);
    threads.value = resolvedState.threads;
    activeThreadId.value = resolvedState.activeThreadId;
  };

  const patchActiveThread = (updater: (thread: IAiConversationThread) => IAiConversationThread): void => {
    const currentThread = activeThread.value;
    if (!currentThread) {
      const emptyThread = createThread();
      replaceThreadsState({
        activeThreadId: emptyThread.id,
        threads: [emptyThread],
      });
      return patchActiveThread(updater);
    }

    replaceThreadsState({
      activeThreadId: currentThread.id,
      threads: threads.value.map((thread) =>
        thread.id === currentThread.id ? syncThreadMeta(updater(thread)) : thread,
      ),
    });
  };

  const appendMessage = (message: IAiChatMessage): void => {
    patchActiveThread((thread) => ({
      ...thread,
      messages: [...thread.messages, message],
    }));
  };

  const replaceMessages = (messages: IAiChatMessage[]): void => {
    patchActiveThread((thread) => ({
      ...thread,
      messages,
    }));
  };

  const switchThread = (threadId: string): void => {
    if (!threads.value.some((thread) => thread.id === threadId)) return;
    activeThreadId.value = threadId;
  };

  const startNewThread = (): void => {
    const nextThread = createThread();
    replaceThreadsState({
      activeThreadId: nextThread.id,
      threads: [...threads.value, nextThread],
    });
  };

  const clearActiveThread = (): void => {
    const currentThread = activeThread.value;
    if (!currentThread) {
      startNewThread();
      return;
    }

    const remainingThreads = threads.value.filter((thread) => thread.id !== currentThread.id);
    const nextThread = createThread();
    replaceThreadsState({
      activeThreadId: nextThread.id,
      threads: [...remainingThreads, nextThread],
    });
  };

  return {
    activeThreadId,
    threads,
    activeThread,
    activeMessages,
    historyThreads,
    hasMessages,
    appendMessage,
    replaceMessages,
    switchThread,
    startNewThread,
    clearActiveThread,
  };
}, {
  persist: {
    key: 'shell-ide.ai-conversation',
    pick: ['activeThreadId', 'threads'],
    afterHydrate(ctx) {
      const store = ctx.store as unknown as IAiConversationPersistShape & { activeMessages?: IAiChatMessage[] };
      const parsedCurrent = aiConversationPersistSchema.safeParse({
        activeThreadId: store.activeThreadId,
        threads: store.threads,
      });
      if (parsedCurrent.success) {
        const normalized = ensureActiveThread(
          parsedCurrent.data.activeThreadId,
          normalizeHydratedThreads(parsedCurrent.data.threads, parsedCurrent.data.activeThreadId),
        );
        store.activeThreadId = normalized.activeThreadId;
        store.threads = normalized.threads;
        return;
      }

      const parsedLegacy = legacyPersistSchema.safeParse({
        activeMessages: store.activeMessages ?? [],
      });
      const migrated = parsedLegacy.success
        ? migrateLegacyMessages(parsedLegacy.data.activeMessages)
        : ensureActiveThread(null, []);
      store.activeThreadId = migrated.activeThreadId;
      store.threads = migrated.threads;
    },
  },
});
