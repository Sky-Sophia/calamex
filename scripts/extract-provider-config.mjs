import { readFileSync, writeFileSync } from 'node:fs';

const MAIN = 'src/composables/ai/useAiAssistant.ts';
const NEW = 'src/composables/ai/useAiAssistant.provider-config.ts';

function fail(msg) {
    console.error('[FAIL] ' + msg + '（未写入任何文件）');
    process.exit(1);
}

// —— 新文件内容（每行用双引号，反引号/${}/单引号在双引号里都是字面量）——
const newFileLines = [
    "import { computed, ref, type Ref } from 'vue';",
    "import { DEFAULT_LITELLM_MODEL_ID, findAiServicePlatformByModel } from '@/constants/ai/providers';",
    "import { aiService } from '@/services/ipc/ai.service';",
    "import { createDefaultAiConfigPayload } from '@/services/ipc/ai-config.service';",
    "import type { IAiConfigPayload, IAiProviderConnectionRequest, TAiModelRole } from '@/types/ai';",
    "",
    "export interface IUseAiProviderConfigDeps {",
    "  workspaceRootPath: Ref<string | null>;",
    "  errorMessage: Ref<string>;",
    "}",
    "",
    "export const useAiProviderConfig = ({",
    "  workspaceRootPath,",
    "  errorMessage,",
    "}: IUseAiProviderConfigDeps) => {",
    "  const config = ref<IAiConfigPayload>(createDefaultAiConfigPayload());",
    "",
    "  const providerLabel = computed(() =>",
    "    config.value.chatEnabled",
    "      ? `${config.value.providerType} · ${config.value.selectedModel ?? DEFAULT_LITELLM_MODEL_ID}`",
    "      : '未启用 Chat',",
    "  );",
    "",
    "  const loadConfig = async (): Promise<void> => {",
    "    config.value = await aiService.getConfig();",
    "  };",
    "",
    "  const saveConfig = async (",
    "    nextConfig: IAiConfigPayload,",
    "    role: TAiModelRole = 'main',",
    "  ): Promise<void> => {",
    "    config.value = await aiService.saveConfig({",
    "      role,",
    "      providerType:",
    "        role === 'narrator' ? nextConfig.narrator.providerType : nextConfig.providerType,",
    "      selectedModel:",
    "        role === 'narrator' ? nextConfig.narrator.selectedModel : nextConfig.selectedModel,",
    "      baseUrl: role === 'narrator' ? nextConfig.narrator.baseUrl : nextConfig.baseUrl,",
    "      inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,",
    "      chatEnabled: nextConfig.chatEnabled,",
    "      agentEnabled: nextConfig.agentEnabled,",
    "    });",
    "  };",
    "",
    "  const saveCredentials = async (",
    "    apiKey: string,",
    "    providerId: string,",
    "    alias?: string,",
    "  ): Promise<void> => {",
    "    config.value = await aiService.saveCredentials({",
    "      providerId,",
    "      alias,",
    "      apiKey,",
    "    });",
    "  };",
    "",
    "  const getProviderIdForRoleConfig = (nextConfig: IAiConfigPayload, role: TAiModelRole): string => {",
    "    const selectedModel =",
    "      role === 'narrator' ? nextConfig.narrator.selectedModel : nextConfig.selectedModel;",
    "",
    "    return findAiServicePlatformByModel(selectedModel).id;",
    "  };",
    "",
    "  const createProviderConnectionRequest = (",
    "    nextConfig: IAiConfigPayload,",
    "    apiKey: string,",
    "    role: TAiModelRole = 'main',",
    "  ): IAiProviderConnectionRequest => ({",
    "    role,",
    "    providerId: getProviderIdForRoleConfig(nextConfig, role),",
    "    providerType: role === 'narrator' ? nextConfig.narrator.providerType : nextConfig.providerType,",
    "    selectedModel:",
    "      role === 'narrator' ? nextConfig.narrator.selectedModel : nextConfig.selectedModel,",
    "    baseUrl: role === 'narrator' ? nextConfig.narrator.baseUrl : nextConfig.baseUrl,",
    "    inlineCompletionEnabled: nextConfig.inlineCompletionEnabled,",
    "    chatEnabled: nextConfig.chatEnabled,",
    "    agentEnabled: nextConfig.agentEnabled,",
    "    apiKey: apiKey.trim() || null,",
    "  });",
    "",
    "  const testProviderConfig = async (",
    "    nextConfig: IAiConfigPayload,",
    "    apiKey: string,",
    "    role: TAiModelRole = 'main',",
    "  ): Promise<string> => {",
    "    const result = await aiService.testProviderConfig(",
    "      createProviderConnectionRequest(nextConfig, apiKey, role),",
    "    );",
    "",
    "    if (!result.ok) {",
    "      errorMessage.value = result.message;",
    "      throw new Error(result.message);",
    "    }",
    "",
    "    return result.message;",
    "  };",
    "",
    "  const connectProvider = async (",
    "    nextConfig: IAiConfigPayload,",
    "    apiKey: string,",
    "    role: TAiModelRole = 'main',",
    "  ): Promise<string> => {",
    "    const result = await aiService.connectProvider(",
    "      createProviderConnectionRequest(nextConfig, apiKey, role),",
    "    );",
    "",
    "    config.value = result.config;",
    "",
    "    return result.test.message;",
    "  };",
    "",
    "  const resolveWorkspaceRootPath = (): string => {",
    "    const workspaceRootPathValue = workspaceRootPath.value?.trim();",
    "",
    "    if (!workspaceRootPathValue) {",
    "      throw new Error('当前工作区路径不可用。');",
    "    }",
    "",
    "    return workspaceRootPathValue;",
    "  };",
    "",
    "  const loadTavilyApiKey = async (): Promise<string> =>",
    "    aiService.loadTavilyApiKey(resolveWorkspaceRootPath());",
    "",
    "  const saveTavilyApiKey = async (apiKey: string): Promise<string> => {",
    "    await aiService.saveTavilyApiKey(resolveWorkspaceRootPath(), apiKey);",
    "    const health = await aiService.sidecarRestart();",
    "",
    "    return apiKey.trim()",
    "      ? `Tavily API Key 已保存，Agent sidecar 已重启（${health.status}）`",
    "      : `Tavily API Key 已清除，Agent sidecar 已重启（${health.status}）`;",
    "  };",
    "",
    "  const testProvider = async (): Promise<string> => {",
    "    const result = await aiService.testProvider();",
    "",
    "    if (!result.ok) {",
    "      errorMessage.value = result.message;",
    "      throw new Error(result.message);",
    "    }",
    "",
    "    return result.message;",
    "  };",
    "",
    "  return {",
    "    config,",
    "    providerLabel,",
    "    loadConfig,",
    "    saveConfig,",
    "    saveCredentials,",
    "    loadTavilyApiKey,",
    "    saveTavilyApiKey,",
    "    testProviderConfig,",
    "    connectProvider,",
    "    testProvider,",
    "  };",
    "};",
];

let mainSrc = readFileSync(MAIN, 'utf8');
const EOL = mainSrc.includes('\r\n') ? '\r\n' : '\n';

function tryReplace(src, oldLines, newLines, tag) {
    for (const eol of ['\r\n', '\n']) {
        const o = oldLines.join(eol);
        if (src.includes(o)) return src.replace(o, newLines.join(eol));
    }
    fail(tag + ' 锚点未命中');
}
function mustRemove(src, line, tag) {
    for (const t of [line + '\r\n', line + '\n']) {
        if (src.includes(t)) return src.replace(t, '');
    }
    if (src.includes(line)) return src.replace(line, '');
    fail(tag + ' 待删除行未命中: ' + line.slice(0, 40));
}
function lineStart(src, idx) {
    if (idx <= 0) return 0;
    const nl = src.lastIndexOf('\n', idx - 1);
    return nl === -1 ? 0 : nl + 1;
}

let skipped = false;

if (mainSrc.includes("./useAiAssistant.provider-config")) {
    skipped = true;
} else {
    // A: 新增 import
    mainSrc = tryReplace(
        mainSrc,
        ["import { useAiConversationTitles } from './useAiAssistant.conversation-titles';"],
        [
            "import { useAiConversationTitles } from './useAiAssistant.conversation-titles';",
            "import { useAiProviderConfig } from './useAiAssistant.provider-config';",
        ],
        'A',
    );
    // B / C: 删两条不再使用的 import
    mainSrc = mustRemove(mainSrc, "import { DEFAULT_LITELLM_MODEL_ID, findAiServicePlatformByModel } from '@/constants/ai/providers';", 'B');
    mainSrc = mustRemove(mainSrc, "import { createDefaultAiConfigPayload } from '@/services/ipc/ai-config.service';", 'C');
    // D: 删 3 个不再使用的类型
    mainSrc = mustRemove(mainSrc, '  IAiConfigPayload,', 'D1');
    mainSrc = mustRemove(mainSrc, '  IAiProviderConnectionRequest,', 'D2');
    mainSrc = mustRemove(mainSrc, '  TAiModelRole,', 'D3');
    // E: config 创建块 → 解构 useAiProviderConfig
    mainSrc = tryReplace(
        mainSrc,
        [
            "  const config = ref<IAiConfigPayload>(createDefaultAiConfigPayload());",
            "  const draft = ref('');",
            "  const isSending = ref(false);",
            "  const errorMessage = ref('');",
        ],
        [
            "  const draft = ref('');",
            "  const isSending = ref(false);",
            "  const errorMessage = ref('');",
            "",
            "  const {",
            "    config,",
            "    providerLabel,",
            "    loadConfig,",
            "    saveConfig,",
            "    saveCredentials,",
            "    loadTavilyApiKey,",
            "    saveTavilyApiKey,",
            "    testProviderConfig,",
            "    connectProvider,",
            "    testProvider,",
            "  } = useAiProviderConfig({",
            "    workspaceRootPath: options.workspaceRootPath,",
            "    errorMessage,",
            "  });",
        ],
        'E',
    );
    // F: 删 providerLabel computed（保留 sendButtonLabel）
    mainSrc = tryReplace(
        mainSrc,
        [
            "  const providerLabel = computed(() =>",
            "    config.value.chatEnabled",
            "      ? `${config.value.providerType} · ${config.value.selectedModel ?? DEFAULT_LITELLM_MODEL_ID}`",
            "      : '未启用 Chat',",
            "  );",
            "",
            "  const sendButtonLabel = computed(() => (isSending.value ? '发送中…' : '发送'));",
        ],
        ["  const sendButtonLabel = computed(() => (isSending.value ? '发送中…' : '发送'));"],
        'F',
    );
    // G: 整段删除 Config / tools / credentials（按区段分隔线切片，EOL 无关）
    const cfgIdx = mainSrc.indexOf('  // Config / tools / credentials');
    if (cfgIdx < 0) fail('G: 未找到 Config 区段');
    const qaIdx = mainSrc.indexOf('  // Quick actions / attachments');
    if (qaIdx < 0) fail('G: 未找到 Quick actions 区段');
    const cfgHeadingStart = lineStart(mainSrc, cfgIdx);
    const cfgDividerStart = lineStart(mainSrc, cfgHeadingStart - 1);
    const qaHeadingStart = lineStart(mainSrc, qaIdx);
    const qaDividerStart = lineStart(mainSrc, qaHeadingStart - 1);
    if (!mainSrc.slice(cfgDividerStart, cfgHeadingStart).includes('// --')) fail('G: Config 分隔线校验失败');
    if (!mainSrc.slice(qaDividerStart, qaHeadingStart).includes('// --')) fail('G: QA 分隔线校验失败');
    if (cfgDividerStart >= qaDividerStart) fail('G: 区段边界异常');
    mainSrc = mainSrc.slice(0, cfgDividerStart) + mainSrc.slice(qaDividerStart);
}

// —— 全部成功后再落盘 ——
writeFileSync(NEW, newFileLines.join(EOL) + EOL, 'utf8');
console.log('[ok] 已写入 ' + NEW + '（' + (newFileLines.length + 1) + ' 行）');

if (skipped) {
    console.log('[skip] 主文件已接线 useAiProviderConfig，无需改动');
} else {
    writeFileSync(MAIN, mainSrc, 'utf8');
    console.log('[done] 主文件已接线，当前 ' + mainSrc.split('\n').length + ' 行');
}