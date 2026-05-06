import { tauriService } from '@/services/tauri';
import type {
  IInstallWslLinkAgentPayload,
  IProbeWslLinkPrimaryPayload,
  IStartWslLinkAgentPayload,
  IWslLinkSupervisorControlPayload,
  IWslLinkAgentArtifactPayload,
  IWslLinkEnvironmentReport,
  IWslLinkStatusPayload,
} from '@/types/wsl-link';
import { toErrorMessage } from '@/utils/error';
import { computed, ref } from 'vue';

export type TWslLinkPanelAction =
  | 'refresh'
  | 'artifact'
  | 'check'
  | 'install'
  | 'start'
  | 'probe'
  | 'connect'
  | 'disconnect';

const normalizeDistroName = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const buildInstallRequest = (distroName?: string) => {
  const normalizedDistroName = normalizeDistroName(distroName);
  return normalizedDistroName
    ? { confirmInstall: true as const, distroName: normalizedDistroName }
    : { confirmInstall: true as const };
};

const buildStartRequest = (distroName?: string) => {
  const normalizedDistroName = normalizeDistroName(distroName);
  return normalizedDistroName
    ? { confirmStart: true as const, distroName: normalizedDistroName }
    : { confirmStart: true as const };
};

export const useWslLinkPanel = () => {
  const status = ref<IWslLinkStatusPayload | null>(null);
  const artifact = ref<IWslLinkAgentArtifactPayload | null>(null);
  const environment = ref<IWslLinkEnvironmentReport | null>(null);
  const installResult = ref<IInstallWslLinkAgentPayload | null>(null);
  const startResult = ref<IStartWslLinkAgentPayload | null>(null);
  const probeResult = ref<IProbeWslLinkPrimaryPayload | null>(null);
  const supervisorResult = ref<IWslLinkSupervisorControlPayload | null>(null);
  const activeAction = ref<TWslLinkPanelAction | null>(null);
  const errorMessage = ref<string | null>(null);

  const isBusy = computed(() => activeAction.value !== null);

  const runAction = async <T>(
    action: TWslLinkPanelAction,
    task: () => Promise<T>,
  ): Promise<T | null> => {
    if (activeAction.value) {
      return null;
    }

    activeAction.value = action;
    errorMessage.value = null;

    try {
      return await task();
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'WSL Link 操作失败');
      return null;
    } finally {
      activeAction.value = null;
    }
  };

  const loadStatus = async (): Promise<IWslLinkStatusPayload> => {
    const payload = await tauriService.getWslLinkStatus();
    status.value = payload;
    return payload;
  };

  const loadArtifact = async (): Promise<IWslLinkAgentArtifactPayload> => {
    const payload = await tauriService.getWslLinkAgentArtifactStatus();
    artifact.value = payload;
    return payload;
  };

  const refreshStatus = async (): Promise<IWslLinkStatusPayload | null> =>
    runAction('refresh', loadStatus);

  const refreshArtifact = async (): Promise<IWslLinkAgentArtifactPayload | null> =>
    runAction('artifact', loadArtifact);

  const checkEnvironment = async (): Promise<IWslLinkEnvironmentReport | null> =>
    runAction('check', async () => {
      const [environmentPayload, artifactPayload, statusPayload] = await Promise.all([
        tauriService.checkWslLinkEnvironment(),
        loadArtifact(),
        loadStatus(),
      ]);
      environment.value = environmentPayload;
      artifact.value = artifactPayload;
      status.value = statusPayload;
      return environmentPayload;
    });

  const installAgent = async (
    distroName?: string,
  ): Promise<IInstallWslLinkAgentPayload | null> =>
    runAction('install', async () => {
      const payload = await tauriService.installWslLinkAgent(buildInstallRequest(distroName));
      installResult.value = payload;
      await Promise.all([loadStatus(), loadArtifact()]);
      return payload;
    });

  const startAgent = async (distroName?: string): Promise<IStartWslLinkAgentPayload | null> =>
    runAction('start', async () => {
      const payload = await tauriService.startWslLinkAgent(buildStartRequest(distroName));
      startResult.value = payload;
      await loadStatus();
      return payload;
    });

  const probePrimary = async (): Promise<IProbeWslLinkPrimaryPayload | null> =>
    runAction('probe', async () => {
      const payload = await tauriService.probeWslLinkPrimary();
      probeResult.value = payload;
      await loadStatus();
      return payload;
    });

  const startSupervisor = async (): Promise<IWslLinkSupervisorControlPayload | null> =>
    runAction('connect', async () => {
      const payload = await tauriService.startWslLinkSupervisor({ confirmStart: true });
      supervisorResult.value = payload;
      await loadStatus();
      return payload;
    });

  const stopSupervisor = async (): Promise<IWslLinkSupervisorControlPayload | null> =>
    runAction('disconnect', async () => {
      const payload = await tauriService.stopWslLinkSupervisor();
      supervisorResult.value = payload;
      await loadStatus();
      return payload;
    });

  const subscribeStatus = async (): Promise<(() => void) | null> => {
    try {
      return await tauriService.onWslLinkStatus((payload) => {
        status.value = payload;
      });
    } catch (error) {
      errorMessage.value = toErrorMessage(error, 'WSL Link 状态订阅失败');
      return null;
    }
  };

  return {
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
    probePrimary,
    startSupervisor,
    stopSupervisor,
    subscribeStatus,
  };
};
