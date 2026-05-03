import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiToolActivityInline from '@/components/business/ai/AiToolActivityInline.vue';

import type { IAgentActivity, TAgentActivityEvent } from '@/types/agent-activity';
import type { IActivityNote, IAiToolCall } from '@/types/ai';

const mountActivity = (
  toolCalls: IAiToolCall[],
  activityText?: string,
  activityTrail?: string[],
  activities?: IAgentActivity[],
  activityEvents?: TAgentActivityEvent[],
  activityNotes?: IActivityNote[],
) =>
  mount(AiToolActivityInline, {
    props: {
      toolCalls,
      ...(activityText ? { activityText } : {}),
      ...(activityTrail ? { activityTrail } : {}),
      ...(activities ? { activities } : {}),
      ...(activityEvents ? { activityEvents } : {}),
      ...(activityNotes ? { activityNotes } : {}),
    },
  });

describe('AiToolActivityInline', () => {
  it('把工具组渲染成带 marker 和步骤信息的线性活动流', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-read',
        name: 'read_file',
        status: 'succeeded',
        summary: '已读取 src/App.vue',
        targetPreview: 'src/App.vue:1-24',
      },
      {
        id: 'tool-call-edit',
        name: 'edit_file',
        status: 'running',
        summary: 'src/App.vue +8 -1',
        targetPreview: 'src/App.vue',
        detailItems: [
          '文件：src/App.vue',
          'additions: 8',
          'deletions: 1',
        ],
      },
    ]);

    expect(wrapper.findAll('.ai-tool-entry-marker')).toHaveLength(1);
    expect(wrapper.find('.ai-tool-group-shell').exists()).toBe(true);
    expect(wrapper.find('.ai-tool-group-pill.is-steps').text()).toBe('已完成 1/2 步');
    expect(wrapper.find('.ai-tool-group-pill.is-count').text()).toBe('2 个动作');
    expect(wrapper.find('.ai-tool-group-pill.is-diff').text()).toBe('+8 -1');
  });

  it('把运行态工具调用渲染成 assistant note + action group + compact row', async () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-read',
        name: 'read_file',
        status: 'running',
        summary: '正在读取 test.sh…',
      },
    ], '我先确认文件链路，再决定下一步修改。');

    expect(wrapper.get('.ai-tool-activity-inline').attributes('aria-label')).toBe('Agent 活动流');
    expect(wrapper.find('.ai-tool-note-text').text()).toBe('我先确认文件链路，再决定下一步修改。');
    expect(wrapper.find('.ai-tool-single-row-header').exists()).toBe(true);
    expect(wrapper.text()).toContain('读取 test.sh');
    expect(wrapper.text()).toContain('test.sh');
    expect(wrapper.text()).not.toContain('正在读取 test.sh…');

    await wrapper.get('.ai-tool-single-row-header').trigger('click');

    expect(wrapper.text()).toContain('目标：test.sh');
    expect(wrapper.text()).toContain('结果：正在读取 test.sh');
  });

  it('把命中的文件行号压成紧凑读取行', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-search',
        name: 'read_file',
        status: 'succeeded',
        summary: '已读取目标片段',
        targetPreview: 'src/components/business/ai/AiAssistantPanel.vue:120-156',
      },
    ]);

    expect(wrapper.text()).toContain('读取 AiAssistantPanel.vue，行 120 到 156');
  });

  it('把 diff 统计压到 group 标题和 edit row 上', () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-edit',
        name: 'edit_file',
        status: 'succeeded',
        summary: 'src/store/app.ts +15 -2',
        targetPreview: 'src/store/app.ts',
        detailItems: [
          '文件：src/store/app.ts',
          'additions: 15',
          'deletions: 2',
        ],
      },
    ]);

    expect(wrapper.find('.ai-tool-single-row-header').exists()).toBe(true);
    expect(wrapper.text()).toContain('已编辑 app.ts +15 -2');
  });

  it('工具从运行中变失败时会自动展开详情', async () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-test',
        name: 'run_test',
        status: 'running',
        summary: 'pnpm exec vitest run AiToolActivityInline.spec.ts',
      },
    ]);

    expect(wrapper.get('.ai-tool-group').attributes('data-state')).toBe('closed');

    await wrapper.setProps({
      toolCalls: [
        {
          id: 'tool-call-test',
          name: 'run_test',
          status: 'failed',
          summary: 'pnpm exec vitest run AiToolActivityInline.spec.ts',
        },
      ],
    });

    expect(wrapper.get('.ai-tool-group').attributes('data-state')).toBe('open');
    expect(wrapper.get('.ai-tool-status-text.is-failed').text()).toBe('失败');
  });

  it('联网搜索默认只显示真实上下文，详情展开后仍能看到真实字段', async () => {
    const wrapper = mountActivity([
      {
        id: 'tool-call-search',
        name: 'tavily_search',
        status: 'running',
        summary: '今日热点新闻 · example.com',
        targetPreview: '今日热点新闻 · example.com',
        detailItems: [
          '平台：Tavily',
          '查询：今日热点新闻',
          '站点：example.com',
        ],
      },
    ], '联网搜索「今日热点新闻」，站点 example.com');

    expect(wrapper.find('.ai-tool-note-text').text()).toBe('联网搜索「今日热点新闻」，站点 example.com');
    expect(wrapper.get('.ai-tool-row-text').text()).toContain('联网搜索');
    expect(wrapper.get('.ai-tool-row-text').text()).toContain('今日热点新闻');
    expect(wrapper.text()).not.toContain('tavily_search');

    await wrapper.get('.ai-tool-single-row-header').trigger('click');

    expect(wrapper.text()).toContain('站点：example.com');
    expect(wrapper.text()).toContain('平台：Tavily');
    expect(wrapper.text()).not.toContain('tavily_search');
  });

  it('忽略 narrator activityNotes，只保留非 narrator 的活动说明', () => {
    const wrapper = mountActivity(
      [],
      undefined,
      ['先读取 app.ts，再决定是否修改。'],
      undefined,
      undefined,
      [
        {
          id: 'narrator-note-1',
          runId: 'run-1',
          source: 'narrator',
          trigger: 'edit_done',
          text: 'app.ts 已经改完，下一步准备验证。',
          tone: 'decision',
          relatedActionIds: [],
          factsHash: 'facts:abc123',
          createdAt: 1,
        },
      ],
    );

    const notes = wrapper.findAll('.ai-tool-note-body').map((item) => item.text());

    expect(notes).toEqual([
      '先读取 app.ts，再决定是否修改。',
    ]);
    expect(wrapper.text()).not.toContain('app.ts 已经改完，下一步准备验证。');
  });

  it('把活动树投成 note/group/row，并允许说明文字穿插在操作组之间', () => {
    const wrapper = mountActivity([], undefined, undefined, [
      {
        id: 'run-root',
        runId: 'run-1',
        kind: 'run',
        status: 'running',
        title: '我要改 3 个点：store 持久化宽度、workbench 读取回写、补测试锁住链路。',
      },
      {
        id: 'summary-1',
        runId: 'run-1',
        parentId: 'run-root',
        kind: 'reasoning_summary',
        status: 'running',
        title: '正在生成 app.ts 和 useShellWorkbenchView.ts 的修补程序。',
      },
      {
        id: 'tool-read',
        runId: 'run-1',
        parentId: 'run-root',
        kind: 'read_file',
        status: 'success',
        title: '查看文本文件',
        description: 'src/composables/useShellWorkbenchView.ts:1-120',
        details: [
          {
            label: '文件',
            value: 'src/composables/useShellWorkbenchView.ts:1-120',
            priority: 96,
          },
        ],
      },
      {
        id: 'summary-2',
        runId: 'run-1',
        parentId: 'run-root',
        kind: 'reasoning_summary',
        status: 'running',
        title: '功能链路已经接上了。现在补测试，把恢复旧宽度和拖拽回写锁住。',
      },
      {
        id: 'tool-edit',
        runId: 'run-1',
        parentId: 'run-root',
        kind: 'edit_file',
        status: 'success',
        title: '修改文件',
        description: 'src/composables/useShellWorkbenchView.spec.ts',
        details: [
          {
            label: '文件',
            value: 'src/composables/useShellWorkbenchView.spec.ts',
            priority: 96,
          },
          {
            label: 'additions',
            value: '8',
            priority: 70,
          },
          {
            label: 'deletions',
            value: '0',
            priority: 70,
          },
        ],
      },
    ]);

    const notes = wrapper.findAll('.ai-tool-note-text').map((item) => item.text());
    const groups = wrapper.findAll('.ai-tool-group-header');
    const rows = wrapper.findAll('.ai-tool-row-text').map((item) => item.text());

    expect(notes).toEqual([
      '我要改 3 个点：store 持久化宽度、workbench 读取回写、补测试锁住链路。',
      '正在生成 app.ts 和 useShellWorkbenchView.ts 的修补程序。',
      '功能链路已经接上了。现在补测试，把恢复旧宽度和拖拽回写锁住。',
    ]);
    expect(groups).toHaveLength(2);
    expect(rows).toContain('读取 useShellWorkbenchView.ts，行 1 到 120');
    expect(rows).toContain('已编辑 useShellWorkbenchView.spec.ts +8 -0');
  });

  it('没有预构建 activities 时也能从 activityEvents 还原活动树', () => {
    const wrapper = mountActivity([], undefined, undefined, undefined, [
      {
        type: 'ACTIVITY_SNAPSHOT',
        timestamp: 1_746_217_200_000,
        messageId: 'run-root',
        activityType: 'RUN',
        replace: true,
        content: {
          id: 'run-root',
          runId: 'run-1',
          kind: 'run',
          status: 'running',
          title: '验证内部 AG-UI event log',
        },
      },
      {
        type: 'ACTIVITY_SNAPSHOT',
        timestamp: 1_746_217_200_001,
        messageId: 'summary-1',
        activityType: 'REASONING_SUMMARY',
        replace: true,
        content: {
          id: 'summary-1',
          runId: 'run-1',
          parentId: 'run-root',
          kind: 'reasoning_summary',
          status: 'running',
          title: '正在从 event log 还原活动树',
        },
      },
      {
        type: 'ACTIVITY_SNAPSHOT',
        timestamp: 1_746_217_200_002,
        messageId: 'tool-1',
        activityType: 'READ_FILE',
        replace: true,
        content: {
          id: 'tool-1',
          runId: 'run-1',
          parentId: 'run-root',
          kind: 'read_file',
          status: 'running',
          title: '查看文本文件',
          description: 'src/components/editor/EditorContextMenu.vue',
          details: [
            {
              label: '文件',
              value: 'src/components/editor/EditorContextMenu.vue',
              priority: 96,
            },
          ],
        },
      },
    ]);

    expect(wrapper.text()).toContain('验证内部 AG-UI event log');
    expect(wrapper.text()).toContain('正在从 event log 还原活动树');
    expect(wrapper.text()).toContain('读取 EditorContextMenu.vue');
  });

  it('会展示 root 下更深层的 activity，不只依赖直接子节点', () => {
    const wrapper = mountActivity([], undefined, undefined, [
      {
        id: 'run-root',
        runId: 'run-1',
        kind: 'run',
        status: 'running',
        title: '分析活动树深层节点',
      },
      {
        id: 'summary-1',
        runId: 'run-1',
        parentId: 'run-root',
        kind: 'reasoning_summary',
        status: 'running',
        title: '先收集上下文，再进入工具执行',
      },
      {
        id: 'tool-1',
        runId: 'run-1',
        parentId: 'summary-1',
        kind: 'search',
        status: 'running',
        title: '文件搜索',
        description: 'EditorContextMenuIcon · src/components/editor',
        details: [
          {
            label: '搜索',
            value: 'EditorContextMenuIcon',
            priority: 96,
          },
        ],
      },
      {
        id: 'read-1',
        runId: 'run-1',
        parentId: 'tool-1',
        kind: 'read_file',
        status: 'success',
        title: '查看文本文件',
        description: 'src/components/editor/EditorContextMenu.vue',
        details: [
          {
            label: '文件',
            value: 'src/components/editor/EditorContextMenu.vue',
            priority: 90,
          },
        ],
      },
    ]);

    expect(wrapper.text()).toContain('分析活动树深层节点');
    expect(wrapper.text()).toContain('先收集上下文，再进入工具执行');
    expect(wrapper.text()).toContain('搜索「EditorContextMenuIcon」');
    expect(wrapper.text()).toContain('读取 EditorContextMenu.vue');
  });
});
