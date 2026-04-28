import type { IAiChatMessage } from '@/types/ai';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    AI_CONVERSATION_HISTORY_LIMIT,
    useAiConversationStore,
} from './aiConversation';

const createMessage = (index: number): IAiChatMessage => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'assistant' : 'user',
    content: `第 ${index} 条对话`,
    createdAt: new Date(Date.UTC(2026, 3, 28, 10, index % 60, 0)).toISOString(),
    references: [],
});

describe('useAiConversationStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('新建对话时保留旧会话并切到新的空白会话', () => {
        const store = useAiConversationStore();

        store.replaceMessages([createMessage(1), createMessage(2)]);
        const firstThreadId = store.activeThreadId;
        const firstThreadMessages = [...store.activeMessages];

        store.startNewThread();

        expect(store.activeThreadId).not.toBe(firstThreadId);
        expect(store.activeMessages).toHaveLength(0);
        expect(store.historyThreads).toHaveLength(1);
        expect(store.historyThreads[0]?.messages).toEqual(firstThreadMessages);
    });

    it('只保留最近 20 个会话', () => {
        const store = useAiConversationStore();

        store.replaceMessages([createMessage(1)]);

        for (let index = 2; index <= 22; index += 1) {
            store.startNewThread();
            store.replaceMessages([createMessage(index)]);
        }

        expect(store.historyThreads).toHaveLength(AI_CONVERSATION_HISTORY_LIMIT);
        expect(store.historyThreads[0]?.messages[0]?.id).toBe('message-3');
        expect(store.historyThreads.at(-1)?.messages[0]?.id).toBe('message-22');
    });

    it('当前空白新会话不占用 20 个历史会话名额', () => {
        const store = useAiConversationStore();

        store.replaceMessages([createMessage(1)]);

        for (let index = 2; index <= 21; index += 1) {
            store.startNewThread();
            store.replaceMessages([createMessage(index)]);
        }

        store.startNewThread();

        expect(store.historyThreads).toHaveLength(AI_CONVERSATION_HISTORY_LIMIT);
        expect(store.activeMessages).toHaveLength(0);
        expect(store.historyThreads[0]?.messages[0]?.id).toBe('message-2');
        expect(store.historyThreads.at(-1)?.messages[0]?.id).toBe('message-21');
    });

    it('清空当前对话时只删除当前会话', () => {
        const store = useAiConversationStore();

        store.replaceMessages([createMessage(1)]);
        store.startNewThread();
        store.replaceMessages([createMessage(2)]);

        store.clearActiveThread();

        expect(store.historyThreads).toHaveLength(1);
        expect(store.historyThreads[0]?.messages[0]?.id).toBe('message-1');
        expect(store.activeMessages).toHaveLength(0);
    });
});