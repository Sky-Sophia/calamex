// @status: dormant
// 当前未注册，业务代码 MUST NOT import 本模块。详见 ADR-0006。
// 若需启用路由，MUST 先新建 ADR 替代 ADR-0006，经 Code Owner 批准后再挂载。
import ShellWorkbenchView from '@/views/ShellWorkbenchView.vue';
import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'shell-workbench',
      component: ShellWorkbenchView,
    },
  ],
});

export default router;
