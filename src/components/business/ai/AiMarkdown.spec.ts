import AiMarkdown from '@/components/business/ai/AiMarkdown.vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

const flushRender = async (): Promise<void> => {
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

describe('AiMarkdown markstream-vue rendering', () => {
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
});
