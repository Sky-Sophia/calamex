import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiToolActivityInline from '@/components/business/ai/AiToolActivityInline.vue';

import type { IAiToolCall } from '@/types/ai';

const mountActivity = (toolCalls: IAiToolCall[]) =>
  mount(AiToolActivityInline, {
    props: {
      toolCalls,
    },
  });

describe('AiToolActivityInline', () => {
  it('把运行态工具调用渲染成对话流里的紧凑时间线行', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-read',
        name: 'read_file',
        status: 'running',
        summary: '正在读取 test.sh…',
      },
    ]);

    expect(wrapper.get('.ai-tool-activity-inline').attributes('aria-label')).toBe('工具调用时间线');
    expect(wrapper.text()).toContain('读取');
    expect(wrapper.text()).toContain('test.sh');
    expect(wrapper.text()).not.toContain('正在读取 test.sh…');
    expect(wrapper.find('.ai-tool-running-dots').exists()).toBe(false);
  });

  it('优先显示 targetPreview，并把文件行号拆成独立范围标签', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-search',
        name: 'search_text',
        status: 'succeeded',
        summary: '已搜索项目内容',
        targetPreview: 'src/components/business/ai/AiAssistantPanel.vue:120-156',
      },
    ]);

    expect(wrapper.text()).toContain('搜索');
    expect(wrapper.text()).toContain('src/components/business/ai/AiAssistantPanel.vue');
    expect(wrapper.text()).toContain('L120-156');
  });

  it('工具失败时保留目标并通过状态类暴露失败状态', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-test',
        name: 'run_test',
        status: 'failed',
        summary: 'pnpm exec vitest run AiToolActivityInline.spec.ts',
      },
    ]);

    expect(wrapper.get('.ai-tool-activity-item').classes()).toContain('is-failed');
    expect(wrapper.text()).toContain('验证');
    expect(wrapper.text()).toContain('pnpm exec vitest run AiToolActivityInline.spec.ts');
  });
});
