import App from '@/App.vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

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

describe('App', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('渲染全局宿主与当前路由内容', async () => {
        const router = createTestRouter();
        await router.push('/home');
        await router.isReady();

        const wrapper = mount(App, {
            global: {
                plugins: [router],
            },
        });

        await flushUi();

        expect(wrapper.find('[data-testid="app-dialog-host-stub"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="browser-context-menu-host-stub"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="home-view"]').exists()).toBe(true);

        wrapper.unmount();
    });
});