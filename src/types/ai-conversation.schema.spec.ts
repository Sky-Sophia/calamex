import {
  aiConversationLegacyPersistSchema,
  aiConversationPersistSchema,
  aiConversationThreadSchema,
} from '@/types/ai-conversation.schema';
import { describe, expect, it } from 'vitest';

const createMessage = () => ({
  id: 'message-1',
  role: 'user',
  content: '你好',
  createdAt: '2026-05-20T10:00:00.000Z',
  references: [],
});

describe('AI conversation schema', () => {
  it('校验会话线程和持久化状态', () => {
    const thread = aiConversationThreadSchema.parse({
      id: 'thread-1',
      title: '新对话',
      titleStatus: 'generated',
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
      messages: [createMessage()],
      scrollState: {
        scrollTop: 0,
        scrollHeight: 120,
        clientHeight: 80,
        distanceFromBottom: 40,
        updatedAt: '2026-05-20T10:00:00.000Z',
      },
    });

    const persisted = aiConversationPersistSchema.parse({
      activeThreadId: thread.id,
      threads: [thread],
    });

    expect(persisted.threads[0]?.messages[0]?.content).toBe('你好');
  });

  it('兼容旧版 activeMessages 持久化形状', () => {
    const legacy = aiConversationLegacyPersistSchema.parse({
      activeMessages: [createMessage()],
    });

    expect(legacy.activeMessages).toHaveLength(1);
    expect(() => aiConversationPersistSchema.parse({ activeThreadId: '', threads: [] })).toThrow();
  });
});
