import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AiMessageItem from '@/components/business/ai/AiMessageItem.vue';
import type { IAiChatMessage } from '@/types/ai';
import type { IAiCodeBlock } from '@/types/ai-code';

const { successMock, errorMock, warningMock, tryWriteClipboardTextMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  warningMock: vi.fn(),
  tryWriteClipboardTextMock: vi.fn(),
}));

vi.mock('@/composables/useMessage', () => ({
  useMessage: () => ({
    success: successMock,
    error: errorMock,
    warning: warningMock,
  }),
}));

vi.mock('@/utils/clipboard', () => ({
  tryWriteClipboardText: tryWriteClipboardTextMock,
}));

const createMessage = (overrides: Partial<IAiChatMessage>): IAiChatMessage => ({
  id: 'assistant-message',
  role: 'assistant',
  content: '',
  createdAt: '2026-04-28T10:00:00.000Z',
  references: [],
  ...overrides,
});

const createOpenBlock = (): IAiCodeBlock => ({
  id: 'block-1',
  messageId: 'assistant-message',
  index: 0,
  fence: {
    rawInfo: 'bash',
    lang: 'bash',
    meta: {},
    detection: {
      source: 'fence',
      confidence: 1,
    },
  },
  content: 'echo hello',
  closed: false,
  streamState: 'open',
  byteLength: 10,
  truncated: false,
});

describe('AiMessageItem', () => {
  beforeEach(() => {
    successMock.mockReset();
    errorMock.mockReset();
    warningMock.mockReset();
    tryWriteClipboardTextMock.mockReset();
    tryWriteClipboardTextMock.mockResolvedValue(true);
  });

  it('renders a single inline loader for an empty streaming assistant message', () => {
    const wrapper = mount(AiMessageItem, {
      props: {
        message: createMessage({
          stream: {
            stableContent: '',
            openBlock: null,
            status: 'streaming',
          },
        }),
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMarkdown: { template: '<div class="markdown-stub" />' },
        },
      },
    });

    expect(wrapper.find('.ai-inline-loader').exists()).toBe(true);
    expect(wrapper.find('.markdown-stub').exists()).toBe(false);
  });

  it('reuses the same bubble when streamed content arrives', async () => {
    const wrapper = mount(AiMessageItem, {
      props: {
        message: createMessage({
          stream: {
            stableContent: '',
            openBlock: null,
            status: 'streaming',
          },
        }),
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMarkdown: { template: '<div class="markdown-stub">内容已到达</div>' },
        },
      },
    });

    await wrapper.setProps({
      message: createMessage({
        content: '你好',
        stream: {
          stableContent: '你好',
          openBlock: null,
          status: 'streaming',
        },
      }),
    });

    expect(wrapper.find('.ai-inline-loader').exists()).toBe(false);
    expect(wrapper.find('.markdown-stub').exists()).toBe(true);
  });

  it('复制按钮会写入当前对话内容并提示成功', async () => {
    const wrapper = mount(AiMessageItem, {
      props: {
        message: createMessage({
          content: '请解释这段脚本',
        }),
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMarkdown: { template: '<div class="markdown-stub">请解释这段脚本</div>' },
        },
      },
    });

    await wrapper.find('.ai-message-copy-button').trigger('click');

    expect(tryWriteClipboardTextMock).toHaveBeenCalledWith('请解释这段脚本');
    expect(wrapper.find('.ai-message-copy-button').classes()).toContain('is-copied');
    expect(successMock).toHaveBeenCalledWith('已复制对话内容');
  });

  it('复制流式代码块时保留 Markdown 代码围栏', async () => {
    const wrapper = mount(AiMessageItem, {
      props: {
        message: createMessage({
          stream: {
            stableContent: '可以这样写：',
            openBlock: createOpenBlock(),
            status: 'streaming',
          },
        }),
        avatarUrl: null,
        avatarAlt: 'AI',
      },
      global: {
        stubs: {
          AiMarkdown: { template: '<div class="markdown-stub">可以这样写：</div>' },
        },
      },
    });

    await wrapper.find('.ai-message-copy-button').trigger('click');

    expect(tryWriteClipboardTextMock).toHaveBeenCalledWith(
      '可以这样写：\n\n```bash\necho hello\n```',
    );
  });
});
