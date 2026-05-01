import AiMarkdown from '@/components/business/ai/AiMarkdown.vue';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

const flushRender = async (): Promise<void> => {
  for (let tickIndex = 0; tickIndex < 4; tickIndex += 1) {
    await nextTick();
    await Promise.resolve();
  }
  await flushPromises();
  await nextTick();
};

describe('AiMarkdown rendering', () => {
  it('renders Markdown content through markstream-vue', async () => {
    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-markstream',
        content: '前文 **markdown**\n\n- 第一项\n- 第二项',
      },
    });

    await flushRender();

    expect(wrapper.find('.markstream-vue').exists()).toBe(true);
    expect(wrapper.text()).toContain('前文');
    expect(wrapper.text()).toContain('markdown');
    expect(wrapper.text()).toContain('第一项');
  });

  it('keeps unfinished streamed fences visible while the message is streaming', async () => {
    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-stream',
        content: '前文 **markdown**\n\n```ts\nconst pending = true;',
        streamStatus: 'streaming',
      },
    });

    await flushRender();

    expect(wrapper.text()).toContain('前文');
    expect(wrapper.text()).toContain('const pending = true');

    await wrapper.setProps({
      content: '前文 **markdown**\n\n```ts\nconst pending = true;\n```\n后文 **done**',
      streamStatus: 'completed',
    });
    await flushRender();

    expect(wrapper.text()).toContain('后文');
    expect(wrapper.text()).toContain('done');
  });

  it('uses vue-markdown-design to highlight custom code blocks', async () => {
    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-code-actions',
        content: '```ts\nconst ready = true;\n```',
        streamStatus: 'completed',
      },
    });

    await flushRender();

    expect(wrapper.find('.code-block-container').exists()).toBe(true);
    expect(wrapper.find('.code-block-header').exists()).toBe(true);
    expect(wrapper.find('.code-action-btn').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="复制"]').exists()).toBe(true);
    expect(wrapper.find('.hljs').exists()).toBe(true);
  });
});
