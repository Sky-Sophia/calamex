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

  it('renders custom code blocks with copy actions and code content', async () => {
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
    expect(wrapper.findAll('.code-action-btn')).toHaveLength(2);
    expect(wrapper.find('button[aria-label="复制代码"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="折叠代码块"]').exists()).toBe(true);
    expect(wrapper.find('.ai-code-block__copy svg').exists()).toBe(true);
    expect(wrapper.find('.ai-markdown-design-body pre').exists()).toBe(true);
    expect(wrapper.text()).toContain('const ready = true;');

    const toggleButton = wrapper.get('button[aria-label="折叠代码块"]');
    expect(toggleButton.attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.ai-code-block').classes()).not.toContain('is-collapsed');
    expect(wrapper.get('.ai-code-block__body').attributes('style') ?? '').not.toContain('display: none');

    await toggleButton.trigger('click');
    await nextTick();

    expect(wrapper.find('button[aria-label="展开代码块"]').exists()).toBe(true);
    expect(wrapper.get('.ai-code-block').classes()).toContain('is-collapsed');
    expect(wrapper.get('.ai-code-block__body').attributes('style') ?? '').toContain('display: none');

    await wrapper.get('button[aria-label="展开代码块"]').trigger('click');
    await nextTick();

    expect(wrapper.find('button[aria-label="折叠代码块"]').exists()).toBe(true);
    expect(wrapper.get('.ai-code-block').classes()).not.toContain('is-collapsed');
    expect(wrapper.get('.ai-code-block__body').attributes('style') ?? '').not.toContain('display: none');
  });

  it('renders LaTeX formulas through markstream-vue katex support', async () => {
    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-math',
        content: '行内公式 $E = mc^2$\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$',
        streamStatus: 'completed',
      },
    });

    await flushRender();

    expect(wrapper.find('.katex').exists()).toBe(true);
    expect(wrapper.find('.katex-display').exists()).toBe(true);
  });

  it('unwraps boxed KaTeX formulas inside AI messages', async () => {
    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-boxed',
        content: '$$\\boxed{\\zeta(s)=2^s\\pi^{s-1}\\sin\\left(\\frac{\\pi s}{2}\\right)\\Gamma(1-s)\\zeta(1-s)}$$',
        streamStatus: 'completed',
      },
    });

    await flushRender();

    expect(wrapper.find('.stretchy.fbox').exists()).toBe(false);
    expect(wrapper.find('.boxpad').exists()).toBe(false);
    expect(wrapper.find('.katex-display').exists()).toBe(true);
    expect(wrapper.text()).toContain('ζ');
  });
});
