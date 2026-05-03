import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AiAgentRuntimeTimeline from '@/components/business/ai/AiAgentRuntimeTimeline.vue';

import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';

const createEvent = (overrides: Partial<TAgentRuntimeEvent>): TAgentRuntimeEvent => ({
    id: overrides.id ?? 'event-1',
    type: overrides.type ?? 'agent.tool.started',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? 'session-1',
    agentId: overrides.agentId ?? 'agent-1',
    timestamp: overrides.timestamp ?? '2026-05-03T10:00:00.000Z',
    seq: overrides.seq ?? 1,
    schemaVersion: 1,
    redacted: true,
    visibility: overrides.visibility ?? 'user',
    level: overrides.level ?? 'info',
    toolName: 'search_project_files',
    inputPreview: '{"pattern":"useAiAssistant","path":"src"}',
    ...(overrides as object),
}) as TAgentRuntimeEvent;

describe('AiAgentRuntimeTimeline', () => {
    it('直接渲染全部 runtime events，而不是只展示最近几条摘要', () => {
        const events = Array.from({ length: 7 }, (_, index) => createEvent({
            id: `event-${index + 1}`,
            seq: index + 1,
            inputPreview: `payload-${index + 1}`,
        }));

        const wrapper = mount(AiAgentRuntimeTimeline, {
            props: {
                events,
            },
        });

        expect(wrapper.findAll('.ai-runtime-timeline__item')).toHaveLength(7);
        expect(wrapper.text()).toContain('payload-1');
        expect(wrapper.text()).toContain('payload-7');
    });

    it('输出事件完整 JSON 内容，不再使用二次概括标签', () => {
        const wrapper = mount(AiAgentRuntimeTimeline, {
            props: {
                events: [createEvent({
                    type: 'agent.tool.completed',
                    id: 'tool-completed-1',
                    seq: 2,
                    ok: true,
                    resultPreview: '{"summary":"找到 3 个命中"}',
                })],
            },
        });

        expect(wrapper.text()).toContain('agent.tool.completed');
        expect(wrapper.text()).toContain('"resultPreview": "{\\"summary\\":\\"找到 3 个命中\\"}"');
        expect(wrapper.text()).not.toContain('工具完成');
    });
});