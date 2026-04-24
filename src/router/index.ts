// @status: active
// 2026-04-24: welcome now runs in a dedicated window; routes are scoped by window label.
import { getThemeManager } from '@/themes';
import {
  WELCOME_WINDOW_LABEL,
  getBootstrapRouteName,
  getCurrentAppWindowLabel,
} from '@/utils/app-window';
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: () => ({ name: getBootstrapRouteName() }),
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/views/Welcome.vue'),
    meta: {
      theme: 'dark',
      layout: 'bare',
    },
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/ShellWorkbenchView.vue'),
    meta: {
      layout: 'workbench',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: () => ({ name: getBootstrapRouteName() }),
  },
];

const applyDocumentTheme = (mode: 'dark' | 'light'): void => {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
};

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  const currentWindowLabel = getCurrentAppWindowLabel();

  if (currentWindowLabel === WELCOME_WINDOW_LABEL) {
    if (to.name !== 'welcome') {
      return { name: 'welcome' };
    }

    applyDocumentTheme('dark');
    return true;
  }

  if (to.name === 'welcome') {
    return { name: 'home' };
  }

  const theme = to.meta.theme as 'dark' | 'light' | undefined;
  if (theme) {
    applyDocumentTheme(theme);
    return true;
  }

  applyDocumentTheme(getThemeManager().getMode());
  return true;
});

router.afterEach((to) => {
  if (to.name === 'welcome') {
    return;
  }

  applyDocumentTheme(getThemeManager().getMode());
});

export default router;
