import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { aiService } from '@/services/ipc/ai.service';
import { createDefaultAiConfigPayload } from '@/services/ipc/ai-config.service';
import type {
  IAiConfigPayload,
  IAiProviderConnectionPayload,
  IAiProviderConnectionRequest,
  IAiProviderTestPayload,
  IAiSaveConfigRequest,
  IAiSaveCredentialsRequest,
  TAiProviderType,
  TAiStatus,
} from '@/types/ai';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAiStore = defineStore('ai', () => {
  // ── Reactive state ───────────────────────────────────────────────────
  const config = ref<IAiConfigPayload>(createDefaultAiConfigPayload());
  const status = ref<TAiStatus>('idle');
  const errorMessage = ref<string | null>(null);

  // ── Non-reactive internal state ──────────────────────────────────────
  /**
   * 单调递增的 config 写入序号,**non-reactive 闭包变量**,不暴露到外部。
   *
   * 用途:并发竞态保护 —— 只有"最新一次发起的写入"才允许把响应落盘,
   * 避免「先发后到」的旧响应覆盖新响应。
   *
   * 注意:语义是 **last-initiated-wins**,不是 last-completed-wins ——
   * 只要在 await 期间有更新的写入**发起**,当前 await 完成时就丢弃响应,
   * 不需要等更新的写入完成。
   */
  let configWriteSeq = 0;

  // ── Getters ──────────────────────────────────────────────────────────
  const providerType = computed<TAiProviderType>(() => config.value.providerType);
  // 不显式标注 —— IAiConfigPayload.selectedModel 是 string | null,让推断接管
  const selectedModel = computed(() => config.value.selectedModel);
  const isConfigured = computed<boolean>(() => config.value.isConfigured);
  const isError = computed<boolean>(() => status.value === 'error');

  // ── Internal helpers ─────────────────────────────────────────────────

  /**
   * 通用 config 写入器。
   *
   * 接受任意远端请求 `Promise<T>` + 提取函数 `extractConfig: T => IAiConfigPayload`。
   * 在 await 完成时:
   * - 若 seq === configWriteSeq(自己仍是最新发起者),把 `extractConfig(result)` 落盘
   * - 否则丢弃此次响应,config 保留更新的值
   *
   * 始终返回**远端响应原值** `T`(不是 store 当前状态),让调用方能拿到
   * 自己发起的那次请求的真实 response —— 即使它没被落盘。
   *
   * 远端 reject 时异常向上抛,configWriteSeq 不会回退(不需要,
   * last-initiated-wins 仍然成立)。
   */
  const withConfigUpdate = async <T>(
    request: Promise<T>,
    extractConfig: (result: T) => IAiConfigPayload,
  ): Promise<T> => {
    const seq = ++configWriteSeq;
    const result = await request;
    if (seq === configWriteSeq) {
      config.value = extractConfig(result);
    }
    return result;
  };

  /** Identity extractor —— 远端响应本身就是 IAiConfigPayload 的情况。 */
  const identityConfig = (payload: IAiConfigPayload): IAiConfigPayload => payload;

  // ── Actions ──────────────────────────────────────────────────────────

  const loadConfig = (): Promise<IAiConfigPayload> =>
    withConfigUpdate(aiService.getConfig(), identityConfig);

  const saveConfig = (payload: IAiSaveConfigRequest): Promise<IAiConfigPayload> =>
    withConfigUpdate(aiService.saveConfig(payload), identityConfig);

  const saveCredentials = (payload: IAiSaveCredentialsRequest): Promise<IAiConfigPayload> =>
    withConfigUpdate(aiService.saveCredentials(payload), identityConfig);

  const testProvider = (): Promise<IAiProviderTestPayload> => aiService.testProvider();

  const testProviderConfig = (
    payload: IAiProviderConnectionRequest,
  ): Promise<IAiProviderTestPayload> => aiService.testProviderConfig(payload);

  const connectProvider = (
    payload: IAiProviderConnectionRequest,
  ): Promise<IAiProviderConnectionPayload> =>
    withConfigUpdate(aiService.connectProvider(payload), (result) => result.config);

  const setStatus = (nextStatus: TAiStatus, message: string | null = null): void => {
    status.value = nextStatus;
    errorMessage.value = message;
  };

  /**
   * 把 store 重置为初始 state；用于退出登录 / 切换工作区等场景。
   * Pinia 的 setup store 不会自动提供 $reset,需手动归零。
   *
   * 注意:故意**不**重置 `configWriteSeq`。它是单调递增的写入序号,用于并发竞态
   * 保护(last-initiated-wins)。一旦在此归零,reset 时仍在 await 的旧写入(seq=N)
   * 会与 reset 后新发起的写入(从 1 重新计数)撞上相同序号,导致本应被丢弃的过期
   * 响应被误判为"最新发起者"而落盘。保持单调递增可确保旧响应在 reset 后仍被丢弃。
   */
  const reset = (): void => {
    config.value = createDefaultAiConfigPayload();
    status.value = 'idle';
    errorMessage.value = null;
  };

  return {
    // state
    config,
    status,
    errorMessage,
    // getters
    providerType,
    selectedModel,
    isConfigured,
    isError,
    // actions
    loadConfig,
    saveConfig,
    saveCredentials,
    testProvider,
    testProviderConfig,
    connectProvider,
    setStatus,
    reset,
  };
});
