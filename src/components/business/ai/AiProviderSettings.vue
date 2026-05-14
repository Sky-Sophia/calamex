<script setup lang="ts">
import AiProviderIcon from '@/components/business/ai/AiProviderIcon.vue';
import FieldError from '@/components/common/FieldError.vue';
import type { TAiServicePlatformId } from '@/constants/ai-providers';
import {
  AI_SERVICE_PLATFORM_PRESETS,
  DEFAULT_LITELLM_BASE_URL,
  findAiProviderPreset,
  findAiServicePlatformByModel,
  findAiServicePlatformPreset,
  isAiServicePlatformModel,
} from '@/constants/ai-providers';
import type {
  IAiConfigPayload,
  IAiModelEndpointConfigPayload,
  IAiProviderProfileDetailPayload,
  IAiProviderProfilePayload,
  IAiProviderSettingsActionFeedback,
  TAiModelRole,
} from '@/types/ai';
import {
  cloneAiConfigPayload,
  getAiModelEndpointConfig,
  patchAiModelEndpointConfig,
} from '@/utils/ai-config';
import { tryWriteClipboardText } from '@/utils/clipboard';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface IAiAdvancedDraft {
  timeoutSeconds: number;
  proxyUrl: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

interface IPlatformSelectOption {
  value: TAiServicePlatformId;
  label: string;
}

interface IModelSelectOption {
  value: string;
  label: string;
}

interface IAiRoleSummaryRow {
  role: TAiModelRole;
  label: string;
  description: string;
  platformId: TAiServicePlatformId;
  platformLabel: string;
  modelLabel: string;
  statusLabel: string;
  statusTone: 'ok' | 'warn' | 'over';
  credentialLabel: string;
  entryStatusLabel: string;
}

type TProviderSettingsField = 'apiKey' | 'baseUrl' | 'model';
type TSettingsView = 'list' | 'edit' | 'profiles' | 'detail';

const createDefaultAdvancedDraft = (): IAiAdvancedDraft => ({
  timeoutSeconds: 30,
  proxyUrl: '',
  temperature: 0.7,
  topP: 1,
  maxTokens: 1024,
});

const props = defineProps<{
  open: boolean;
  config: IAiConfigPayload;
  profiles: IAiProviderProfilePayload[];
  loadProfileDetail: (profileId: string) => Promise<IAiProviderProfileDetailPayload>;
}>();

const emit = defineEmits<{
  close: [];
  save: [
    config: IAiConfigPayload,
    apiKey: string,
    role: TAiModelRole,
    feedback: IAiProviderSettingsActionFeedback,
  ];
  saveCredentials: [
    apiKey: string,
    role: TAiModelRole,
    feedback: IAiProviderSettingsActionFeedback,
  ];
  testProvider: [
    config: IAiConfigPayload,
    apiKey: string,
    role: TAiModelRole,
    feedback: IAiProviderSettingsActionFeedback,
  ];
  saveTavilyKey: [apiKey: string, feedback: IAiProviderSettingsActionFeedback];
  switchProfile: [profileId: string, feedback: IAiProviderSettingsActionFeedback];
}>();

const nextConfig = defineModel<IAiConfigPayload>('draft', { required: true });
const apiKey = defineModel<string>('apiKey', { required: true });
const tavilyApiKey = defineModel<string>('tavilyApiKey', { default: '' });

const statusMessage = ref('');
const statusTone = ref<'success' | 'error' | 'info'>('info');
const fieldErrors = ref<Record<TProviderSettingsField, string>>({
  apiKey: '',
  baseUrl: '',
  model: '',
});
const isTesting = ref(false);
const isSaving = ref(false);
const isSavingTavily = ref(false);
const isPlatformOpen = ref(false);
const isModelOpen = ref(false);
const settingsView = ref<TSettingsView>('list');
const activeModelRole = ref<TAiModelRole>('main');
const apiKeyDrafts = ref<Record<TAiModelRole, string>>({
  main: '',
  narrator: '',
});
const streamEnabled = ref(true);
const advancedDraft = ref<IAiAdvancedDraft>(createDefaultAdvancedDraft());
const profileDetail = ref<IAiProviderProfileDetailPayload | null>(null);
const isProfileDetailLoading = ref(false);
const isApiKeyVisible = ref(false);
const activeProfileRole = ref<TAiModelRole>('main');
const activeServicePlatformId = ref<TAiServicePlatformId>(
  findAiServicePlatformByModel(nextConfig.value.selectedModel).id,
);

let statusTimer: number | null = null;

const platformOptions = computed<IPlatformSelectOption[]>(() =>
  AI_SERVICE_PLATFORM_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
  })),
);

const modelRoleOptions: Array<{
  value: TAiModelRole;
  label: string;
  description: string;
}> = [
    {
      value: 'main',
      label: '主力模型',
      description: '负责对话、Agent 执行、代码修改和验证。',
    },
    {
      value: 'narrator',
      label: '小模型',
      description: '只负责活动区旁白，不调用工具、不影响主力模型。',
    },
  ];
const profileRoleOptions = modelRoleOptions.map(({ value, label }) => ({ value, label }));

const getRoleOption = (role: TAiModelRole) =>
  modelRoleOptions.find((option) => option.value === role) ?? modelRoleOptions[0];

const getDraftConfigForRole = (role: TAiModelRole): IAiModelEndpointConfigPayload =>
  getAiModelEndpointConfig(nextConfig.value, role);

const getSavedConfigForRole = (role: TAiModelRole): IAiModelEndpointConfigPayload =>
  getAiModelEndpointConfig(props.config, role);

const getRoleApiKeyDraft = (role: TAiModelRole): string =>
  role === activeModelRole.value ? apiKey.value : apiKeyDrafts.value[role];

const maskApiKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '尚未填写';
  }

  const characters = Array.from(trimmed);
  if (characters.length <= 8) {
    return '••••••••';
  }

  return `${characters.slice(0, 3).join('')}••••••••${characters.slice(-4).join('')}`;
};

const isRoleDirty = (role: TAiModelRole): boolean => {
  const draft = getDraftConfigForRole(role);
  const saved = getSavedConfigForRole(role);
  return (
    draft.providerType !== saved.providerType ||
    (draft.selectedModel ?? '') !== (saved.selectedModel ?? '') ||
    (draft.baseUrl ?? '') !== (saved.baseUrl ?? '') ||
    Boolean(getRoleApiKeyDraft(role).trim())
  );
};

const roleSummaryRows = computed<IAiRoleSummaryRow[]>(() =>
  modelRoleOptions.map((option) => {
    const draftConfig = getDraftConfigForRole(option.value);
    const savedConfig = getSavedConfigForRole(option.value);
    const platform = findAiServicePlatformByModel(draftConfig.selectedModel);
    const modelLabel =
      platform.models.find((model) => model.id === draftConfig.selectedModel)?.label ??
      draftConfig.selectedModel?.trim() ??
      '未选择模型';
    const hasDraftKey = Boolean(getRoleApiKeyDraft(option.value).trim());

    let statusLabel = '未配置';
    let statusTone: IAiRoleSummaryRow['statusTone'] = 'warn';
    if (isRoleDirty(option.value) && (savedConfig.isConfigured || savedConfig.hasCredentials)) {
      statusLabel = '已覆盖';
      statusTone = 'over';
    } else if (savedConfig.isConfigured) {
      statusLabel = '已连接';
      statusTone = 'ok';
    } else if (savedConfig.hasCredentials || draftConfig.hasCredentials || hasDraftKey) {
      statusLabel = '已保存';
      statusTone = 'over';
    }

    return {
      role: option.value,
      label: option.label,
      description: option.description,
      platformId: platform.id,
      platformLabel: platform.label,
      modelLabel,
      statusLabel,
      statusTone,
      credentialLabel: hasDraftKey
        ? maskApiKey(getRoleApiKeyDraft(option.value))
        : savedConfig.hasCredentials
          ? '凭证已保存到本地'
          : '尚未填写',
      entryStatusLabel: hasDraftKey || savedConfig.hasCredentials ? '已填写' : '未填写',
    };
  }),
);

const activeRoleOption = computed(() => getRoleOption(activeModelRole.value));

const activeRoleConfig = computed<IAiModelEndpointConfigPayload>(() =>
  getAiModelEndpointConfig(nextConfig.value, activeModelRole.value),
);
const savedActiveRoleConfig = computed<IAiModelEndpointConfigPayload>(() =>
  getAiModelEndpointConfig(props.config, activeModelRole.value),
);
const activePreset = computed(() => findAiProviderPreset(activeRoleConfig.value.providerType));
const activeServicePlatform = computed(() =>
  findAiServicePlatformPreset(activeServicePlatformId.value),
);

const modelOptions = computed<IModelSelectOption[]>(() =>
  activeServicePlatform.value.models.map((model) => ({
    value: model.id,
    label: model.label,
  })),
);

const selectedPlatformLabel = computed(() => {
  const matched = platformOptions.value.find(
    (item) => item.value === activeServicePlatformId.value,
  );
  return matched?.label ?? '请选择';
});

const selectedModelLabel = computed(() => {
  const currentModel = activeRoleConfig.value.selectedModel?.trim();
  const matched = modelOptions.value.find((item) => item.value === currentModel);
  if (matched) {
    return matched.label;
  }
  return modelOptions.value[0]?.label ?? '选择模型';
});

const hasSavedCredentialsForProvider = computed(
  () =>
    savedActiveRoleConfig.value.providerType === activeRoleConfig.value.providerType &&
    savedActiveRoleConfig.value.hasCredentials,
);

const requiresApiKey = computed(() => !hasSavedCredentialsForProvider.value);

const canTestProvider = computed(() => !isTesting.value);
const canSaveProvider = computed(() => !isSaving.value);
const hasTavilyApiKey = computed(() => Boolean(tavilyApiKey.value.trim()));
const filteredProfiles = computed(() =>
  props.profiles
    .filter((profile) => profile.role === activeProfileRole.value)
    .sort((left, right) => {
      const leftTime = Date.parse(left.lastUsedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.lastUsedAt ?? right.updatedAt);
      return rightTime - leftTime;
    }),
);
const hasFilteredProfiles = computed(() => filteredProfiles.value.length > 0);
const activeProfileRoleLabel = computed(
  () =>
    profileRoleOptions.find((option) => option.value === activeProfileRole.value)?.label ??
    '主力模型',
);
const profileEmptyTitle = computed(() => `还没有${activeProfileRoleLabel.value}配置`);
const profileEmptyDescription = computed(
  () => `完成一次“开始连接”后，成功的${activeProfileRoleLabel.value}配置会自动出现在这里。`,
);
const settingsTitle = computed(() => {
  switch (settingsView.value) {
    case 'edit':
      return '编辑配置';
    case 'profiles':
      return 'AI 配置记录';
    case 'detail':
      return '配置详情';
    default:
      return 'API 连接配置';
  }
});
const settingsSubtitle = computed(() => {
  switch (settingsView.value) {
    case 'edit':
      return activeRoleOption.value.description;
    case 'profiles':
      return '快速切换已验证连接';
    case 'detail':
      return '只读查看，API Key 仅本地显示';
    default:
      return '为主力模型与小模型分别维护连接配置，凭证只在本地保存。';
  }
});

const ensureLiteLlmConnectionDefaults = (): void => {
  patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
    providerType: 'litellm',
  });
  if (!activeRoleConfig.value.baseUrl?.trim()) {
    patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
      baseUrl: DEFAULT_LITELLM_BASE_URL,
    });
  }
};

const syncDraftWithServicePlatform = (platformId: TAiServicePlatformId): void => {
  const platform = findAiServicePlatformPreset(platformId);
  activeServicePlatformId.value = platform.id;
  ensureLiteLlmConnectionDefaults();
  if (!isAiServicePlatformModel(platform.id, activeRoleConfig.value.selectedModel)) {
    patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
      selectedModel: platform.defaultModel,
    });
  }
};

const hideStatus = (): void => {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusMessage.value = '';
};

const clearFieldError = (field: TProviderSettingsField): void => {
  fieldErrors.value[field] = '';
};

const clearFieldErrors = (): void => {
  fieldErrors.value = {
    apiKey: '',
    baseUrl: '',
    model: '',
  };
};

const showStatus = (
  message: string,
  tone: 'success' | 'error' | 'info' = 'info',
  autoHide = true,
): void => {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusMessage.value = message;
  statusTone.value = tone;
  if (!autoHide) {
    return;
  }
  statusTimer = window.setTimeout(
    () => {
      statusMessage.value = '';
      statusTimer = null;
    },
    tone === 'success' ? 1800 : 2400,
  );
};

const closeDropdowns = (): void => {
  isPlatformOpen.value = false;
  isModelOpen.value = false;
};

const showProfileSwitcher = (options?: { resetRole?: boolean }): void => {
  closeDropdowns();
  if (options?.resetRole) {
    activeProfileRole.value = 'main';
  }
  settingsView.value = 'profiles';
  profileDetail.value = null;
  isApiKeyVisible.value = false;
};

const showConnectionList = (): void => {
  closeDropdowns();
  settingsView.value = 'list';
  profileDetail.value = null;
  isApiKeyVisible.value = false;
};

const openRoleEditor = (role: TAiModelRole): void => {
  updateModelRole(role);
  settingsView.value = 'edit';
};

const resetDraftFromSaved = (): void => {
  nextConfig.value = cloneAiConfigPayload(props.config);
  activeModelRole.value = 'main';
  apiKeyDrafts.value = {
    main: '',
    narrator: '',
  };
  apiKey.value = '';
  clearFieldErrors();
  hideStatus();
  settingsView.value = 'list';
  syncDraftWithServicePlatform(findAiServicePlatformByModel(nextConfig.value.selectedModel).id);
};

const updatePlatformFromSelect = (event: Event): void => {
  updatePlatform((event.target as HTMLSelectElement).value as TAiServicePlatformId);
};

const updateModelFromSelect = (event: Event): void => {
  updateModel((event.target as HTMLSelectElement).value);
};

const handleHeaderNavigation = (): void => {
  if (settingsView.value === 'list') {
    showProfileSwitcher({ resetRole: true });
    return;
  }

  if (settingsView.value === 'edit') {
    showConnectionList();
    return;
  }

  if (settingsView.value === 'detail') {
    showProfileSwitcher();
    return;
  }

  showConnectionList();
};

const showProfileDetail = async (profile: IAiProviderProfilePayload): Promise<void> => {
  closeDropdowns();
  settingsView.value = 'detail';
  profileDetail.value = null;
  isApiKeyVisible.value = false;
  isProfileDetailLoading.value = true;

  try {
    profileDetail.value = await props.loadProfileDetail(profile.id);
  } catch (error) {
    showStatus(
      error instanceof Error && error.message.trim() ? error.message : '配置详情读取失败',
      'error',
    );
    settingsView.value = 'profiles';
  } finally {
    isProfileDetailLoading.value = false;
  }
};

const resetEphemeralState = (): void => {
  hideStatus();
  clearFieldErrors();
  closeDropdowns();
  isTesting.value = false;
  isSaving.value = false;
  isSavingTavily.value = false;
  streamEnabled.value = true;
  apiKeyDrafts.value = {
    main: activeModelRole.value === 'main' ? apiKey.value : '',
    narrator: activeModelRole.value === 'narrator' ? apiKey.value : '',
  };
  advancedDraft.value = createDefaultAdvancedDraft();
};

const onDocumentClick = (): void => {
  closeDropdowns();
};

const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    closeDropdowns();
  }
};

const copyKey = async (): Promise<void> => {
  const value = apiKey.value.trim();
  if (!value) {
    showStatus('暂无可复制内容', 'error');
    return;
  }
  const copied = await tryWriteClipboardText(value);
  showStatus(copied ? '已复制到剪贴板' : '当前环境不支持剪贴板写入', copied ? 'success' : 'error');
};

const toggleStream = (): void => {
  streamEnabled.value = !streamEnabled.value;
};

const updatePlatform = (platformId: TAiServicePlatformId): void => {
  if (activeServicePlatformId.value === platformId) {
    closeDropdowns();
    return;
  }
  syncDraftWithServicePlatform(platformId);
  closeDropdowns();
};

const updateModelRole = (role: TAiModelRole): void => {
  if (activeModelRole.value === role) {
    return;
  }

  closeDropdowns();
  apiKeyDrafts.value[activeModelRole.value] = apiKey.value;
  activeModelRole.value = role;
  apiKey.value = apiKeyDrafts.value[role];
  const platform = findAiServicePlatformByModel(activeRoleConfig.value.selectedModel);
  syncDraftWithServicePlatform(platform.id);
  hideStatus();
  clearFieldErrors();
};

const updateModel = (model: string): void => {
  patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
    selectedModel: model,
  });
  clearFieldError('model');
  closeDropdowns();
};

const updateBaseUrl = (event: Event): void => {
  const target = event.target as HTMLInputElement;
  clearFieldError('baseUrl');
  patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
    baseUrl: target.value,
  });
};

const createSwitchFeedback = (
  profile: IAiProviderProfilePayload,
): IAiProviderSettingsActionFeedback => ({
  onSuccess(message) {
    isSaving.value = false;
    showStatus(message ?? `已切换到 ${profile.name}`, 'success');
  },
  onError(message) {
    isSaving.value = false;
    showStatus(message, 'error');
  },
});

const switchProfile = (profile: IAiProviderProfilePayload): void => {
  if (profile.isConnected || isSaving.value) {
    return;
  }

  if (!profile.hasCredentials) {
    showStatus('该配置缺少 API Key，请重新连接保存', 'error');
    return;
  }

  isSaving.value = true;
  showStatus(`正在切换到 ${profile.name}…`, 'info', false);
  emit('switchProfile', profile.id, createSwitchFeedback(profile));
};

const createActionFeedback = (
  action: 'test' | 'save',
  successMessage: string,
): IAiProviderSettingsActionFeedback => ({
  onSuccess(message) {
    if (action === 'test') {
      isTesting.value = false;
    } else {
      isSaving.value = false;
    }
    showStatus(message ?? successMessage, 'success');
    if (action === 'save') {
      apiKeyDrafts.value[activeModelRole.value] = '';
      apiKey.value = '';
      window.setTimeout(() => {
        emit('close');
      }, 1200);
    }
  },
  onError(message) {
    if (action === 'test') {
      isTesting.value = false;
    } else {
      isSaving.value = false;
    }
    showStatus(message, 'error');
  },
});

const createTavilyActionFeedback = (): IAiProviderSettingsActionFeedback => ({
  onSuccess(message) {
    isSavingTavily.value = false;
    showStatus(
      message ?? (hasTavilyApiKey.value ? 'Tavily API Key 已保存' : 'Tavily API Key 已清除'),
      'success',
    );
  },
  onError(message) {
    isSavingTavily.value = false;
    showStatus(message, 'error');
  },
});

const saveTavilyKey = (): void => {
  if (isSavingTavily.value) {
    return;
  }

  isSavingTavily.value = true;
  showStatus('正在写入 Tavily 配置…', 'info', false);
  emit('saveTavilyKey', tavilyApiKey.value.trim(), createTavilyActionFeedback());
};

const validateForm = (): boolean => {
  clearFieldErrors();
  let isValid = true;

  if (requiresApiKey.value && !apiKey.value.trim()) {
    fieldErrors.value.apiKey = '请输入 API Key。';
    isValid = false;
  }
  if (!activeRoleConfig.value.baseUrl?.trim()) {
    fieldErrors.value.baseUrl = '请填写 Base URL。';
    isValid = false;
  }
  if (!activeRoleConfig.value.selectedModel?.trim()) {
    fieldErrors.value.model = '请选择模型。';
    isValid = false;
  }
  return isValid;
};

const testConnection = (): void => {
  hideStatus();
  if (!validateForm()) {
    return;
  }
  isTesting.value = true;
  showStatus('正在测试连接…', 'info', false);
  emit(
    'testProvider',
    nextConfig.value,
    apiKey.value.trim(),
    activeModelRole.value,
    createActionFeedback('test', `连接成功 · 模型：${selectedModelLabel.value}`),
  );
};

const saveConfig = (): void => {
  hideStatus();
  if (!validateForm()) {
    return;
  }
  isSaving.value = true;
  showStatus('正在连接…', 'info', false);
  emit(
    'save',
    nextConfig.value,
    apiKey.value.trim(),
    activeModelRole.value,
    createActionFeedback('save', '连接成功'),
  );
};

const getProfilePlatformLabel = (profile: IAiProviderProfilePayload): string =>
  findAiServicePlatformByModel(profile.selectedModel).label;

const getProfilePlatformId = (profile: IAiProviderProfilePayload): TAiServicePlatformId =>
  findAiServicePlatformByModel(profile.selectedModel).id;

const getProfileModelLabel = (profile: IAiProviderProfilePayload): string => {
  const model = profile.selectedModel?.trim();

  if (!model) {
    return '未选择模型';
  }

  const platform = findAiServicePlatformByModel(model);
  return platform.models.find((item) => item.id === model)?.label ?? model;
};

const getProfileEndpointLabel = (profile: IAiProviderProfilePayload): string =>
  profile.baseUrl?.trim() || DEFAULT_LITELLM_BASE_URL;

const getProfileRoleLabel = (profile: IAiProviderProfilePayload): string =>
  profile.role === 'narrator' ? '小模型' : '主力模型';

const getProfileRoleToneClass = (profile: IAiProviderProfilePayload): string =>
  profile.role === 'narrator' ? 'is-narrator' : 'is-main';

const getProfileConnectionLabel = (profile: IAiProviderProfilePayload): string => {
  if (profile.isConnected) {
    return '已连接';
  }
  if (!profile.hasCredentials) {
    return '缺少 API Key';
  }
  return '未连接';
};

const getProfileConnectionToneClass = (profile: IAiProviderProfilePayload): string => {
  if (profile.isConnected) {
    return 'is-connected';
  }
  if (!profile.hasCredentials) {
    return 'is-missing';
  }
  return 'is-disconnected';
};

const getProfileTimeLabel = (profile: IAiProviderProfilePayload): string => {
  const timestamp = Date.parse(profile.lastUsedAt ?? profile.updatedAt);

  if (!Number.isFinite(timestamp)) {
    return '时间未知';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
};

const getProfileFeatureLabel = (profile: IAiProviderProfilePayload): string => {
  const features = [
    profile.chatEnabled ? 'Chat' : null,
    profile.agentEnabled ? 'Agent' : null,
    profile.inlineCompletionEnabled ? 'Inline' : null,
  ].filter((item): item is string => Boolean(item));

  return features.length ? features.join(' / ') : '未启用';
};

const detailProfile = computed(() => profileDetail.value?.profile ?? null);
const detailApiKey = computed(() => profileDetail.value?.apiKey ?? '');
const maskedDetailApiKey = computed(() => {
  const value = detailApiKey.value;

  if (!value) {
    return '未保存';
  }

  if (isApiKeyVisible.value) {
    return value;
  }

  const characters = Array.from(value);
  if (characters.length <= 8) {
    return '••••••••';
  }

  return `${characters.slice(0, 4).join('')}••••••••${characters.slice(-4).join('')}`;
});

watch(
  () => activeRoleConfig.value.providerType,
  () => {
    ensureLiteLlmConnectionDefaults();
  },
  { immediate: true },
);

watch(
  () => activeRoleConfig.value.selectedModel,
  (selectedModel) => {
    const platform = findAiServicePlatformByModel(selectedModel);
    activeServicePlatformId.value = platform.id;
    if (!isAiServicePlatformModel(platform.id, selectedModel)) {
      patchAiModelEndpointConfig(nextConfig.value, activeModelRole.value, {
        selectedModel: platform.defaultModel,
      });
    }
  },
  { immediate: true },
);

watch(
  () => activeModelRole.value,
  () => {
    const platform = findAiServicePlatformByModel(activeRoleConfig.value.selectedModel);
    activeServicePlatformId.value = platform.id;
  },
);

watch(
  () => apiKey.value,
  (value) => {
    apiKeyDrafts.value[activeModelRole.value] = value;
  },
);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      hideStatus();
      closeDropdowns();
      return;
    }
    activeModelRole.value = 'main';
    resetEphemeralState();
    activeProfileRole.value = 'main';
    settingsView.value = 'list';
    profileDetail.value = null;
    isApiKeyVisible.value = false;
    syncDraftWithServicePlatform(
      findAiServicePlatformByModel(activeRoleConfig.value.selectedModel).id,
    );
  },
  { immediate: true },
);

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
  hideStatus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-shell" @click.self="emit('close')">
      <div class="modal">
        <template v-if="settingsView === 'edit'">
          <div class="edit-view-header">
            <button type="button" class="profile-icon-action" title="返回" aria-label="返回" @click="showConnectionList">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <path d="M15 18 9 12l6-6" />
              </svg>
            </button>
            <div class="edit-view-title-group">
              <h2>编辑配置 <span>· {{ activeRoleOption.label }}</span></h2>
              <p>{{ activeRoleOption.description }}</p>
            </div>
          </div>

          <div class="modal-body edit-view-body">
            <div class="cfg-row">
              <span class="cfg-name">PROVIDER</span>
              <span class="cfg-tag">必填</span>
              <span class="cfg-spacer"></span>
              <select class="cfg-select" data-field="platform" :value="activeServicePlatformId"
                @change="updatePlatformFromSelect">
                <option v-for="option in platformOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="cfg-row cfg-row--stacked">
              <div class="cfg-row-main">
                <span class="cfg-name">MODEL</span>
                <span class="cfg-tag">必填</span>
                <span class="cfg-spacer"></span>
                <select class="cfg-select" data-field="model" :value="activeRoleConfig.selectedModel ?? ''"
                  :aria-invalid="Boolean(fieldErrors.model)" @change="updateModelFromSelect">
                  <option v-for="option in modelOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </div>
              <FieldError v-if="fieldErrors.model" :message="fieldErrors.model" />
            </div>

            <div class="cfg-row cfg-row--stacked">
              <div class="cfg-row-main">
                <span class="cfg-name">API_KEY</span>
                <span class="cfg-tag">必填</span>
                <span class="cfg-spacer"></span>
                <div class="cfg-secret-field">
                  <input v-model="apiKey" type="password" class="cfg-input" :aria-invalid="Boolean(fieldErrors.apiKey)"
                    :placeholder="activePreset.apiKeyHint || 'sk-xxxx'" @input="clearFieldError('apiKey')" />
                  <button type="button" class="key-btn" aria-label="复制" @click="copyKey">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>
              <FieldError v-if="fieldErrors.apiKey" :message="fieldErrors.apiKey" />
              <span class="cfg-help">仅本地存储，不上传。</span>
            </div>

            <div class="cfg-row cfg-row--stacked">
              <div class="cfg-row-main">
                <span class="cfg-name">BASE_URL</span>
                <span class="cfg-spacer"></span>
                <input :value="activeRoleConfig.baseUrl ?? ''" class="cfg-input"
                  :readonly="!activePreset.isEndpointEditable" :aria-invalid="Boolean(fieldErrors.baseUrl)"
                  :placeholder="activePreset.baseUrl ?? ''" @input="updateBaseUrl" />
              </div>
              <FieldError v-if="fieldErrors.baseUrl" :message="fieldErrors.baseUrl" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">TIMEOUT_S</span>
              <span class="cfg-spacer"></span>
              <input v-model.number="advancedDraft.timeoutSeconds" type="number" class="cfg-input cfg-input--short"
                min="5" max="120" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">PROXY_URL</span>
              <span class="cfg-spacer"></span>
              <input v-model="advancedDraft.proxyUrl" class="cfg-input" placeholder="http://127.0.0.1:7890" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">TEMPERATURE</span>
              <span class="cfg-spacer"></span>
              <input v-model.number="advancedDraft.temperature" type="number" class="cfg-input cfg-input--short" min="0"
                max="2" step="0.1" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">TOP_P</span>
              <span class="cfg-spacer"></span>
              <input v-model.number="advancedDraft.topP" type="number" class="cfg-input cfg-input--short" min="0"
                max="1" step="0.1" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">MAX_TOKENS</span>
              <span class="cfg-spacer"></span>
              <input v-model.number="advancedDraft.maxTokens" type="number" class="cfg-input cfg-input--short" min="256"
                max="128000" />
            </div>

            <div class="cfg-row">
              <span class="cfg-name">STREAM</span>
              <span class="cfg-spacer"></span>
              <button type="button" class="cfg-switch" :class="{ 'is-active': streamEnabled }"
                :aria-pressed="streamEnabled" @click="toggleStream">
                <span class="cfg-switch__thumb"></span>
              </button>
              <span class="cfg-switch-label">{{ streamEnabled ? '已开启' : '已关闭' }}</span>
            </div>
          </div>

          <div class="edit-view-footer">
            <button type="button" class="btn btn-ghost" @click="showConnectionList">取消</button>
            <button type="button" class="btn btn-test" :disabled="!canTestProvider" @click="testConnection">
              {{ isTesting ? '正在测试' : '测试连接' }}
            </button>
            <button type="button" class="btn btn-save" :disabled="!canSaveProvider" @click="saveConfig">
              {{ isSaving ? '正在连接' : '开始连接' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="modal-header" :class="{ 'is-summary': settingsView === 'list' }">
            <div class="modal-title-group">
              <h2>{{ settingsTitle }}</h2>
              <span>{{ settingsSubtitle }}</span>
            </div>
            <div class="modal-header-actions">
              <button v-if="settingsView === 'list'" type="button" class="profile-icon-action" title="恢复当前配置"
                aria-label="恢复当前配置" @click="resetDraftFromSaved">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
              <button type="button" class="profile-icon-action" :title="settingsView === 'list' ? '进入配置记录' : '返回'"
                :aria-label="settingsView === 'list' ? '进入配置记录' : '返回'" @click="handleHeaderNavigation">
                <svg v-if="settingsView === 'list'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="4" rx="1.5" />
                  <rect x="4" y="11" width="16" height="4" rx="1.5" />
                  <rect x="4" y="17" width="16" height="2" rx="1" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            </div>
          </div>

          <div v-if="settingsView === 'list'" class="modal-body settings-list-body">
            <section class="summary-list" aria-label="AI 配置摘要列表">
              <article v-for="row in roleSummaryRows" :key="row.role" class="summary-row"
                :class="{ 'is-selected': row.role === activeModelRole }" :data-role-row="row.role"
                @click="updateModelRole(row.role)">
                <div class="summary-row-main">
                  <div class="summary-row-top">
                    <span class="summary-row-title">{{ row.label }}</span>
                    <span class="summary-badge" :class="`is-${row.statusTone}`">
                      <span class="summary-badge__dot"></span>
                      {{ row.statusLabel }}
                    </span>
                  </div>
                  <p class="summary-row-desc">{{ row.description }}</p>
                  <div class="summary-row-meta">
                    <AiProviderIcon class="summary-provider-icon" :platform-id="row.platformId"
                      :title="row.platformLabel" decorative />
                    <span>{{ row.platformLabel }}</span>
                    <span class="summary-sep">·</span>
                    <span class="summary-mono">{{ row.modelLabel }}</span>
                  </div>
                  <div class="summary-row-keyline">
                    <span class="summary-token-label">API Key</span>
                    <span class="summary-token-value" :class="{ 'is-empty': row.credentialLabel === '尚未填写' }">
                      {{ row.credentialLabel }}
                    </span>
                    <span class="summary-spacer"></span>
                    <button type="button" class="summary-edit-button" :data-open-edit="row.role"
                      @click.stop="openRoleEditor(row.role)">
                      <svg class="summary-edit-button__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                      </svg>
                      编辑配置
                      <span class="summary-edit-button__status">{{ row.entryStatusLabel }}</span>
                      <svg class="summary-edit-button__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </article>

              <article class="summary-row summary-row--static" data-role-row="tavily">
                <div class="summary-row-main">
                  <div class="summary-row-top">
                    <span class="summary-row-title">Tavily 搜索</span>
                    <span class="summary-badge" :class="hasTavilyApiKey ? 'is-ok' : 'is-warn'">
                      <span class="summary-badge__dot"></span>
                      {{ hasTavilyApiKey ? '已配置' : '未配置' }}
                    </span>
                  </div>
                  <p class="summary-row-desc">联网检索增强（可选）。保存后写入 agent-sidecar/.env，并自动重启 Agent sidecar。</p>
                  <div class="summary-row-meta">
                    <span class="summary-provider-icon summary-provider-icon--generic" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 19a8 8 0 1 1 5.3-14" />
                        <path d="m20 4-4 4" />
                        <path d="M15 4h5v5" />
                      </svg>
                    </span>
                    <span>Tavily MCP</span>
                    <span class="summary-sep">·</span>
                    <span class="summary-mono">TAVILY_API_KEY</span>
                  </div>
                  <div class="summary-row-keyline summary-row-keyline--tavily">
                    <span class="summary-token-label">TAVILY_API_KEY</span>
                    <input v-model="tavilyApiKey" data-tavily-input type="password" class="summary-key-input"
                      placeholder="输入 Tavily API Key" autocomplete="off" />
                    <button type="button" class="btn btn-test summary-save-button" data-save-tavily
                      :disabled="isSavingTavily" @click.stop="saveTavilyKey">
                      {{ isSavingTavily ? '保存中' : '保存' }}
                    </button>
                  </div>
                </div>
              </article>
            </section>
          </div>

          <div v-else-if="settingsView === 'profiles'" class="modal-body profile-switcher">
            <div class="profile-role-switch" aria-label="配置记录模型类型切换">
              <button v-for="option in profileRoleOptions" :key="option.value" type="button"
                class="profile-role-switch__button" :class="{ 'is-selected': option.value === activeProfileRole }"
                :aria-pressed="option.value === activeProfileRole" @click="activeProfileRole = option.value">
                {{ option.label }}
              </button>
            </div>

            <div v-if="hasFilteredProfiles" class="profile-list" aria-label="AI 配置记录列表">
              <article v-for="profile in filteredProfiles" :key="profile.id" class="profile-card"
                :class="{ 'is-active': profile.isConnected }">
                <span class="profile-drag" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                <AiProviderIcon class="profile-provider-icon" :platform-id="getProfilePlatformId(profile)"
                  :title="getProfilePlatformLabel(profile)" decorative />
                <div class="profile-main">
                  <div class="profile-title-row">
                    <strong>{{ profile.name }}</strong>
                    <span class="profile-role-badge" :class="getProfileRoleToneClass(profile)">
                      {{ getProfileRoleLabel(profile) }}
                    </span>
                    <span class="profile-connection-badge" :class="getProfileConnectionToneClass(profile)">
                      {{ getProfileConnectionLabel(profile) }}
                    </span>
                  </div>
                  <span class="profile-url">{{ getProfileEndpointLabel(profile) }}</span>
                  <dl class="profile-details">
                    <div>
                      <dt>平台</dt>
                      <dd>{{ getProfilePlatformLabel(profile) }}</dd>
                    </div>
                    <div>
                      <dt>模型</dt>
                      <dd>{{ getProfileModelLabel(profile) }}</dd>
                    </div>
                    <div>
                      <dt>凭证</dt>
                      <dd>{{ profile.hasCredentials ? '已保存' : '缺失' }}</dd>
                    </div>
                    <div>
                      <dt>最近使用</dt>
                      <dd>{{ getProfileTimeLabel(profile) }}</dd>
                    </div>
                  </dl>
                </div>
                <div class="profile-actions">
                  <button type="button" class="profile-action-button" title="查看配置" aria-label="查看配置"
                    @click="showProfileDetail(profile)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" aria-hidden="true">
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button type="button" class="profile-action-button" :disabled="profile.isConnected || isSaving"
                    :title="profile.isConnected ? '已连接' : '快速切换'" :aria-label="profile.isConnected ? '已连接' : '快速切换'"
                    @click="switchProfile(profile)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" aria-hidden="true">
                      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
                    </svg>
                  </button>
                </div>
              </article>
            </div>
            <div v-else class="profile-empty">
              <strong>{{ profileEmptyTitle }}</strong>
              <span>{{ profileEmptyDescription }}</span>
              <button type="button" class="btn btn-test" @click="showConnectionList">去连接</button>
            </div>
          </div>

          <div v-else class="modal-body profile-detail">
            <div v-if="isProfileDetailLoading" class="profile-empty">
              <strong>正在读取配置详情</strong>
              <span>API Key 只会在本地只读展示。</span>
            </div>
            <section v-else-if="detailProfile" class="profile-detail-card">
              <div class="profile-detail-head">
                <AiProviderIcon class="profile-detail-icon" :platform-id="getProfilePlatformId(detailProfile)"
                  :title="getProfilePlatformLabel(detailProfile)" decorative />
                <div>
                  <strong>{{ detailProfile.name }}</strong>
                  <span>{{ getProfilePlatformLabel(detailProfile) }} ·
                    {{ getProfileModelLabel(detailProfile) }}</span>
                </div>
              </div>

              <dl class="profile-readonly-list">
                <div>
                  <dt>用途</dt>
                  <dd>
                    <span class="profile-role-badge" :class="getProfileRoleToneClass(detailProfile)">
                      {{ getProfileRoleLabel(detailProfile) }}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>连接状态</dt>
                  <dd>
                    <span class="profile-connection-badge" :class="getProfileConnectionToneClass(detailProfile)">
                      {{ getProfileConnectionLabel(detailProfile) }}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>API Base URL</dt>
                  <dd>{{ getProfileEndpointLabel(detailProfile) }}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd>{{ getProfileModelLabel(detailProfile) }}</dd>
                </div>
                <div>
                  <dt>能力</dt>
                  <dd>{{ getProfileFeatureLabel(detailProfile) }}</dd>
                </div>
                <div>
                  <dt>最近使用</dt>
                  <dd>{{ getProfileTimeLabel(detailProfile) }}</dd>
                </div>
                <div class="is-secret">
                  <dt>API Key</dt>
                  <dd>
                    <code :class="{ 'is-visible': isApiKeyVisible }">{{ maskedDetailApiKey }}</code>
                    <button type="button" class="profile-action-button" :disabled="!detailApiKey"
                      :title="isApiKeyVisible ? '隐藏 API Key' : '查看 API Key'"
                      :aria-label="isApiKeyVisible ? '隐藏 API Key' : '查看 API Key'"
                      @click="isApiKeyVisible = !isApiKeyVisible">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                        stroke-linejoin="round" aria-hidden="true">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <div v-if="settingsView === 'list'" class="summary-footer">
            <div class="summary-footer__hint">
              当前仅保存本地凭证与模型连接配置，已验证配置可在记录中快速切换。
            </div>
            <button type="button" class="btn btn-test" @click="showProfileSwitcher({ resetRole: true })">
              查看记录
            </button>
            <button type="button" class="btn btn-save" @click="openRoleEditor(activeModelRole)">
              编辑当前
            </button>
          </div>
        </template>
      </div>

      <div v-if="statusMessage" class="status" :class="[`status-${statusTone}`, 'show']">
        <span class="status-icon">
          <svg v-if="statusTone === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <svg v-else-if="statusTone === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span v-else class="status-pulse" aria-hidden="true" />
        </span>
        <span class="status-text">{{ statusMessage }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-shell {
  --bg-app: #fafafa;
  --bg-elevated: #ffffff;
  --bg-overlay: #ffffff;
  --bg-input: #ffffff;
  --bg-input-hover: #fafafa;
  --bg-hover: #f5f5f5;
  --bg-active: #f0f0f0;
  --bg-mono: #f5f5f5;

  --border-subtle: #ededed;
  --border: #e7e7e7;
  --border-strong: #d4d4d4;

  --fg-primary: #0a0a0a;
  --fg-secondary: #525252;
  --fg-tertiary: #737373;
  --fg-muted: #a3a3a3;

  --accent: #0a0a0a;
  --accent-hover: #262626;
  --accent-soft: rgba(10, 10, 10, 0.06);
  --accent-ring: rgba(10, 10, 10, 0.08);
  --selection-soft: #f0f0f0;
  --selection-soft-hover: #f5f5f5;
  --selection-border: #d4d4d4;
  --selection-ring: rgba(10, 10, 10, 0.06);
  --selection-chip-bg: #f5f5f5;
  --selection-chip-border: #e5e5e5;

  --success: #16a34a;
  --danger: #dc2626;
  --warn: #d97706;
  --info: #2563eb;

  --r-sm: 5px;
  --r-md: 6px;
  --r-lg: 12px;

  --shadow-modal: 0 0 0 1px rgba(10, 10, 10, 0.04), 0 18px 48px rgba(10, 10, 10, 0.08);

  --ease: cubic-bezier(0.4, 0, 0.2, 1);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.modal-shell {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  z-index: 9999;
  pointer-events: auto;
  animation: fadeIn 0.14s var(--ease);
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.modal {
  background: var(--bg-elevated);
  width: clamp(560px, 62vw, 720px);
  max-width: calc(100vw - 48px);
  min-height: min(620px, calc(100vh - 48px));
  max-height: calc(100vh - 48px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
  pointer-events: auto;
  animation: pop 0.16s var(--ease);
  color: var(--fg-primary);
  display: flex;
  flex-direction: column;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-header {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.modal-title-group {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.modal-header h2 {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg-primary);
  letter-spacing: -0.01em;
}

.modal-title-group span {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 14px;
}

.profile-icon-action {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  background: transparent;
  background-color: transparent;
  box-shadow: none;
  outline: none;
  color: var(--fg-tertiary);
  transition:
    color 0.12s var(--ease),
    transform 0.12s var(--ease),
    opacity 0.12s var(--ease);
}

.profile-icon-action:hover,
.profile-icon-action:focus-visible,
.profile-icon-action:active {
  background: var(--bg-hover);
  background-color: var(--bg-hover);
  box-shadow: none;
  border-color: var(--border-subtle);
  color: var(--fg-primary);
}

.profile-icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.profile-icon-action:active {
  transform: scale(0.97);
}

.profile-icon-action svg {
  width: 15px;
  height: 15px;
}

.modal-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
}

.modal-body::-webkit-scrollbar {
  width: 8px;
}

.modal-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.modal-body::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

.form-item {
  margin-bottom: 14px;
}

.form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-secondary);
  letter-spacing: -0.005em;
}

.form-input,
.form-select {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  font-size: 13px;
  color: var(--fg-primary);
  font-family: inherit;
  transition:
    border-color 0.12s var(--ease),
    background 0.12s var(--ease),
    box-shadow 0.12s var(--ease);
}

.form-input:hover,
.form-select:hover {
  background: var(--bg-input-hover);
  border-color: var(--border);
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-input-hover);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.form-input[aria-invalid='true'],
.lr-select-trigger[aria-invalid='true'] {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent);
}

.form-input::placeholder {
  color: var(--fg-muted);
}

input[type='number']::-webkit-outer-spin-button,
input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.form-row {
  display: flex;
  gap: 10px;
}

.form-row .form-item {
  flex: 1;
  margin-bottom: 14px;
}

.model-role-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.model-role-card {
  min-height: 66px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  background: var(--bg-input);
  color: var(--fg-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s var(--ease),
    background 0.12s var(--ease),
    color 0.12s var(--ease),
    transform 0.12s var(--ease);
}

.model-role-card:hover {
  border-color: var(--border);
  background: var(--bg-input-hover);
  color: var(--fg-primary);
}

.model-role-card:active {
  transform: scale(0.985);
}

.model-role-card.is-selected {
  border-color: var(--selection-border);
  background: var(--selection-soft);
  color: var(--fg-primary);
  box-shadow: 0 0 0 1px var(--selection-ring);
}

.model-role-card__label,
.model-role-card__description {
  display: block;
}

.model-role-card__label {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.model-role-card__description {
  margin-top: 4px;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 15px;
}

.lr-select {
  position: relative;
  width: 100%;
}

.lr-select-trigger {
  width: 100%;
  height: 32px;
  padding: 0 8px 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  font-size: 13px;
  font-family: inherit;
  color: var(--fg-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  letter-spacing: -0.005em;
  transition:
    border-color 0.12s var(--ease),
    background 0.12s var(--ease),
    box-shadow 0.12s var(--ease);
}

.lr-select-trigger:hover {
  background: var(--bg-input-hover);
  border-color: var(--border);
}

.lr-select.open .lr-select-trigger {
  border-color: var(--accent);
  background: var(--bg-input-hover);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.lr-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lr-select-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.lr-select-chevron {
  width: 12px;
  height: 12px;
  color: var(--fg-tertiary);
  transition:
    transform 0.15s var(--ease),
    color 0.15s var(--ease);
  flex-shrink: 0;
}

.lr-select.open .lr-select-chevron {
  transform: rotate(180deg);
  color: var(--fg-secondary);
}

.lr-select-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 4px;
  box-shadow:
    0 0 0 1px rgba(10, 10, 10, 0.03),
    0 16px 36px rgba(10, 10, 10, 0.08),
    0 4px 10px rgba(10, 10, 10, 0.04);
  z-index: 100;
  max-height: 248px;
  overflow-y: auto;
  display: none;
  transform-origin: top center;
}

.lr-select.open .lr-select-menu {
  display: block;
  animation: menuPop 0.14s var(--ease);
}

@keyframes menuPop {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.lr-option {
  min-height: 28px;
  padding: 0 28px 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--fg-secondary);
  border-radius: var(--r-sm);
  cursor: pointer;
  position: relative;
  transition:
    background 0.1s var(--ease),
    color 0.1s var(--ease);
  letter-spacing: -0.005em;
  user-select: none;
}

.lr-option-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.lr-option-main {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lr-option-main {
  color: inherit;
}

.lr-option:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.lr-option.selected {
  color: var(--fg-primary);
  background: var(--selection-soft-hover);
}

.lr-option.selected::before {
  content: '';
  position: absolute;
  right: 8px;
  top: 50%;
  width: 11px;
  height: 11px;
  transform: translateY(-50%);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230a0a0a' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>");
  background-size: contain;
  background-repeat: no-repeat;
}

.lr-select-menu::-webkit-scrollbar {
  width: 8px;
}

.lr-select-menu::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.lr-select-menu::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

.tip {
  font-size: 11.5px;
  color: var(--fg-muted);
  margin-top: 6px;
  letter-spacing: -0.005em;
}

.key-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.key-wrapper input {
  padding-right: 36px;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
}

.key-actions {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 1px;
}

.key-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--fg-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.12s var(--ease),
    color 0.12s var(--ease);
}

.key-btn:hover {
  background: var(--bg-active);
  color: var(--fg-primary);
}

.key-btn svg {
  width: 14px;
  height: 14px;
}

.switch-inline {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.switch-text {
  font-size: 12.5px;
  color: var(--fg-tertiary);
  font-variant-numeric: tabular-nums;
}

.switch {
  position: relative;
  width: 28px;
  height: 16px;
  background: var(--bg-active);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s var(--ease);
  box-shadow: inset 0 0 0 1px var(--border);
}

.switch::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 2px;
  top: 2px;
  background: #fff;
  border-radius: 50%;
  transition: left 0.15s var(--ease);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.switch.active {
  background: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.switch.active::after {
  left: 14px;
}

.slider-row {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
}

.narrator-note {
  display: grid;
  gap: 6px;
  margin-top: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--bg-input);
  padding: 14px;
}

.narrator-note strong {
  color: var(--fg-primary);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.narrator-note span {
  color: var(--fg-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.profile-switcher {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 320px;
}

.profile-role-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.profile-role-switch__button {
  height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--fg-secondary);
  font-size: 12.5px;
  font-weight: 600;
  transition:
    border-color 0.12s var(--ease),
    background 0.12s var(--ease),
    color 0.12s var(--ease),
    transform 0.12s var(--ease);
}

.profile-role-switch__button:hover {
  border-color: var(--border);
  background: var(--bg-input-hover);
  color: var(--fg-primary);
}

.profile-role-switch__button:active {
  transform: scale(0.985);
}

.profile-role-switch__button.is-selected {
  border-color: var(--selection-border);
  background: var(--selection-soft);
  color: var(--fg-primary);
  box-shadow: 0 0 0 1px var(--selection-ring);
}

.profile-list {
  display: grid;
  gap: 8px;
}

.profile-card {
  display: grid;
  grid-template-columns: 12px 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 68px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-input) 84%, transparent);
  padding: 8px 10px;
  transition:
    background 0.14s var(--ease),
    border-color 0.14s var(--ease),
    transform 0.14s var(--ease);
}

.profile-card:hover {
  border-color: var(--border-strong);
  background: var(--bg-input-hover);
}

.profile-card.is-active {
  border-color: var(--selection-border);
  background: var(--selection-soft);
}

.profile-drag {
  display: grid;
  grid-template-columns: repeat(2, 3px);
  gap: 2px;
  color: var(--fg-muted);
}

.profile-drag span {
  width: 3px;

  height: 3px;
  border-radius: 999px;
  background: currentColor;
}

.profile-provider-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  padding: 6px;
  font-size: 17px;
}

.profile-main {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.profile-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.profile-title-row strong {
  overflow: hidden;
  color: var(--fg-primary);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-role-badge,
.profile-connection-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-active);
  color: var(--fg-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  padding: 0 7px;
}

.profile-role-badge.is-main {
  border-color: var(--selection-chip-border);
  background: var(--selection-chip-bg);
  color: var(--fg-primary);
}

.profile-role-badge.is-narrator {
  border-color: color-mix(in srgb, var(--success) 44%, transparent);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--fg-primary);
}

.profile-connection-badge.is-connected {
  border-color: color-mix(in srgb, var(--success) 44%, transparent);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--fg-primary);
}

.profile-connection-badge.is-disconnected {
  color: var(--fg-tertiary);
}

.profile-connection-badge.is-missing {
  border-color: color-mix(in srgb, var(--danger) 42%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--fg-primary);
}

.profile-url {
  overflow: hidden;
  color: var(--accent-hover);
  font-size: 11.5px;
  line-height: 16px;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-details {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.profile-details div {
  min-width: 0;
}

.profile-details dt {
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 12px;
}

.profile-details dd {
  overflow: hidden;
  color: var(--fg-secondary);
  font-size: 10.5px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.profile-action-button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  color: var(--fg-primary);
  transition:
    background 0.12s var(--ease),
    border-color 0.12s var(--ease),
    transform 0.12s var(--ease),
    opacity 0.12s var(--ease);
}

.profile-action-button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.profile-action-button:active:not(:disabled) {
  transform: scale(0.97);
}

.profile-action-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.profile-action-button svg {
  width: 14px;
  height: 14px;
}

.profile-detail {
  min-height: 320px;
}

.profile-detail-card {
  display: grid;
  gap: 14px;
}

.profile-detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-input);
  padding: 12px;
}

.profile-detail-icon {
  width: 38px;
  height: 38px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-elevated);
  padding: 9px;
}

.profile-detail-head strong {
  display: block;
  color: var(--fg-primary);
  font-size: 14px;
  font-weight: 650;
}

.profile-detail-head span {
  color: var(--fg-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.profile-readonly-list {
  display: grid;
  gap: 8px;
}

.profile-readonly-list>div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  align-items: center;
  min-height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-input) 72%, transparent);
  padding: 8px 10px;
}

.profile-readonly-list dt {
  color: var(--fg-muted);
  font-size: 11px;
}

.profile-readonly-list dd {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-secondary);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-readonly-list .is-secret dd {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: visible;
  white-space: normal;
}

.profile-readonly-list code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-primary);
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-readonly-list code.is-visible {
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}

.profile-empty {
  display: grid;
  min-height: 320px;
  place-items: center;
  align-content: center;
  gap: 10px;
  border: 1px dashed var(--border);
  border-radius: 16px;
  color: var(--fg-tertiary);
  text-align: center;
}

.profile-empty strong {
  color: var(--fg-primary);
  font-size: 14px;
  font-weight: 600;
}

.profile-empty span {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.6;
}

.aed-auth-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.aed-auth-card {
  display: grid;
  gap: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-input);
  padding: 12px;
  text-align: left;
  transition:
    border-color 0.12s var(--ease),
    background 0.12s var(--ease),
    transform 0.12s var(--ease);
}

.aed-auth-card:hover {
  background: var(--bg-input-hover);
  border-color: var(--border);
}

.aed-auth-card:active {
  transform: scale(0.985);
}

.aed-auth-card.is-selected {
  box-shadow: 0 0 0 1px var(--accent-ring);
}

.aed-auth-card.is-task.is-selected {
  border-color: rgba(86, 168, 255, 0.42);
  background: rgba(86, 168, 255, 0.12);
}

.aed-auth-card.is-session.is-selected {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(245, 158, 11, 0.14);
}

.aed-auth-card__title {
  color: var(--fg-primary);
  font-size: 12.5px;
  font-weight: 600;
}

.aed-auth-card__description {
  color: var(--fg-tertiary);
  font-size: 11.5px;
  line-height: 1.5;
}

.slider-item {
  flex: 1;
}

.slider-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-secondary);
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
}

.slider-val {
  color: var(--fg-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

input[type='range'] {
  width: 100%;
  height: 4px;
  background: var(--bg-active);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: var(--fg-primary);
  border: 2px solid var(--bg-elevated);
  border-radius: 50%;
  cursor: pointer;
  box-shadow:
    0 0 0 1px var(--border-strong),
    0 1px 2px rgba(0, 0, 0, 0.4);
  transition: transform 0.12s var(--ease);
}

input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: var(--fg-primary);
  border: 2px solid var(--bg-elevated);
  border-radius: 50%;
  cursor: pointer;
}

.modal-footer {
  height: 52px;
  padding: 0 16px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  background: var(--bg-elevated);
}

@media (max-width: 720px) {
  .profile-card {
    grid-template-columns: 12px 30px minmax(0, 1fr);
  }

  .profile-actions {
    grid-column: 3;
    justify-self: start;
  }

  .profile-details {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-readonly-list>div {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}

.btn {
  height: 28px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  font-size: 12.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition:
    background 0.12s var(--ease),
    border-color 0.12s var(--ease),
    color 0.12s var(--ease);
  letter-spacing: -0.005em;
}

.btn-test {
  background: transparent;
  color: var(--fg-primary);
  border-color: var(--border);
}

.btn-test:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-save {
  background: var(--accent);
  color: #fff;
  box-shadow: none;
}

.btn-save:hover {
  background: var(--accent-hover);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.status {
  position: fixed;
  top: 20px;
  left: 50%;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--r-md);
  font-size: 12.5px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--fg-secondary);
  letter-spacing: -0.005em;
  box-shadow: 0 12px 28px rgba(10, 10, 10, 0.08);
  z-index: 10000;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -6px);
  transition:
    opacity 0.14s var(--ease),
    transform 0.14s var(--ease);
  white-space: nowrap;
  max-width: calc(100vw - 40px);
}

.status.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.status-icon {
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-icon svg {
  width: 12px;
  height: 12px;
  stroke-width: 2.4;
}

.status-success .status-icon {
  color: var(--success);
}

.status-error .status-icon {
  color: var(--danger);
}

.status-info .status-icon {
  color: var(--accent);
}

.status-pulse {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
}

@media (max-width: 640px) {
  .modal {
    width: calc(100vw - 16px);
    max-width: 100%;
  }

  .modal-body {
    padding: 14px;
  }

  .form-row,
  .slider-row {
    flex-direction: column;
    gap: 0;
  }

  .form-item[style],
  .form-item {
    flex: 1 1 auto !important;
  }
}

.modal-header.is-summary {
  height: auto;
  min-height: 76px;
  padding: 16px 20px;
  align-items: flex-start;
}

.modal-header-actions {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}

.settings-list-body {
  padding: 0;
}

.summary-list {
  display: grid;
}

.summary-row {
  border-top: 1px solid var(--border-subtle);
  cursor: pointer;
}

.summary-row:first-child {
  border-top: none;
}

.summary-row--static {
  cursor: default;
}

.summary-row-main {
  display: grid;
  gap: 8px;
  padding: 16px 20px;
}

.summary-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-row-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
}

.summary-row-desc {
  color: var(--fg-tertiary);
  font-size: 12px;
  line-height: 1.6;
}

.summary-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-secondary);
  font-size: 12.5px;
}

.summary-provider-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.summary-provider-icon--generic {
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--fg-secondary);
}

.summary-provider-icon--generic svg {
  width: 12px;
  height: 12px;
}

.summary-sep {
  color: var(--fg-muted);
}

.summary-mono,
.cfg-name,
.cfg-input,
.cfg-select,
.summary-key-input,
.summary-token-label,
.summary-token-value {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.summary-row-keyline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}

.summary-row-keyline--tavily {
  gap: 10px;
}

.summary-token-label {
  color: var(--fg-secondary);
  font-size: 11.5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg-mono);
}

.summary-token-value {
  color: var(--fg-secondary);
  font-size: 12px;
}

.summary-token-value.is-empty {
  color: var(--warn);
}

.summary-key-input {
  flex: 1 1 240px;
  min-width: 220px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg-primary);
  font-size: 12px;
}

.summary-key-input::placeholder {
  color: var(--fg-muted);
}

.summary-key-input:focus {
  outline: none;
  border-color: var(--fg-secondary);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.summary-key-input:disabled {
  background: var(--bg-hover);
}

.summary-spacer,
.cfg-spacer {
  flex: 1;
}

.summary-edit-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px dashed var(--border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--info);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.12s var(--ease),
    border-color 0.12s var(--ease);
}

.summary-edit-button:hover {
  background: color-mix(in srgb, var(--info) 10%, transparent);
  border-color: color-mix(in srgb, var(--info) 22%, var(--border-strong));
}

.summary-edit-button__icon,
.summary-edit-button__chevron {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.summary-edit-button__status {
  margin-left: 6px;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 400;
}

.summary-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-mono);
  color: var(--fg-secondary);
  font-size: 11px;
}

.summary-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.summary-badge.is-ok {
  color: var(--success);
}

.summary-badge.is-warn {
  color: var(--warn);
}

.summary-badge.is-over {
  color: var(--info);
}

.summary-footer,
.edit-view-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-subtle);
}

.summary-footer {
  justify-content: flex-end;
}

.summary-footer__hint {
  flex: 1;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.6;
}

.edit-view-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.edit-view-title-group {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.edit-view-title-group h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-primary);
}

.edit-view-title-group h2 span {
  color: var(--fg-secondary);
  font-weight: 500;
}

.edit-view-title-group p {
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.6;
}

.edit-view-body {
  padding: 0;
}

.cfg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.cfg-row--stacked {
  display: grid;
  gap: 8px;
}

.cfg-row-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cfg-tag {
  border-radius: 999px;
  background: var(--bg-mono);
  color: var(--fg-secondary);
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
}

.cfg-input,
.cfg-select {
  width: 260px;
  height: 30px;
  padding: 0 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  color: var(--fg-primary);
  font-size: 12.5px;
  text-align: right;
}

.cfg-select {
  text-align: left;
  font-family: inherit;
}

.cfg-input--short {
  width: 132px;
}

.cfg-input:focus,
.cfg-select:focus {
  outline: none;
  border-color: var(--fg-secondary);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.cfg-help {
  color: var(--fg-muted);
  font-size: 11.5px;
}

.cfg-secret-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cfg-secret-field .cfg-input {
  width: 224px;
}

.cfg-switch {
  position: relative;
  width: 30px;
  height: 18px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--border-strong);
  cursor: pointer;
  transition: background 0.12s var(--ease);
}

.cfg-switch.is-active {
  background: var(--accent);
}

.cfg-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #fff;
  transition: transform 0.12s var(--ease);
}

.cfg-switch.is-active .cfg-switch__thumb {
  transform: translateX(12px);
}

.cfg-switch-label {
  color: var(--fg-secondary);
  font-size: 12px;
}

.btn-ghost {
  background: transparent;
  color: var(--fg-secondary);
  border-color: transparent;
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--fg-primary);
}

.summary-save-button {
  flex: 0 0 auto;
}

@media (max-width: 720px) {

  .summary-row-keyline,
  .cfg-row,
  .cfg-row-main,
  .summary-footer,
  .edit-view-footer {
    flex-wrap: wrap;
  }

  .cfg-input,
  .cfg-select,
  .summary-key-input,
  .cfg-secret-field .cfg-input {
    width: 100%;
  }

  .summary-edit-button {
    width: 100%;
    justify-content: center;
  }

  .summary-footer__hint {
    flex-basis: 100%;
  }
}
</style>
