import { useAiTokenContext } from '@/composables/useAiTokenContext';
import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';
import type { IAiChatMessage } from '@/types/ai';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';

const createMessage = (content: string): IAiChatMessage => ({
  id: 'message-1',
  role: 'assistant',
  content,
  createdAt: '2026-05-09T10:00:00.000Z',
  references: [],
});

const createModelStartedEvent = (projectedInputTokens: number): TAgentRuntimeEvent => ({
  id: 'runtime-token-1',
  type: 'agent.model.started',
  runId: 'run-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  timestamp: '2026-05-09T10:00:01.000Z',
  seq: 1,
  schemaVersion: 1,
  redacted: true,
  visibility: 'debug',
  level: 'info',
  projectedInputTokens,
  projectedInputTokensAvailable: true,
});

describe('useAiTokenContext', () => {
  it('uses 1M context window for deepseek models', () => {
    const context = useAiTokenContext({
      modelId: computed(() => 'deepseek/deepseek-v4-flash'),
      runtimeEvents: computed(() => []),
      messages: computed(() => []),
      draft: computed(() => ''),
    });

    expect(context.contextProps.value.maxTokens).toBe(1_000_000);
  });

  it('estimates visible conversation tokens before runtime token events arrive', () => {
    const messages = ref<IAiChatMessage[]>([
      createMessage('总的来说，我可以帮你读写文件、搜索代码、分析日志。'),
    ]);
    const draft = ref('');
    const context = useAiTokenContext({
      modelId: computed(() => 'deepseek/deepseek-v4-pro'),
      runtimeEvents: computed(() => []),
      messages: computed(() => messages.value),
      draft: computed(() => draft.value),
    });

    const initialTokens = context.contextProps.value.usedTokens;
    draft.value = '继续解释 Git 操作。';

    expect(initialTokens).toBeGreaterThan(0);
    expect(context.contextProps.value.usedTokens).toBeGreaterThan(initialTokens);
  });

  it('uses runtime projected input tokens when available', () => {
    const messages = ref<IAiChatMessage[]>([
      createMessage('这条本地估算内容会被 runtime token 覆盖。'),
    ]);
    const context = useAiTokenContext({
      modelId: computed(() => 'openai/gpt-5'),
      runtimeEvents: computed(() => [createModelStartedEvent(12345)]),
      messages: computed(() => messages.value),
      draft: computed(() => ''),
    });

    expect(context.contextProps.value.usedTokens).toBe(12345);
    expect(context.contextProps.value.usage.inputTokens).toBe(12345);
  });
});
