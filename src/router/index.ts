// @status: active
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: 'home' },
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
    redirect: { name: 'home' },
  },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
