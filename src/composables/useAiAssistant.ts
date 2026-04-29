import { computed, ref, type Ref } from 'vue';

import { useAiStream } from '@/composables/useAiStream';
import { aiService } from '@/services/modules/ai';
import {
  buildActiveRunReference,
  buildCurrentFileReference,
  buildDiagnosticsReference,
  buildGitDiffReference,
  buildSelectionReference,
} from '@/services/modules/ai-context';
import { useAiConversationStore } from '@/store/aiConversation';
import { useAiEditStore } from '@/store/aiEdit';
import type {
  IAiChatMessage,
  IAiChatStreamEventPayload,
  IAiConfigPayload,
  IAiContextReference,
  IAiPatchSet,
  IAiProviderConnectionRequest,
  IAiTaskPlanStep,
  IAiToolDefinitionPayload,
  TAiChatMessageActionId,
} from '@/types/ai';
import type { IAiCodeBlock } from '@/types/ai-code';
import type {
  IActiveRunSummary,
  IAnalyzeScriptPayload,
  IEditorDocument,
  IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { toErrorMessage } from '@/utils/error';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type TAiQuickActionId = 'explain' | 'fix' | 'review';
type TAiAssistantMode = 'chat' | 'agent';
type TAiAttachmentKind = 'text' | 'image';

interface IAiImageDimensions {
  width: number;
  height: number;
}

export interface IAiAttachedFile {
  id: string;
  name: string;
  sizeLabel: string;
  kind: TAiAttachmentKind;
  detailLabel?: string;
  reference: IAiContextReference;
}

export interface IAiQuickAction {
  id: TAiQuickActionId;
  label: string;
}

export interface IUseAiAssistantOptions {
  document: Ref<IEditorDocument>;
  activeRun: Ref<IActiveRunSummary | null>;
  analysis: Ref<IAnalyzeScriptPayload>;
  selection: Ref<IEditorSelectionSummary | null>;
  gitStatus: Ref<IGitRepositoryStatusPayload>;
  workspaceRootPath: Ref<string | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 12_000;
const MAX_TEXT_ATTACHMENT_BYTES = 128 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const TEXT_ATTACHMENT_PATTERN =
  /^(application\/(json|xml|x-sh|x-shellscript|javascript|typescript)|text\/)/i;
const TEXT_ATTACHMENT_EXTENSION_PATTERN =
  /\.(bash|cjs|conf|css|csv|env|js|json|jsx|log|md|mjs|ps1|py|rs|sh|sql|toml|ts|tsx|txt|vue|xml|yaml|yml|zsh)$/i;
const IMAGE_ATTACHMENT_PATTERN = /^image\//i;
const IMAGE_ATTACHMENT_EXTENSION_PATTERN = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const CONTEXT_TOKEN_PATTERN =
  /(^|\s)@(file|current-file|selection|terminal|log|diagnostics|shellcheck|git-diff|git|project|folder|search|symbol)(?=\s|$)/gi;

const CODE_BLOCK_PATTERN = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/;

const PROJECT_SEARCH_TOKENS = ['project', 'folder', 'search', 'symbol'] as const;
const AGENT_EXECUTION_ACTION_ID: TAiChatMessageActionId = 'allow-agent-execution';
const AGENT_CONFIRMATION_PROMPT = '是否允许 AI 开始执行这个任务？';
const AGENT_CONFIRMATION_DETAIL = '写文件、运行命令和 Git 操作前仍会逐项向你确认。';
const AGENT_EXECUTION_SYSTEM_PROMPT = '你现在处于 Agent 执行模式。请继续完成任务，但在写文件、运行命令或执行 Git 操作前必须先征求用户确认。不要假设已经获得授权。';

// 占位中文文案：请按你仓库的实际原文回填（原贴的 `?` 串疑似编码丢失）
const MSG_STREAM_CANCELLED = 'AI 流已被取消';
const MSG_STREAM_ERROR = 'AI 响应出错';
const MSG_CALL_FAILED = 'AI 调用失败';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const createMessageId = (role: IAiChatMessage['role']): string =>
  `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createAgentConfirmationContent = (): string =>
  `${AGENT_CONFIRMATION_PROMPT}\n\n${AGENT_CONFIRMATION_DETAIL}`;

const clipText = (value: string, limit: number): string => {
  const chars = [...value];
  if (chars.length <= limit) return value;
  return `${chars.slice(0, limit).join('')}\n\n[内容已截断，仅发送前 ${limit} 个字符]`;
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const isTextAttachment = (file: File): boolean =>
  TEXT_ATTACHMENT_PATTERN.test(file.type) || TEXT_ATTACHMENT_EXTENSION_PATTERN.test(file.name);

const isImageAttachment = (file: File): boolean =>
  IMAGE_ATTACHMENT_PATTERN.test(file.type) || IMAGE_ATTACHMENT_EXTENSION_PATTERN.test(file.name);

const inferImageExtension = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized.startsWith('image/')) return normalized.slice('image/'.length);
  return 'png';
};

const normalizeAttachmentName = (file: File): string => {
  const normalizedName = file.name.trim();
  if (normalizedName) return normalizedName;
  if (isImageAttachment(file)) return `pasted-image.${inferImageExtension(file.type)}`;
  return 'pasted-attachment.txt';
};

const formatImageDimensions = (dimensions: IAiImageDimensions | null): string | null => {
  if (!dimensions) return null;
  return `${dimensions.width} × ${dimensions.height}`;
};

const readImageDimensions = async (file: File): Promise<IAiImageDimensions | null> => {
  if (typeof globalThis.createImageBitmap !== 'function') return null;
  try {
    const bitmap = await globalThis.createImageBitmap(file);
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close?.();
    return dimensions;
  } catch {
    return null;
  }
};

const mapStreamStatus = (
  status: ReturnType<typeof useAiStream>['status']['value'],
): NonNullable<IAiChatMessage['stream']>['status'] => {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  return 'streaming';
};

// ---------------------------------------------------------------------------
// Public quick actions
// ---------------------------------------------------------------------------

export const AI_QUICK_ACTIONS: IAiQuickAction[] = [
  { id: 'explain', label: '解释当前脚本' },
  { id: 'fix', label: '修复报错' },
  { id: 'review', label: '代码审查' },
];

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export const useAiAssistant = (options: IUseAiAssistantOptions) => {
  const conversationStore = useAiConversationStore();
  const aiEditStore = useAiEditStore();
  const config = ref<IAiConfigPayload>({
    providerType: 'mock',
    selectedModel: 'mock-ide-assistant',
    baseUrl: null,
    isBaseUrlConfigured: false,
    hasCredentials: false,
    isConfigured: true,
    inlineCompletionEnabled: false,
    chatEnabled: true,
    agentEnabled: false,
  });

  const messages = computed<IAiChatMessage[]>({
    get: () => conversationStore.activeMessages,
    set: (nextMessages) => {
      conversationStore.replaceMessages(nextMessages);
    },
  });
  const historyThreads = computed(() => conversationStore.historyThreads);
  const activeConversationId = computed(() => conversationStore.activeThreadId);
  const draft = ref('');
  const isSending = ref(false);
  const errorMessage = ref('');
  const isSettingsOpen = ref(false);
  const isClearDialogOpen = ref(false);
  const currentReferences = ref<IAiContextReference[]>([]);
  const proposedPatch = ref<IAiPatchSet | null>(null);
  const isApplyingPatch = ref(false);
  const activeMode = ref<TAiAssistantMode>('chat');
  const agentSteps = ref<IAiTaskPlanStep[]>([]);
  const toolDefinitions = ref<IAiToolDefinitionPayload[]>([]);
  const attachedFiles = ref<IAiAttachedFile[]>([]);

  const activeAbortController = ref<AbortController | null>(null);
  const activeStreamId = ref<string | null>(null);
  const activeStreamResolve = ref<(() => void) | null>(null);
  const activeAssistantMessage = ref<IAiChatMessage | null>(null);
  const activeAssistantBaseMessages = ref<IAiChatMessage[]>([]);

  const aiStream = useAiStream();

  const replaceMessageById = (
    messageId: string,
    updater: (message: IAiChatMessage) => IAiChatMessage,
  ): IAiChatMessage[] => {
    const nextMessages = messages.value.map((message) => (
      message.id === messageId ? updater(message) : message
    ));
    messages.value = nextMessages;
    return nextMessages;
  };

  const createAgentExecutionSystemMessage = (goal: string): IAiChatMessage => ({
    id: createMessageId('system'),
    role: 'system',
    content: `${AGENT_EXECUTION_SYSTEM_PROMPT}\n\n当前任务：${goal}`,
    createdAt: new Date().toISOString(),
    references: [],
  });

  // -----------------------------------------------------------------------
  // Computed
  // -----------------------------------------------------------------------

  const providerLabel = computed(() =>
    config.value.chatEnabled
      ? `${config.value.providerType} · ${config.value.selectedModel ?? 'mock-ide-assistant'}`
      : '未启用 Chat',
  );

  const sendButtonLabel = computed(() => (isSending.value ? '发送中…' : '发送'));

  const latestAssistantCodeBlock = computed(() => {
    const message = [...messages.value].reverse().find((item) => item.role === 'assistant');
    const match = message?.content.match(CODE_BLOCK_PATTERN);
    return match?.[1] ?? '';
  });

  const canPreviewPatch = computed(() => {
    const document = options.document.value;
    return Boolean(
      document.path && document.kind === 'text' && latestAssistantCodeBlock.value.trim(),
    );
  });

  // -----------------------------------------------------------------------
  // Context builders
  // -----------------------------------------------------------------------

  const buildDocumentContext = (): string => {
    const document = options.document.value;
    if (!document.id || document.kind !== 'text') {
      return '当前没有可用的文本脚本文档。';
    }
    return [
      `文件名：${document.name}`,
      `路径：${document.path ?? '未保存'}`,
      `状态：${document.isDirty ? '有未保存修改' : '已保存'}`,
      '脚本内容：',
      '```sh',
      clipText(document.content, MAX_CONTEXT_CHARS),
      '```',
    ].join('\n');
  };

  const buildRunContext = (): string => {
    const activeRun = options.activeRun.value;
    if (!activeRun) return '当前没有正在运行或最近触发的运行记录。';
    return [
      `运行文件：${activeRun.documentName}`,
      `命令：${activeRun.commandLine}`,
      `执行器：${activeRun.executorLabel}`,
      `开始时间：${activeRun.startedAt}`,
      `临时文件：${activeRun.usedTempFile ? '是' : '否'}`,
    ].join('\n');
  };

  const buildQuickPrompt = (actionId: TAiQuickActionId): string => {
    const documentContext = buildDocumentContext();
    if (actionId === 'explain') {
      return `请解释当前脚本的执行流程、关键变量、外部依赖和潜在风险。\n\n${documentContext}`;
    }
    if (actionId === 'fix') {
      return `请根据当前脚本和运行上下文定位问题根因，并给出最小修改方案。如果上下文不足，请列出还需要哪些信息。\n\n${documentContext}\n\n运行上下文：\n${buildRunContext()}`;
    }
    return `请按安全、参数可靠性、可维护性、边界条件和可验证性审查当前脚本。请只给出基于代码能确认的问题。\n\n${documentContext}`;
  };

  const resolveContextTokens = (prompt: string): Set<string> => {
    const tokens = new Set<string>();
    for (const match of prompt.matchAll(CONTEXT_TOKEN_PATTERN)) {
      const token = match[2]?.toLowerCase();
      if (token) tokens.add(token);
    }
    return tokens;
  };

  const shouldIncludeReference = (
    tokens: Set<string>,
    aliases: readonly string[],
  ): boolean => tokens.size === 0 || aliases.some((alias) => tokens.has(alias));

  const buildProjectSearchReference = async (
    prompt: string,
  ): Promise<IAiContextReference | null> => {
    const tokens = resolveContextTokens(prompt);
    const shouldSearchProject = PROJECT_SEARCH_TOKENS.some((item) => tokens.has(item));
    const workspaceRootPath = options.workspaceRootPath.value;
    if (!shouldSearchProject || !workspaceRootPath) return null;

    const query = prompt
      .replace(CONTEXT_TOKEN_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!query) return null;

    const payload = await aiService.queryIndex({
      workspaceRootPath,
      query,
      limit: 8,
    });
    if (payload.results.length === 0) return null;

    return {
      id: `search-result:${workspaceRootPath}:${query}`,
      kind: 'search-result',
      label: `项目搜索 · ${query}`,
      path: workspaceRootPath,
      range: null,
      contentPreview: payload.results
        .map(
          (item) =>
            `${item.path}${item.lineNumber ? `:${item.lineNumber}` : ''}\n${item.preview}`,
        )
        .join('\n---\n'),
      redacted: false,
    };
  };

  const buildReferences = async (prompt = ''): Promise<IAiContextReference[]> => {
    const tokens = resolveContextTokens(prompt);

    const currentFile = buildCurrentFileReference(options.document.value);
    const selection = buildSelectionReference(options.selection.value, options.document.value);
    const activeRun = buildActiveRunReference(options.activeRun.value);
    const diagnostics = buildDiagnosticsReference(
      options.analysis.value,
      options.document.value,
    );
    const gitDiff = buildGitDiffReference(options.gitStatus.value);
    const projectSearch = await buildProjectSearchReference(prompt).catch(() => null);

    const candidates: ReadonlyArray<readonly [IAiContextReference | null, readonly string[]]> = [
      [currentFile, ['file', 'current-file']],
      [selection, ['selection']],
      [activeRun, ['terminal', 'log']],
      [diagnostics, ['diagnostics', 'shellcheck']],
      [gitDiff, ['git-diff', 'git']],
      [projectSearch, PROJECT_SEARCH_TOKENS],
    ];

    const references = candidates
      .filter(([, aliases]) => shouldIncludeReference(tokens, aliases))
      .map(([reference]) => reference)
      .filter((item): item is IAiContextReference => item !== null);

    return [...references, ...attachedFiles.value.map((file) => file.reference)];
  };

  // -----------------------------------------------------------------------
  // Config / tools / credentials
  // -----------------------------------------------------------------------

  const loadConfig = async (): Promise<void> => {
    config.value = await aiService.getConfig();
  };

  const loadTools = async (): Promise<void> => {
    toolDefinitions.value = await aiService.listTools();
  };

  const saveConfig = async (nextConfig: IAiConfigPayload): Promise<void> => {
    config.value = await aiService.saveConfig({
      providerType: nextConfig.providerType,
      selectedModel: nextConfig.selectedModel,
      baseUrl: nextConfig.baseUrl,
      inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,
      chatEnabled: nextConfig.chatEnabled,
      agentEnabled: nextConfig.agentEnabled,
    });
  };

  const saveCredentials = async (
    apiKey: string,
    providerType = config.value.providerType,
  ): Promise<void> => {
    config.value = await aiService.saveCredentials({ providerType, apiKey });
  };

  const createProviderConnectionRequest = (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): IAiProviderConnectionRequest => ({
    providerType: nextConfig.providerType,
    selectedModel: nextConfig.selectedModel,
    baseUrl: nextConfig.baseUrl,
    inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,
    chatEnabled: nextConfig.chatEnabled,
    agentEnabled: nextConfig.agentEnabled,
    apiKey: apiKey.trim() || null,
  });

  const testProviderConfig = async (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): Promise<string> => {
    const result = await aiService.testProviderConfig(
      createProviderConnectionRequest(nextConfig, apiKey),
    );
    if (!result.ok) {
      errorMessage.value = result.message;
      throw new Error(result.message);
    }
    return result.message;
  };

  const connectProvider = async (
    nextConfig: IAiConfigPayload,
    apiKey: string,
  ): Promise<string> => {
    const result = await aiService.connectProvider(
      createProviderConnectionRequest(nextConfig, apiKey),
    );
    config.value = result.config;
    return result.test.message;
  };

  const testProvider = async (): Promise<string> => {
    const result = await aiService.testProvider();
    if (!result.ok) {
      errorMessage.value = result.message;
      throw new Error(result.message);
    }
    return result.message;
  };

  // -----------------------------------------------------------------------
  // Quick actions / attachments
  // -----------------------------------------------------------------------

  const applyQuickAction = (action: IAiQuickAction): void => {
    draft.value = buildQuickPrompt(action.id);
    void buildReferences(draft.value).then((references) => {
      currentReferences.value = references;
    });
    errorMessage.value = '';
  };

  const attachFile = async (file: File): Promise<void> => {
    const normalizedName = normalizeAttachmentName(file);

    if (isTextAttachment(file)) {
      if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
        errorMessage.value = `附件超过 ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)}，请先拆分或只粘贴关键片段。`;
        return;
      }

      const content = await file.text().catch((): null => null);
      if (content === null) {
        errorMessage.value = '读取附件失败，请确认文件可访问后重试。';
        return;
      }

      const id = `attachment:${normalizedName}:${file.lastModified}:${file.size}`;
      const reference: IAiContextReference = {
        id,
        kind: 'search-result',
        label: `附件 · ${normalizedName}`,
        path: normalizedName,
        range: null,
        contentPreview: [
          `文件名：${normalizedName}`,
          `大小：${formatBytes(file.size)}`,
          '内容：',
          clipText(content, MAX_CONTEXT_CHARS),
        ].join('\n'),
        redacted: false,
      };

      attachedFiles.value = [
        ...attachedFiles.value.filter((item) => item.id !== id),
        {
          id,
          name: normalizedName,
          sizeLabel: formatBytes(file.size),
          kind: 'text',
          reference,
        },
      ];
      currentReferences.value = await buildReferences(draft.value);
      errorMessage.value = '';
      return;
    }

    if (isImageAttachment(file)) {
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        errorMessage.value = `图片超过 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}，请压缩后再试。`;
        return;
      }

      const dimensions = await readImageDimensions(file);
      const dimensionsLabel = formatImageDimensions(dimensions);
      const id = `attachment:${normalizedName}:${file.lastModified}:${file.size}`;
      const reference: IAiContextReference = {
        id,
        kind: 'image-attachment',
        label: `图片附件 · ${normalizedName}`,
        path: normalizedName,
        range: null,
        contentPreview: [
          `文件名：${normalizedName}`,
          `类型：${file.type || 'image/*'}`,
          `大小：${formatBytes(file.size)}`,
          ...(dimensionsLabel ? [`尺寸：${dimensionsLabel}`] : []),
          '说明：这是用户在 AI 输入框里粘贴或添加的图片附件。当前会把图片元信息作为上下文发送。',
        ].join('\n'),
        redacted: false,
      };

      attachedFiles.value = [
        ...attachedFiles.value.filter((item) => item.id !== id),
        {
          id,
          name: normalizedName,
          sizeLabel: formatBytes(file.size),
          kind: 'image',
          detailLabel: dimensionsLabel ?? undefined,
          reference,
        },
      ];
      currentReferences.value = await buildReferences(draft.value);
      errorMessage.value = '';
      return;
    }

    errorMessage.value = '当前只支持文本文件和图片作为 AI 上下文附件。';
  };

  const removeAttachedFile = (id: string): void => {
    attachedFiles.value = attachedFiles.value.filter((item) => item.id !== id);
    void buildReferences(draft.value).then((references) => {
      currentReferences.value = references;
    });
  };

  // -----------------------------------------------------------------------
  // Streaming pipeline (extracted from sendMessage)
  // -----------------------------------------------------------------------

  interface IStreamPipeline {
    readonly handleEvent: (event: IAiChatStreamEventPayload) => void;
    readonly startAssistantStream: (streamId: string, assistantMessageId: string) => void;
    readonly cleanupRaf: () => void;
  }

  const createStreamPipeline = (
    assistantMessage: IAiChatMessage,
    messageContent: string,
    settle: () => void,
  ): IStreamPipeline => {
    let pendingDelta = '';
    let animationFrameId: number | null = null;
    let isStreamClosed = false;
    let hasStartedStream = false;

    const syncAssistantMessage = (): void => {
      const current = activeAssistantMessage.value;
      if (!current) return;
      current.content = aiStream.content.value;
      current.stream = {
        stableContent: aiStream.stableContent.value,
        openBlock: aiStream.openCodeBlock.value,
        status: mapStreamStatus(aiStream.status.value),
      };
      messages.value = [...activeAssistantBaseMessages.value, { ...current }];
    };

    const flushPendingDelta = (): void => {
      animationFrameId = null;
      if (!pendingDelta || isStreamClosed) return;
      const chunk = pendingDelta;
      pendingDelta = '';
      aiStream.append(chunk);
      syncAssistantMessage();
    };

    const scheduleDelta = (delta: string): void => {
      if (isStreamClosed) return;
      pendingDelta += delta;
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(flushPendingDelta);
    };

    const cleanupRaf = (): void => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const startAssistantStream = (streamId: string, assistantMessageId: string): void => {
      if (hasStartedStream) return;
      hasStartedStream = true;
      activeStreamId.value = streamId;
      assistantMessage.id = assistantMessageId;
      aiStream.start({ messageId: assistantMessageId });
      syncAssistantMessage();
    };

    const handleEvent = (event: IAiChatStreamEventPayload): void => {
      // First-seen `start` event bootstraps the stream id binding.
      if (!activeStreamId.value && event.kind === 'start') {
        startAssistantStream(event.streamId, event.assistantMessageId);
        return;
      }
      // Drop events from cancelled / superseded streams (incl. late deltas).
      if (event.streamId !== activeStreamId.value) return;

      if (event.kind === 'delta' && event.delta) {
        scheduleDelta(event.delta);
        return;
      }

      // Any non-delta terminal event: drain pending RAF then close.
      cleanupRaf();
      flushPendingDelta();
      isStreamClosed = true;

      if (event.kind === 'done') {
        aiStream.complete();
        syncAssistantMessage();
        attachedFiles.value = [];
        settle();
        return;
      }

      if (event.kind === 'cancelled') {
        aiStream.stop();
        syncAssistantMessage();
        errorMessage.value = event.message ?? MSG_STREAM_CANCELLED;
        settle();
        return;
      }

      if (event.kind === 'error') {
        aiStream.stop();
        syncAssistantMessage();
        errorMessage.value = event.message ?? MSG_STREAM_ERROR;
        draft.value = messageContent;
        settle();
      }
    };

    return { handleEvent, startAssistantStream, cleanupRaf };
  };

  const executeAiRequest = async (
    requestMessages: IAiChatMessage[],
    visibleMessages: IAiChatMessage[],
    messageContent: string,
    references: IAiContextReference[],
  ): Promise<void> => {
    errorMessage.value = '';
    isSending.value = true;

    const assistantMessage: IAiChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      references: [],
      stream: { stableContent: '', openBlock: null, status: 'streaming' },
    };
    activeAssistantMessage.value = assistantMessage;
    activeAssistantBaseMessages.value = visibleMessages;
    messages.value = [...visibleMessages, assistantMessage];

    let unlisten: (() => void) | null = null;
    let hasSettledStream = false;
    const settle = (): void => {
      hasSettledStream = true;
      activeStreamResolve.value?.();
    };

    const pipeline = createStreamPipeline(assistantMessage, messageContent, settle);

    try {
      unlisten = await aiService.onChatStream(pipeline.handleEvent);

      const stream = await aiService.chatStream({
        threadId: null,
        messages: requestMessages,
        references,
      });
      pipeline.startAssistantStream(stream.streamId, stream.assistantMessageId);

      await new Promise<void>((resolve) => {
        if (hasSettledStream) {
          resolve();
          return;
        }
        activeStreamResolve.value = resolve;
      });
    } finally {
      pipeline.cleanupRaf();
      unlisten?.();
      activeStreamResolve.value = null;
      activeStreamId.value = null;
      activeAbortController.value = null;
      activeAssistantMessage.value = null;
      activeAssistantBaseMessages.value = [];
      isSending.value = false;
    }
  };

  // -----------------------------------------------------------------------
  // sendMessage / planAgentTask
  // -----------------------------------------------------------------------

  const queueAgentExecutionConfirmation = (
    goal: string,
    references: IAiContextReference[],
  ): void => {
    const timestamp = new Date().toISOString();
    const userMessage: IAiChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: goal,
      createdAt: timestamp,
      references,
    };
    const confirmationMessage: IAiChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: createAgentConfirmationContent(),
      createdAt: new Date().toISOString(),
      references: [],
      actions: [{
        id: AGENT_EXECUTION_ACTION_ID,
        label: '允许执行',
      }],
      agentConfirmation: {
        goal,
        references,
        status: 'pending',
      },
    };

    messages.value = [...messages.value, userMessage, confirmationMessage];
    draft.value = '';
    errorMessage.value = '';
    agentSteps.value = [];
    attachedFiles.value = [];
  };

  const handleMessageAction = async (
    messageId: string,
    actionId: TAiChatMessageActionId,
  ): Promise<void> => {
    if (actionId !== AGENT_EXECUTION_ACTION_ID || isSending.value) {
      return;
    }

    const targetMessage = messages.value.find((message) => message.id === messageId);
    const confirmation = targetMessage?.agentConfirmation;
    if (!targetMessage || !confirmation || confirmation.status !== 'pending') {
      return;
    }

    const nextVisibleMessages = replaceMessageById(messageId, (message) => ({
      ...message,
      content: '已允许开始执行，AI 正在处理…',
      actions: [],
      agentConfirmation: message.agentConfirmation
        ? {
          ...message.agentConfirmation,
          status: 'running',
        }
        : undefined,
    }));
    const requestMessages = [
      createAgentExecutionSystemMessage(confirmation.goal),
      ...nextVisibleMessages.filter((message) => message.id !== messageId),
    ];

    try {
      await executeAiRequest(
        requestMessages,
        nextVisibleMessages,
        confirmation.goal,
        confirmation.references,
      );
    } catch (error) {
      errorMessage.value = toErrorMessage(error, MSG_CALL_FAILED);
      draft.value = confirmation.goal;
      replaceMessageById(messageId, () => targetMessage);
    }
  };

  const sendMessage = async (): Promise<void> => {
    const content = draft.value.trim();
    if ((!content && attachedFiles.value.length === 0) || isSending.value) return;

    if (!config.value.chatEnabled) {
      errorMessage.value = '请先启用 AI Chat。';
      isSettingsOpen.value = true;
      return;
    }
    if (!config.value.isConfigured) {
      errorMessage.value = 'AI Provider 还没配置完整，请先保存当前厂商配置和 API Key。';
      isSettingsOpen.value = true;
      return;
    }

    const messageContent = content || '请分析我添加的附件内容。';
    const references = await buildReferences(messageContent);
    currentReferences.value = references;

    if (activeMode.value === 'agent') {
      queueAgentExecutionConfirmation(messageContent, references);
      return;
    }

    const userMessage: IAiChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: messageContent,
      createdAt: new Date().toISOString(),
      references,
    };
    const nextMessages = [...messages.value, userMessage];
    messages.value = nextMessages;
    draft.value = '';
    errorMessage.value = '';

    try {
      await executeAiRequest(nextMessages, nextMessages, messageContent, references);
    } catch (error) {
      errorMessage.value = toErrorMessage(error, MSG_CALL_FAILED);
      draft.value = messageContent;
    }
  };

  // -----------------------------------------------------------------------
  // Conversation / patch
  // -----------------------------------------------------------------------

  const resetConversationUiState = (): void => {
    draft.value = '';
    currentReferences.value = [];
    proposedPatch.value = null;
    agentSteps.value = [];
    attachedFiles.value = [];
    errorMessage.value = '';
    activeAssistantMessage.value = null;
    activeAssistantBaseMessages.value = [];
    isClearDialogOpen.value = false;
  };

  const clearConversation = (): void => {
    conversationStore.clearActiveThread();
    resetConversationUiState();
  };

  const startNewConversation = (): void => {
    conversationStore.startNewThread();
    resetConversationUiState();
  };

  const switchConversation = (threadId: string): void => {
    conversationStore.switchThread(threadId);
    resetConversationUiState();
  };

  const previewPatchFromLastAnswer = async (): Promise<void> => {
    const document = options.document.value;
    const updatedContent = latestAssistantCodeBlock.value;
    if (!document.path || document.kind !== 'text' || !updatedContent.trim()) {
      errorMessage.value = '没有可预览的代码块，或当前文件尚未保存。';
      return;
    }

    const payload = await aiService.proposePatch({
      path: document.path,
      originalContent: document.content,
      updatedContent,
      summary: '应用 AI 回复中的代码块',
    });
    proposedPatch.value = payload.patch;
    errorMessage.value = '';
  };

  const previewPatchFromCodeBlock = async (block: IAiCodeBlock): Promise<void> => {
    const document = options.document.value;
    if (!document.path || document.kind !== 'text') {
      errorMessage.value = '当前文件尚未保存，无法生成 Patch 预览。';
      return;
    }
    if (block.fence.meta.filePath && block.fence.meta.filePath !== document.path) {
      errorMessage.value = '代码块目标文件不是当前文件，暂不能直接生成 Patch 预览。';
      return;
    }
    if (!block.content.trim()) {
      errorMessage.value = '代码块内容为空，无法生成 Patch 预览。';
      return;
    }
    try {
      const payload = await aiService.proposePatch({
        path: document.path,
        originalContent: document.content,
        updatedContent: block.content,
        summary: '应用 AI 代码块',
      });
      proposedPatch.value = payload.patch;
      errorMessage.value = '';
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'Patch 预览失败');
    }
  };

  const applyProposedPatch = async (): Promise<void> => {
    if (!proposedPatch.value || isApplyingPatch.value) return;
    isApplyingPatch.value = true;
    try {
      const result = await aiService.applyPatch({
        patch: proposedPatch.value,
        metadata: {
          taskId: activeConversationId.value,
          turnId: messages.value.at(-1)?.id ?? activeConversationId.value,
          reason: proposedPatch.value.summary,
          toolCallId: null,
          confirmedByUser: true,
        },
      });
      await aiEditStore.loadTimeline().catch(() => undefined);
      messages.value = [
        ...messages.value,
        {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: `Patch 已应用：${result.appliedFiles.map((file) => file.path).join('、')}`,
          createdAt: new Date().toISOString(),
          references: [],
        },
      ];
      proposedPatch.value = null;
      errorMessage.value = '';
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'Patch 应用失败');
    } finally {
      isApplyingPatch.value = false;
    }
  };

  const stopCurrentRequest = (): void => {
    const streamId = activeStreamId.value;
    if (streamId) void aiService.cancel({ streamId });

    activeAbortController.value?.abort();
    activeAbortController.value = null;

    // 关键：先清掉 streamId，让 pipeline 内的 `event.streamId !== activeStreamId.value`
    // 把后续的 late delta 全部丢弃。
    activeStreamId.value = null;

    activeStreamResolve.value?.();
    activeStreamResolve.value = null;

    aiStream.stop();

    if (activeAssistantMessage.value) {
      activeAssistantMessage.value.stream = {
        stableContent: aiStream.stableContent.value,
        openBlock: aiStream.openCodeBlock.value,
        status: 'cancelled',
      };
      activeAssistantMessage.value.content = aiStream.content.value;
      messages.value = [
        ...activeAssistantBaseMessages.value,
        { ...activeAssistantMessage.value },
      ];
    }

    isSending.value = false;
    errorMessage.value = MSG_STREAM_CANCELLED;
  };

  // -----------------------------------------------------------------------
  // Public surface
  // -----------------------------------------------------------------------

  return {
    config,
    messages,
    historyThreads,
    activeConversationId,
    draft,
    isSending,
    errorMessage,
    isSettingsOpen,
    isClearDialogOpen,
    currentReferences,
    proposedPatch,
    isApplyingPatch,
    activeMode,
    agentSteps,
    toolDefinitions,
    attachedFiles,
    providerLabel,
    sendButtonLabel,
    canPreviewPatch,
    loadConfig,
    loadTools,
    saveConfig,
    saveCredentials,
    testProviderConfig,
    connectProvider,
    testProvider,
    applyQuickAction,
    attachFile,
    removeAttachedFile,
    sendMessage,
    handleMessageAction,
    stopCurrentRequest,
    previewPatchFromLastAnswer,
    previewPatchFromCodeBlock,
    applyProposedPatch,
    clearConversation,
    startNewConversation,
    switchConversation,
  };
};
