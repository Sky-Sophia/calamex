<script setup lang="ts">
import { useDialog } from '@/composables/useDialog';
import { useMessage } from '@/composables/useMessage';
import { useWslLinkPanel } from '@/composables/useWslLinkPanel';
import type {
  TWslLinkConnectionState,
  TWslLinkProbeStatus,
  TWslLinkTransportKind,
} from '@/types/wsl-link';
import { Activity, Download, Play, RadioTower, RefreshCw } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{
  isDesktopRuntime: boolean;
}>();

const message = useMessage();
const dialog = useDialog();
const {
  status,
  artifact,
  environment,
  installResult,
  startResult,
  probeResult,
  supervisorResult,
  activeAction,
  errorMessage,
  isBusy,
  refreshStatus,
  refreshArtifact,
  checkEnvironment,
  installAgent,
  startAgent,
  startSupervisor,
  stopSupervisor,
  subscribeStatus,
} = useWslLinkPanel();

let stopStatusEvents: (() => void) | null = null;

const stateLabels: Record<TWslLinkConnectionState, string> = {
  idle: '未连接',
  connecting: '连接中',
  ready: '就绪',
  degraded: '降级',
  reconnecting: '重连中',
  resuming: '恢复中',
  backoff: '退避',
  closed: '已关闭',
};

const probeStatusLabels: Record<TWslLinkProbeStatus, string> = {
  ok: '通过',
  warning: '警告',
  error: '失败',
  unknown: '未知',
  unsupported: '不支持',
};

const transportLabels: Record<TWslLinkTransportKind, string> = {
  vsockGrpc: 'AF_HYPERV gRPC',
};

const statusLabel = computed(() => {
  if (!props.isDesktopRuntime) {
    return '桌面端可用';
  }

  return status.value ? stateLabels[status.value.state] : '读取中';
});

const statusTone = computed(() => {
  if (!props.isDesktopRuntime) {
    return 'muted';
  }

  if (probeResult.value?.ok || status.value?.state === 'ready') {
    return 'ready';
  }

  if (status.value?.metrics.lastError || probeResult.value?.ok === false) {
    return 'error';
  }

  if (
    status.value?.state === 'degraded' ||
    status.value?.state === 'backoff' ||
    environment.value?.status === 'warning'
  ) {
    return 'warning';
  }

  return 'muted';
});

const transportLabel = computed(() => {
  const activeTransport = status.value?.metrics.activeTransport ?? probeResult.value?.transport;
  return activeTransport ? transportLabels[activeTransport] : '未选通道';
});

const probeLabel = computed(() => {
  if (status.value?.supervisorRunning && status.value.lastHeartbeatAtUnixMs) {
    return status.value.metrics.rttMs !== null ? `心跳 ${status.value.metrics.rttMs} ms` : '心跳正常';
  }

  if (status.value?.supervisorRunning) {
    return '连接中';
  }

  if (probeResult.value?.ok && probeResult.value.rttMs !== null) {
    return `握手 ${probeResult.value.rttMs} ms`;
  }

  if (probeResult.value?.ok === false) {
    return '握手失败';
  }

  return '未探测';
});

const environmentLabel = computed(() => {
  if (!environment.value) {
    return '环境未检查';
  }

  return probeStatusLabels[environment.value.status];
});

const environmentCheckSummary = computed(() => {
  if (!environment.value) {
    return '';
  }

  const failedCount = environment.value.checks.filter((item) => item.status === 'error').length;
  const warningCount = environment.value.checks.filter((item) => item.status === 'warning').length;
  if (failedCount > 0) {
    return `${failedCount} 项失败`;
  }
  if (warningCount > 0) {
    return `${warningCount} 项警告`;
  }
  return `${environment.value.checks.length} 项检查`;
});

const artifactLabel = computed(() => {
  if (!artifact.value) {
    return '产物未检查';
  }

  return artifact.value.found ? 'agent 已就绪' : '缺少 agent';
});

const lastPathLabel = computed(() => {
  if (startResult.value?.pidPath) {
    return startResult.value.pidPath;
  }

  if (supervisorResult.value?.message) {
    return supervisorResult.value.message;
  }

  if (installResult.value?.noiseConfigPath) {
    return installResult.value.noiseConfigPath;
  }

  if (artifact.value?.path) {
    return artifact.value.path;
  }

  if (artifact.value && !artifact.value.found) {
    return artifact.value.message;
  }

  return status.value?.metrics.lastError ?? errorMessage.value ?? '';
});

const canUseActions = computed(() => props.isDesktopRuntime && !isBusy.value);
const canInstallAgent = computed(() => canUseActions.value && artifact.value?.found === true);
const isSupervisorRunning = computed(() => status.value?.supervisorRunning === true);
const connectionAction = computed(() => (isSupervisorRunning.value ? '停止' : '连接'));
const connectionActionKey = computed(() => (isSupervisorRunning.value ? 'disconnect' : 'connect'));

const actionLabel = (action: string, fallback: string): string =>
  activeAction.value === action ? '执行中' : fallback;

const confirmInstall = async (): Promise<boolean> => {
  const action = await dialog.confirm({
    title: '安装 WSL Link agent',
    description: '将在默认 WSL 发行版的用户目录写入 agent 与 Noise 配置，并在成功后保存桌面侧密钥材料。',
    confirmText: '安装',
    cancelText: '取消',
    dismissText: '返回',
    variant: 'default',
  });
  return action === 'confirm';
};

const confirmStart = async (): Promise<boolean> => {
  const action = await dialog.confirm({
    title: '启动 WSL Link agent',
    description: '将在 WSL 中后台启动已安装的 agent，并写入 pid 与日志文件。',
    confirmText: '启动',
    cancelText: '取消',
    dismissText: '返回',
    variant: 'default',
  });
  return action === 'confirm';
};

const handleRefresh = async (): Promise<void> => {
  const statusPayload = await refreshStatus();
  const artifactPayload = statusPayload ? await refreshArtifact() : null;
  if (statusPayload || artifactPayload) {
    message.success('WSL Link 状态已刷新');
  } else if (errorMessage.value) {
    message.error(errorMessage.value);
  }
};

const handleCheckEnvironment = async (): Promise<void> => {
  const payload = await checkEnvironment();
  if (payload) {
    message.success(`WSL 环境检查完成：${probeStatusLabels[payload.status]}`);
  } else if (errorMessage.value) {
    message.error(errorMessage.value);
  }
};

const handleInstall = async (): Promise<void> => {
  if (!(await confirmInstall())) {
    return;
  }

  const payload = await installAgent();
  if (payload) {
    message.success('WSL Link agent 已安装');
  } else if (errorMessage.value) {
    message.error(errorMessage.value);
  }
};

const handleStart = async (): Promise<void> => {
  if (!(await confirmStart())) {
    return;
  }

  const payload = await startAgent();
  if (payload) {
    message.success('WSL Link agent 已启动');
  } else if (errorMessage.value) {
    message.error(errorMessage.value);
  }
};

const handleConnection = async (): Promise<void> => {
  const payload = isSupervisorRunning.value ? await stopSupervisor() : await startSupervisor();
  if (payload) {
    message.success(payload.message);
  } else if (errorMessage.value) {
    message.error(errorMessage.value);
  }
};

const refreshOverview = async (): Promise<void> => {
  await refreshStatus();
  await refreshArtifact();
};

const ensureStatusSubscription = async (): Promise<void> => {
  if (stopStatusEvents) {
    return;
  }

  stopStatusEvents = await subscribeStatus();
};

const cleanupStatusSubscription = (): void => {
  if (!stopStatusEvents) {
    return;
  }

  stopStatusEvents();
  stopStatusEvents = null;
};

onMounted(() => {
  if (props.isDesktopRuntime) {
    void refreshOverview();
    void ensureStatusSubscription();
  }
});

onUnmounted(() => {
  cleanupStatusSubscription();
});

watch(
  () => props.isDesktopRuntime,
  (isDesktopRuntime) => {
    if (isDesktopRuntime) {
      void refreshOverview();
      void ensureStatusSubscription();
      return;
    }

    cleanupStatusSubscription();
  },
);
</script>

<template>
  <section class="run-sidebar-section wsl-link-section" aria-label="WSL Link">
    <button
      type="button"
      class="run-sidebar-section-head"
      :disabled="isBusy"
      @click="void handleRefresh()"
    >
      <span class="run-sidebar-chevron" aria-hidden="true">
        <Activity class="run-sidebar-icon-sm" />
      </span>
      <span>WSL Link</span>
      <span class="run-sidebar-count">{{ statusLabel }}</span>
    </button>

    <div class="run-sidebar-section-body wsl-link-section-body">
      <div class="wsl-link-status-strip" :class="`is-${statusTone}`">
        <span class="wsl-link-status-dot" aria-hidden="true"></span>
        <span class="wsl-link-status-main">{{ transportLabel }}</span>
        <span class="wsl-link-status-meta">{{ probeLabel }}</span>
      </div>

      <div class="wsl-link-metrics">
        <span>{{ environmentLabel }}</span>
        <span>{{ environmentCheckSummary || '待检查' }}</span>
        <span>{{ artifactLabel }}</span>
      </div>

      <p v-if="lastPathLabel" class="wsl-link-last-message" :title="lastPathLabel">
        {{ lastPathLabel }}
      </p>

      <div class="wsl-link-actions">
        <button
          type="button"
          class="wsl-link-action"
          :disabled="!canUseActions"
          @click="void handleCheckEnvironment()"
        >
          <RefreshCw class="wsl-link-action-icon" aria-hidden="true" />
          <span>{{ actionLabel('check', '检查') }}</span>
        </button>

        <button
          type="button"
          class="wsl-link-action"
          :disabled="!canInstallAgent"
          @click="void handleInstall()"
        >
          <Download class="wsl-link-action-icon" aria-hidden="true" />
          <span>{{ actionLabel('install', '安装') }}</span>
        </button>

        <button
          type="button"
          class="wsl-link-action"
          :disabled="!canUseActions"
          @click="void handleStart()"
        >
          <Play class="wsl-link-action-icon" aria-hidden="true" />
          <span>{{ actionLabel('start', '启动') }}</span>
        </button>

        <button
          type="button"
          class="wsl-link-action is-primary"
          :disabled="!canUseActions"
          @click="void handleConnection()"
        >
          <RadioTower class="wsl-link-action-icon" aria-hidden="true" />
          <span>{{ actionLabel(connectionActionKey, connectionAction) }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
