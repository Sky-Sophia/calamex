import { aiChatStreamEventPayloadSchema } from '@/types/ai/schema';
import type { ITauriService } from '@/types/tauri';
import { assertDesktopRuntime } from '@/utils/desktop-runtime';
import { tauriContracts } from './tauri.contracts';
import { defineContractIpc, definePayloadIpc } from './tauri.ipc-factory';
import {
  buildPayloadMetrics,
  buildPayloadMetricsOmittingTextFields,
  measureAiChatInput,
  measureAiInlineCompletionInput,
} from './tauri.ipc-metrics';
import { loadTauriEvent } from './tauri.ipc-runtime';

const aiGetConfigIpc = defineContractIpc(
  'ai_get_config',
  '读取 AI 配置',
  tauriContracts.aiGetConfig,
  { idempotent: true, audit: 'sensitive' },
);

const aiSaveConfigIpc = definePayloadIpc(
  'ai_save_config',
  '保存 AI 配置',
  tauriContracts.aiSaveConfig,
  { audit: 'sensitive' },
);

const aiSaveCredentialsIpc = definePayloadIpc(
  'ai_save_credentials',
  '保存 AI 凭证',
  tauriContracts.aiSaveCredentials,
  {
    audit: 'sensitive',
    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['apiKey']),
  },
);

const aiTestProviderConfigIpc = definePayloadIpc(
  'ai_test_provider_config',
  '使用草稿配置测试 AI Provider',
  tauriContracts.aiTestProviderConfig,
  {
    idempotent: true,
    audit: 'sensitive',
    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['apiKey']),
  },
);

const aiConnectProviderIpc = definePayloadIpc(
  'ai_connect_provider',
  '连接并保存 AI Provider',
  tauriContracts.aiConnectProvider,
  {
    audit: 'sensitive',
    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['apiKey']),
  },
);

const aiClearCredentialsIpc = defineContractIpc(
  'ai_clear_credentials',
  '清除 AI 凭证',
  tauriContracts.aiClearCredentials,
  { audit: 'sensitive' },
);

const aiTestProviderIpc = defineContractIpc(
  'ai_test_provider',
  '测试 AI Provider',
  tauriContracts.aiTestProvider,
  { idempotent: true, audit: 'sensitive' },
);

const aiGenerateConversationTitleIpc = definePayloadIpc(
  'ai_generate_conversation_title',
  '生成 AI 对话标题',
  tauriContracts.aiGenerateConversationTitle,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: buildPayloadMetrics },
);

const aiGetSuggestionPoolCacheIpc = defineContractIpc(
  'ai_get_suggestion_pool_cache',
  '读取 AI 提示词池缓存',
  tauriContracts.aiGetSuggestionPoolCache,
  { idempotent: true, audit: 'none', timeoutMs: 5_000 },
);

const aiGenerateSuggestionPoolIpc = definePayloadIpc(
  'ai_generate_suggestion_pool',
  '生成 AI 提示词池',
  tauriContracts.aiGenerateSuggestionPool,
  { audit: 'info', timeoutMs: 30_000, measureInput: buildPayloadMetrics },
);

const aiChatStreamIpc = definePayloadIpc(
  'ai_chat_stream',
  '发送 AI 流式对话请求',
  tauriContracts.aiChatStream,
  { audit: 'sensitive', timeoutMs: 60_000, measureInput: measureAiChatInput },
);

const aiCancelIpc = definePayloadIpc('ai_cancel', '取消 AI 流式请求', tauriContracts.aiCancel, {
  audit: 'sensitive',
  timeoutMs: 15_000,
  measureInput: buildPayloadMetrics,
});

const aiInlineCompleteIpc = definePayloadIpc(
  'ai_inline_complete',
  '请求 AI 内联补全',
  tauriContracts.aiInlineComplete,
  { audit: 'sensitive', timeoutMs: 15_000, measureInput: measureAiInlineCompletionInput },
);

const aiAgentClassifyTaskIpc = definePayloadIpc(
  'ai_agent_classify_task',
  '分类 AI Agent 任务复杂度',
  tauriContracts.aiAgentClassifyTask,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureAiChatInput },
);

const aiAgentSetNetworkPermissionIpc = definePayloadIpc(
  'ai_agent_set_network_permission',
  '设置 AI Agent 网络权限',
  tauriContracts.aiAgentSetNetworkPermission,
  { audit: 'sensitive', timeoutMs: 15_000 },
);

const aiWebSearchIpc = definePayloadIpc(
  'ai_web_search',
  '执行 AI Agent 网络搜索',
  tauriContracts.aiWebSearch,
  { idempotent: true, audit: 'sensitive', timeoutMs: 30_000 },
);

const aiWebFetchIpc = definePayloadIpc(
  'ai_web_fetch',
  '读取 AI Agent 网页来源',
  tauriContracts.aiWebFetch,
  { idempotent: true, audit: 'sensitive', timeoutMs: 30_000 },
);

const aiProposePatchIpc = definePayloadIpc(
  'ai_propose_patch',
  '生成 AI Patch 预览',
  tauriContracts.aiProposePatch,
  {
    audit: 'sensitive',
    timeoutMs: 30_000,
    measureInput: (value) =>
      buildPayloadMetricsOmittingTextFields(value, ['originalContent', 'updatedContent']),
  },
);

const aiApplyPatchIpc = definePayloadIpc(
  'ai_apply_patch',
  '应用 AI Patch',
  tauriContracts.aiApplyPatch,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureAiChatInput },
);

type TAiTauriService = Pick<
  ITauriService,
  | 'aiGetConfig'
  | 'aiSaveConfig'
  | 'aiSaveCredentials'
  | 'aiClearCredentials'
  | 'aiTestProvider'
  | 'aiTestProviderConfig'
  | 'aiConnectProvider'
  | 'aiGenerateConversationTitle'
  | 'aiGetSuggestionPoolCache'
  | 'aiGenerateSuggestionPool'
  | 'aiChatStream'
  | 'aiCancel'
  | 'onAiChatStream'
  | 'aiInlineComplete'
  | 'aiAgentClassifyTask'
  | 'aiAgentSetNetworkPermission'
  | 'aiWebSearch'
  | 'aiWebFetch'
  | 'aiProposePatch'
  | 'aiApplyPatch'
>;

export const aiTauriService: TAiTauriService = {
  aiGetConfig: () => aiGetConfigIpc(undefined),

  aiSaveConfig: aiSaveConfigIpc,

  aiSaveCredentials: aiSaveCredentialsIpc,

  aiClearCredentials: () => aiClearCredentialsIpc(undefined),

  aiTestProvider: () => aiTestProviderIpc(undefined),

  aiTestProviderConfig: aiTestProviderConfigIpc,

  aiConnectProvider: aiConnectProviderIpc,

  aiGenerateConversationTitle: aiGenerateConversationTitleIpc,

  aiGetSuggestionPoolCache: () => aiGetSuggestionPoolCacheIpc(undefined),

  aiGenerateSuggestionPool: aiGenerateSuggestionPoolIpc,

  aiChatStream: aiChatStreamIpc,

  aiCancel: aiCancelIpc,

  async onAiChatStream(handler) {
    await assertDesktopRuntime('监听 AI 流式响应');
    const { listen } = await loadTauriEvent();
    return listen('ai:chat-stream', (event) => {
      const parsed = aiChatStreamEventPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        return;
      }
      handler(parsed.data);
    });
  },

  aiInlineComplete: aiInlineCompleteIpc,

  aiAgentClassifyTask: aiAgentClassifyTaskIpc,

  aiAgentSetNetworkPermission: aiAgentSetNetworkPermissionIpc,

  aiWebSearch: aiWebSearchIpc,

  aiWebFetch: aiWebFetchIpc,

  aiProposePatch: aiProposePatchIpc,

  aiApplyPatch: aiApplyPatchIpc,
};
