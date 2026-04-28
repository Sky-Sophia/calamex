import AiCodeBlock from '@/components/business/ai/AiCodeBlock.vue';
import type { IAiCodeBlock } from '@/types/ai-code';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const currentTheme = ref<'dark' | 'light'>('dark');
const themeVersion = ref(0);
const highlightAiCode = vi.fn(async (code: string) => (
    `<pre class="shiki" data-theme="${currentTheme.value}"><code><span data-theme="${currentTheme.value}">${code}</span></code></pre>`
));

vi.mock('@/composables/useShikiHighlighter', () => ({
    useShikiHighlighter: () => ({
        highlightAiCode,
        themeVersion,
    }),
}));

const flushAsyncUpdates = async (): Promise<void> => {
    await nextTick();
    await Promise.resolve();
    await nextTick();
};

const createCodeBlock = (): IAiCodeBlock => ({
    id: 'm-theme:0',
    messageId: 'm-theme',
    index: 0,
    fence: {
        rawInfo: 'ts',
        lang: 'ts',
        meta: {},
        detection: {
            source: 'fence',
            confidence: 1,
        },
    },
    content: 'const answer = 42;\n',
    closed: true,
    streamState: 'closed',
    byteLength: 18,
    truncated: false,
});

describe('AiCodeBlock theme refresh', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        currentTheme.value = 'dark';
        themeVersion.value = 0;
        highlightAiCode.mockClear();
    });

    it('rehighlights in place when the theme changes', async () => {
        const wrapper = mount(AiCodeBlock, {
            props: {
                block: createCodeBlock(),
                canApply: true,
            },
            global: {
                plugins: [createPinia()],
                stubs: {
                    AiCodeBlockHeader: true,
                    AiCodeBlockDiff: true,
                },
            },
        });

        await flushAsyncUpdates();

        const scrollRoot = wrapper.find('.ai-code-scroll').element;
        const preBefore = wrapper.find('.ai-code-scroll pre').element;
        const codeBefore = wrapper.find('.ai-code-scroll code').element;
        const mutations: MutationRecord[] = [];
        const observer = new MutationObserver((records) => {
            mutations.push(...records);
        });

        observer.observe(scrollRoot, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
        });

        currentTheme.value = 'light';
        themeVersion.value += 1;
        await flushAsyncUpdates();
        observer.disconnect();

        const preAfter = wrapper.find('.ai-code-scroll pre').element;
        const codeAfter = wrapper.find('.ai-code-scroll code').element;
        const removedNodes = mutations
            .filter((record) => record.type === 'childList')
            .flatMap((record) => Array.from(record.removedNodes));

        expect(preBefore).toBe(preAfter);
        expect(codeBefore).toBe(codeAfter);
        expect(removedNodes).not.toContain(preBefore);
        expect(removedNodes).not.toContain(codeBefore);
        expect(preAfter.getAttribute('data-theme')).toBe('light');
        expect(codeAfter.innerHTML).toContain('data-theme="light"');
        expect(highlightAiCode).toHaveBeenCalledTimes(2);
    });
});