import { beforeEach, describe, expect, it, vi } from 'vitest';

const createHighlighter = vi.fn();
const themeListeners = new Set<(detail: { mode: 'dark' | 'light' }) => void>();

let currentMode: 'dark' | 'light' = 'dark';

const mockHighlighter = {
    loadTheme: vi.fn(async () => undefined),
    setTheme: vi.fn(() => undefined),
    loadLanguage: vi.fn(async () => undefined),
    codeToHtml: vi.fn((code: string, options: { theme: string; lang: string }) => (
        `<pre class="shiki" data-theme="${options.theme}" data-lang="${options.lang}"><code>${code}</code></pre>`
    )),
};

vi.mock('shiki', () => ({
    createHighlighter,
}));

vi.mock('@/themes', () => ({
    getThemeManager: () => ({
        getMode: () => currentMode,
    }),
    onThemeChanged: (handler: (detail: { mode: 'dark' | 'light' }) => void) => {
        themeListeners.add(handler);
        return () => themeListeners.delete(handler);
    },
}));

const flushAsyncUpdates = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe('useShikiHighlighter', () => {
    beforeEach(() => {
        vi.resetModules();
        currentMode = 'dark';
        themeListeners.clear();
        createHighlighter.mockReset();
        createHighlighter.mockResolvedValue(mockHighlighter);
        mockHighlighter.loadTheme.mockClear();
        mockHighlighter.setTheme.mockClear();
        mockHighlighter.loadLanguage.mockClear();
        mockHighlighter.codeToHtml.mockClear();
    });

    it('creates one singleton highlighter and uses the current theme for rendering', async () => {
        const { useShikiHighlighter } = await import('@/composables/useShikiHighlighter');
        const { highlightAiCode } = useShikiHighlighter();

        await highlightAiCode('const first = 1;', 'ts');
        await highlightAiCode('const second = 2;', 'ts');

        expect(createHighlighter).toHaveBeenCalledTimes(1);
        expect(createHighlighter).toHaveBeenCalledWith(expect.objectContaining({
            themes: ['github-dark-default', 'github-light-default'],
            langs: expect.arrayContaining(['plaintext', 'ts', 'js']),
        }));
        expect(mockHighlighter.setTheme).toHaveBeenCalledWith('github-dark-default');
        expect(mockHighlighter.codeToHtml).toHaveBeenNthCalledWith(1, 'const first = 1;', expect.objectContaining({
            lang: 'ts',
            theme: 'github-dark-default',
        }));
        expect(mockHighlighter.codeToHtml).toHaveBeenNthCalledWith(2, 'const second = 2;', expect.objectContaining({
            lang: 'ts',
            theme: 'github-dark-default',
        }));
    });

    it('updates the active Shiki theme after theme-changed and exposes a revision signal', async () => {
        const { useShikiHighlighter } = await import('@/composables/useShikiHighlighter');
        const { highlightAiCode, themeVersion } = useShikiHighlighter();

        await highlightAiCode('const themed = true;', 'ts');

        currentMode = 'light';
        for (const handler of themeListeners) {
            handler({ mode: 'light' });
        }
        await flushAsyncUpdates();

        expect(themeVersion.value).toBe(1);
        expect(mockHighlighter.loadTheme).toHaveBeenCalledWith('github-light-default');
        expect(mockHighlighter.setTheme).toHaveBeenLastCalledWith('github-light-default');

        await highlightAiCode('const themed = false;', 'ts');

        expect(mockHighlighter.codeToHtml).toHaveBeenLastCalledWith('const themed = false;', expect.objectContaining({
            lang: 'ts',
            theme: 'github-light-default',
        }));
    });
});