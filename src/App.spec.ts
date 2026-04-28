import App from '@/App.vue';
import { WORKBENCH_READY_EVENT } from '@/utils/startup-ready';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

const { beginStartupTransitionMock, finalizeStartupTransitionMock } = vi.hoisted(() => ({
    beginStartupTransitionMock: vi.fn(async () => undefined),
    finalizeStartupTransitionMock: vi.fn(async () => undefined),
}));

vi.mock('@/services/modules/window', () => ({
    beginStartupTransition: beginStartupTransitionMock,
    finalizeStartupTransition: finalizeStartupTransitionMock,
}));

vi.mock('@/components/common/AppDialogHost.vue', () => ({
    default: {
        name: 'AppDialogHostStub',
        template: '<div data-testid="app-dialog-host-stub"></div>',
    },
}));

vi.mock('@/components/common/BrowserContextMenuHost.vue', () => ({
    default: {
        name: 'BrowserContextMenuHostStub',
        template: '<div data-testid="browser-context-menu-host-stub"></div>',
    },
}));

const HomeView = defineComponent({
    name: 'HomeViewStub',
    template: '<div data-testid="home-view">home</div>',
});

const createTestRouter = () =>
    createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/home',
                name: 'home',
                component: HomeView,
            },
        ],
    });

const flushUi = async (): Promise<void> => {
    await nextTick();
    await flushPromises();
    await nextTick();
};

describe('App startup handoff', () => {
    beforeEach(() => {
        beginStartupTransitionMock.mockClear();
        finalizeStartupTransitionMock.mockClear();

        window.__SH_WINDOW_LABEL__ = 'main';

        const svgPrototype = window.SVGSVGElement?.prototype ?? window.SVGElement.prototype;
        Object.defineProperty(svgPrototype, 'pauseAnimations', {
            configurable: true,
            value: vi.fn(),
        });
        Object.defineProperty(svgPrototype, 'setCurrentTime', {
            configurable: true,
            value: vi.fn(),
        });

        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(window, 'matchMedia').mockImplementation(
            () =>
                ({
                    matches: false,
                    media: '',
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                }) as unknown as MediaQueryList,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete window.__SH_WINDOW_LABEL__;
    });

    it('falls back to the global workbench ready event when route component does not emit ready', async () => {
        const router = createTestRouter();
        await router.push('/home');
        await router.isReady();

        const wrapper = mount(App, {
            global: {
                plugins: [router],
            },
        });

        await flushUi();

        window.dispatchEvent(new Event(WORKBENCH_READY_EVENT));
        await flushUi();

        expect(beginStartupTransitionMock).toHaveBeenCalledOnce();

        wrapper.unmount();
    });
});