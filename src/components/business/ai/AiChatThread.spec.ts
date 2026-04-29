import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiChatThread from '@/components/business/ai/AiChatThread.vue';
import type { IAiChatMessage } from '@/types/ai';

const createMessage = (overrides: Partial<IAiChatMessage>): IAiChatMessage => ({
  id: 'message-1',
  role: 'assistant',
  content: '',
  createdAt: '2026-04-28T10:00:00.000Z',
  references: [],
  ...overrides,
});

describe('AiChatThread', () => {
  it('hides the standalone typing bubble when the last assistant message is already streaming', () => {
    const wrapper = mount(AiChatThread, {
      props: {
        messages: [
          createMessage({
            stream: {
              stableContent: '',
              openBlock: null,
              status: 'streaming',
            },
          }),
        ],
        isTyping: true,
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMessageItem: { template: '<div class="message-item-stub" />' },
        },
      },
    });

    expect(wrapper.find('.ai-message-typing').exists()).toBe(false);
  });

  it('keeps the standalone typing bubble for non-streaming loading states', () => {
    const wrapper = mount(AiChatThread, {
      props: {
        messages: [createMessage({ role: 'user', content: '你好', stream: undefined })],
        isTyping: true,
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMessageItem: { template: '<div class="message-item-stub" />' },
        },
      },
    });

    expect(wrapper.find('.ai-message-typing').exists()).toBe(true);
  });

  it('forwards message actions with both payload arguments intact', async () => {
    const wrapper = mount(AiChatThread, {
      props: {
        messages: [createMessage({
          actions: [{
            id: 'allow-agent-execution',
            label: '允许执行',
          }],
        })],
        isTyping: false,
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMessageItem: {
            props: ['message'],
            emits: ['messageAction'],
            template: '<button class="message-action-stub" @click="$emit(\'messageAction\', message.id, \'allow-agent-execution\')">action</button>',
          },
        },
      },
    });

    await wrapper.find('.message-action-stub').trigger('click');

    expect(wrapper.emitted('messageAction')).toEqual([
      ['message-1', 'allow-agent-execution'],
    ]);
  });
});