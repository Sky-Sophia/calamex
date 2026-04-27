import AiMarkdown from '@/components/business/ai/AiMarkdown.vue';
import { createStreamingFenceParser } from '@/composables/useStreamingFenceParser';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const highlightAiCode = vi.fn(async () => '<pre class="shiki"><code>highlighted</code></pre>');

vi.mock('@/composables/useShikiHighlighter', () => ({
  useShikiHighlighter: () => ({ highlightAiCode }),
}));

const flushAsyncUpdates = async (): Promise<void> => {
  await nextTick();
  await Promise.resolve();
  await nextTick();
};

describe('AiMarkdown streaming fence rendering', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    highlightAiCode.mockClear();
  });

  it('renders an open fence as plaintext block without Shiki highlighting', async () => {
    const parser = createStreamingFenceParser('m-stream');
    const snapshot = parser.append('前文 **markdown**\n\n```ts\nconst pending = true;');

    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-stream',
        content: '前文 **markdown**\n\n```ts\nconst pending = true;',
        stableContent: snapshot.stableContent,
        openBlock: snapshot.openBlock,
        canApplyCode: true,
      },
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.html()).toContain('<strong>markdown</strong>');
    expect(wrapper.text()).toContain('const pending = true;');
    expect(wrapper.text()).toContain('正在生成…');
    expect(wrapper.find('pre.shiki').exists()).toBe(false);
    expect(highlightAiCode).not.toHaveBeenCalled();
  });

  it('keeps the AiCodeBlock root stable when an open fence closes', async () => {
    const parser = createStreamingFenceParser('m-stream');
    const openContent = '前文 **markdown**\n\n```ts\nconst pending = true;';
    const openSnapshot = parser.append(openContent);

    const wrapper = mount(AiMarkdown, {
      props: {
        messageId: 'm-stream',
        content: openContent,
        stableContent: openSnapshot.stableContent,
        openBlock: openSnapshot.openBlock,
        canApplyCode: true,
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await flushAsyncUpdates();

    const rootBefore = wrapper.find('.ai-code-block').element;
    const host = wrapper.find('.ai-markdown').element;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    const closedContent = `${openContent}\n\`\`\`\n后文 **done**`;
    const closedSnapshot = parser.append('\n```\n后文 **done**');

    await wrapper.setProps({
      content: closedContent,
      stableContent: closedSnapshot.stableContent,
      openBlock: closedSnapshot.openBlock,
    });
    await flushAsyncUpdates();
    observer.disconnect();

    const rootAfter = wrapper.find('.ai-code-block').element;
    const removedRootNodes = mutations
      .filter((record) => record.type === 'childList')
      .flatMap((record) => Array.from(record.removedNodes))
      .filter((node) => node === rootBefore);

    expect(rootBefore).toBe(rootAfter);
    expect(host.contains(rootAfter)).toBe(true);
    expect(removedRootNodes).toHaveLength(0);
    expect(wrapper.html()).toContain('后文 <strong>done</strong>');
    expect(highlightAiCode).toHaveBeenCalledTimes(1);
    expect(highlightAiCode).toHaveBeenCalledWith('const pending = true;\n', 'ts');
  });
});
