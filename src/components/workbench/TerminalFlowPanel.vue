<script setup lang="ts">
import { useMessage } from '@/composables/useMessage';
import { useTerminalRuntimeStore } from '@/store/terminal';
import type { ITerminalStatusChangePayload, TTerminalRuntimeState } from '@/types/terminal';
import { writeClipboardText } from '@/utils/clipboard';
import { toErrorMessage } from '@/utils/error';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

const props = defineProps<{
  terminalStatus: ITerminalStatusChangePayload;
  isRunning: boolean;
  terminalOutputLength: number;
  terminalOutputVersion: number;
}>();

const runtimeStore = useTerminalRuntimeStore();
const {
  state,
  activeRun,
  interactiveReady,
  diagnostics,
  showRunSeparator,
  deepDiagnosticsEnabled,
} = storeToRefs(runtimeStore);
const message = useMessage();

const stateLabelMap: Record<TTerminalRuntimeState, string> = {
  booting: '启动中',
  idle_interactive: '交互空闲',
  switching_to_run: '切换到运行',
  running: '运行中',
  switching_to_idle: '切回交互',
};

const routeLabelMap = {
  interactive: 'iPTY',
  run: 'WSL Link',
  buffered: '缓冲',
  dropped: '丢弃',
} as const;

const runtimeTone = computed(() => {
  if (state.value === 'running') return 'running';
  if (state.value === 'switching_to_run' || state.value === 'switching_to_idle') return 'switching';
  if (state.value === 'idle_interactive') return 'ready';
  return 'muted';
});

const activeRunId = computed(() => activeRun.value?.runId ?? diagnostics.value.lastRunId ?? '—');

const activeSessionId = computed(() => activeRun.value?.sessionId ?? 'main-terminal');

const completionLabel = computed(() => {
  if (props.isRunning || state.value === 'running') {
    return '等待 WSL Link 完成事件';
  }
  if (!diagnostics.value.lastCompletedAt) {
    return '等待 terminal:run-completed';
  }
  const exitCode = diagnostics.value.lastExitCode;
  return exitCode === null ? '已完成：无退出码' : `exit ${exitCode}`;
});

const inputRouteLabel = computed(() => {
  const route = diagnostics.value.lastInputRoute;
  return route ? routeLabelMap[route] : '—';
});

const flowCards = computed(() => [
  {
    label: '运行态',
    value: stateLabelMap[state.value],
    meta: props.terminalStatus.message,
    tone: runtimeTone.value,
  },
  {
    label: 'Run ID',
    value: activeRunId.value,
    meta: activeSessionId.value,
    tone: activeRun.value ? 'running' : 'muted',
  },
  {
    label: '完成信号',
    value: completionLabel.value,
    meta: diagnostics.value.lastCompletedAt ?? '等待 terminal:run-completed',
    tone: diagnostics.value.lastExitCode === 0 ? 'ready' : 'muted',
  },
  {
    label: '输入路由',
    value: inputRouteLabel.value,
    meta: `${diagnostics.value.inputEvents} 输入 / ${diagnostics.value.droppedInputEvents} 丢弃`,
    tone: diagnostics.value.lastInputRoute === 'dropped' ? 'danger' : 'muted',
  },
]);

const eventRows = computed(() => [
  {
    label: 'terminal:run-chunk',
    value: `${diagnostics.value.runChunkCount} chunks`,
    meta: `${diagnostics.value.runChunkBytes} bytes`,
  },
  {
    label: 'terminal:data',
    value: `${diagnostics.value.terminalDataChunks} chunks`,
    meta: `${diagnostics.value.terminalDataBytes} bytes · seq ${diagnostics.value.lastTerminalDataSeq ?? '—'}`,
  },
  {
    label: 'xterm:write',
    value: `${diagnostics.value.visualWriteChunks} chunks`,
    meta: `${diagnostics.value.visualWriteBytes} bytes · 实际写入`,
  },
  {
    label: 'Injected reset',
    value: `${diagnostics.value.injectedResetEvents} events`,
    meta: 'ANSI reset 不进入 RunReport',
  },
  {
    label: 'Injected separator',
    value: `${diagnostics.value.injectedSeparatorEvents} events`,
    meta: '视觉分隔条不进入 RunReport',
  },
  {
    label: 'RunReport',
    value: `${props.terminalOutputLength} chars`,
    meta: `version ${props.terminalOutputVersion}`,
  },
  {
    label: 'cancel_terminal_run',
    value: diagnostics.value.cancelMode ?? '—',
    meta: diagnostics.value.cancelRequestedAt ?? '未请求取消',
  },
]);

const lastEventLabel = computed(() => diagnostics.value.lastEventName ?? '暂无事件');
const lastEventAtLabel = computed(() => diagnostics.value.lastEventAt ?? '—');
const separatorToggleLabel = computed(() =>
  showRunSeparator.value ? '隐藏分隔条' : '显示分隔条',
);
const diagnosticsToggleLabel = computed(() =>
  deepDiagnosticsEnabled.value ? '关闭深度诊断' : '开启深度诊断',
);
const diagnosticsModeLabel = computed(() =>
  deepDiagnosticsEnabled.value ? '深度诊断已开启' : '深度诊断默认关闭，输出路径保持轻量',
);

const recentTerminalDataRows = computed(() => diagnostics.value.recentTerminalData.slice(-6));
const recentVisualWriteRows = computed(() => diagnostics.value.recentVisualWrites.slice(-6));

const diagnosticsSnapshot = computed(() => ({
  terminalStatus: props.terminalStatus,
  runtimeState: state.value,
  interactiveReady: interactiveReady.value,
  showRunSeparator: showRunSeparator.value,
  deepDiagnosticsEnabled: deepDiagnosticsEnabled.value,
  activeRun: activeRun.value,
  diagnostics: diagnostics.value,
  runReport: {
    outputLength: props.terminalOutputLength,
    version: props.terminalOutputVersion,
  },
  capturedAt: new Date().toISOString(),
}));

const handleCopySnapshot = async (): Promise<void> => {
  try {
    await writeClipboardText(JSON.stringify(diagnosticsSnapshot.value, null, 2));
    message.success('已复制终端诊断快照');
  } catch (error) {
    message.error(toErrorMessage(error, '复制诊断快照失败'));
  }
};

const handleToggleRunSeparator = (): void => {
  runtimeStore.setRunSeparatorVisible(!showRunSeparator.value);
};

const handleToggleDeepDiagnostics = (): void => {
  runtimeStore.setDeepDiagnosticsEnabled(!deepDiagnosticsEnabled.value);
};
</script>

<template>
  <section class="terminal-flow-shell" aria-label="终端事件流诊断">
    <header class="terminal-flow-header">
      <div class="terminal-flow-title-block">
        <p class="terminal-flow-eyebrow">Terminal flow</p>
        <h3 class="terminal-flow-title">事件流诊断</h3>
        <p class="terminal-flow-subtitle">{{ diagnosticsModeLabel }}</p>
      </div>

      <div class="terminal-flow-header-actions">
        <button
          type="button"
          class="terminal-flow-toggle-button"
          :class="{ 'is-active': deepDiagnosticsEnabled }"
          :aria-pressed="deepDiagnosticsEnabled"
          title="开启后记录高频事件和 xterm buffer 快照；默认关闭以保证输出丝滑。"
          @click="handleToggleDeepDiagnostics"
        >
          {{ diagnosticsToggleLabel }}
        </button>

        <button
          type="button"
          class="terminal-flow-toggle-button"
          :class="{ 'is-active': showRunSeparator }"
          :aria-pressed="showRunSeparator"
          @click="handleToggleRunSeparator"
        >
          {{ separatorToggleLabel }}
        </button>

        <button
          type="button"
          class="terminal-flow-copy-button"
          @click="void handleCopySnapshot()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
          </svg>
          复制快照
        </button>

        <div class="terminal-flow-status" :class="`is-${runtimeTone}`">
          <span class="terminal-flow-status-dot" />
          <span>{{ stateLabelMap[state] }}</span>
        </div>
      </div>
    </header>

    <div
      class="terminal-flow-scroll-region"
      role="region"
      aria-label="终端事件流详情"
      tabindex="0"
    >
      <div class="terminal-flow-summary-grid">
        <article
          v-for="card in flowCards"
          :key="card.label"
          class="terminal-flow-card"
          :class="`is-${card.tone}`"
        >
          <span class="terminal-flow-card-label">{{ card.label }}</span>
          <strong class="terminal-flow-card-value mono-text">{{ card.value }}</strong>
          <span class="terminal-flow-card-meta">{{ card.meta }}</span>
        </article>
      </div>

      <div class="terminal-flow-main">
        <section class="terminal-flow-section">
          <div class="terminal-flow-section-header">
            <span>事件计数</span>
            <span class="terminal-flow-section-meta mono-text">{{ lastEventAtLabel }}</span>
          </div>

          <div class="terminal-flow-event-list">
            <div v-for="row in eventRows" :key="row.label" class="terminal-flow-event-row">
              <span class="terminal-flow-event-name mono-text">{{ row.label }}</span>
              <span class="terminal-flow-event-value">{{ row.value }}</span>
              <span class="terminal-flow-event-meta">{{ row.meta }}</span>
            </div>
          </div>
        </section>

        <section class="terminal-flow-section">
          <div class="terminal-flow-section-header">
            <span>路由模型</span>
            <span
              class="terminal-flow-section-meta"
              :class="{ 'is-ready': interactiveReady }"
            >
              {{ interactiveReady ? 'iPTY ready' : 'iPTY pending' }}
            </span>
          </div>

          <div class="terminal-flow-route-map">
            <div class="terminal-flow-route-node" :class="{ 'is-active': state === 'idle_interactive' }">
              <span class="terminal-flow-route-kicker">idle</span>
              <strong>iPTY</strong>
              <span>交互 shell 输入输出</span>
            </div>
            <div class="terminal-flow-route-arrow" aria-hidden="true">→</div>
            <div class="terminal-flow-route-node" :class="{ 'is-active': state === 'running' }">
              <span class="terminal-flow-route-kicker">running</span>
              <strong>WSL Link</strong>
              <span>gRPC 流式脚本执行</span>
            </div>
            <div class="terminal-flow-route-arrow" aria-hidden="true">→</div>
            <div
              class="terminal-flow-route-node"
              :class="{ 'is-active': state === 'switching_to_idle' }"
            >
              <span class="terminal-flow-route-kicker">complete</span>
              <strong>terminal:run-completed</strong>
              <span>完成态由 agent 回传</span>
            </div>
          </div>

          <footer class="terminal-flow-last-event">
            <span>最近事件</span>
            <code>{{ lastEventLabel }}</code>
          </footer>
        </section>
      </div>

      <div class="terminal-flow-main">
        <section class="terminal-flow-section">
          <div class="terminal-flow-section-header">
            <span>最近 terminal:data</span>
            <span class="terminal-flow-section-meta mono-text">recv</span>
          </div>

          <div v-if="recentTerminalDataRows.length > 0" class="terminal-flow-frame-list">
            <div
              v-for="row in recentTerminalDataRows"
              :key="`data-${row.index}`"
              class="terminal-flow-frame-row"
            >
              <span class="mono-text">#{{ row.index }}</span>
              <span>{{ row.source }}</span>
              <span class="mono-text">g{{ row.seq ?? '—' }} / r{{ row.runSeq ?? '—' }}</span>
              <span class="mono-text">{{ row.runId ?? '—' }}</span>
              <code>{{ row.preview }}</code>
            </div>
          </div>
          <p v-else class="terminal-flow-empty">开启深度诊断后记录 terminal:data 采样。</p>
        </section>

        <section class="terminal-flow-section">
          <div class="terminal-flow-section-header">
            <span>最近 xterm write</span>
            <span class="terminal-flow-section-meta mono-text">actual</span>
          </div>

          <div v-if="recentVisualWriteRows.length > 0" class="terminal-flow-frame-list">
            <div
              v-for="row in recentVisualWriteRows"
              :key="`write-${row.index}`"
              class="terminal-flow-frame-row"
            >
              <span class="mono-text">#{{ row.index }}</span>
              <span>{{ row.source }}</span>
              <span class="mono-text">g{{ row.seq ?? '—' }} / r{{ row.runSeq ?? '—' }}</span>
              <span class="mono-text">{{ row.runId ?? '—' }}</span>
              <code>{{ row.preview }}</code>
            </div>
          </div>
          <p v-else class="terminal-flow-empty">开启深度诊断后记录实际写入 xterm 的帧。</p>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.terminal-flow-shell {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  padding: 16px 18px 18px;
  background:
    radial-gradient(
      90% 120% at 50% 0%,
      color-mix(in srgb, var(--accent-muted) 24%, transparent),
      transparent 58%
    ),
    var(--panel-bg);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: 13px;
}

.terminal-flow-scroll-region {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  margin-right: -12px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 12px;
  scrollbar-color: color-mix(in srgb, var(--shell-divider) 90%, transparent) transparent;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.terminal-flow-scroll-region:focus-visible {
  outline: 1px solid color-mix(in srgb, var(--accent-strong) 42%, transparent);
  outline-offset: 2px;
  border-radius: 8px;
}

.terminal-flow-scroll-region::-webkit-scrollbar {
  width: 10px;
}

.terminal-flow-scroll-region::-webkit-scrollbar-track {
  background: transparent;
}

.terminal-flow-scroll-region::-webkit-scrollbar-thumb {
  border: 2px solid var(--panel-bg);
  border-radius: 999px;
  background: color-mix(in srgb, var(--shell-divider) 90%, transparent);
}

.terminal-flow-scroll-region::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--shell-divider) 100%, transparent);
}

.terminal-flow-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.terminal-flow-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.terminal-flow-title-block {
  display: grid;
  gap: 2px;
}

.terminal-flow-eyebrow {
  margin: 0;
  color: var(--text-quaternary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  line-height: 14px;
  text-transform: uppercase;
}

.terminal-flow-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 22px;
}

.terminal-flow-subtitle {
  margin: 0;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 16px;
}

.terminal-flow-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
}

.terminal-flow-copy-button,
.terminal-flow-toggle-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-soft) 76%, transparent);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition:
    background 80ms linear,
    color 80ms linear,
    border-color 80ms linear;
}

.terminal-flow-copy-button:hover,
.terminal-flow-toggle-button:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
  color: var(--text-secondary);
}

.terminal-flow-copy-button:active,
.terminal-flow-toggle-button:active {
  background: var(--surface-soft-strong);
}

.terminal-flow-toggle-button.is-active {
  border-color: color-mix(in srgb, var(--accent-strong) 28%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-muted) 52%, transparent);
  color: var(--accent-strong);
}

.terminal-flow-copy-button svg {
  width: 13px;
  height: 13px;
}

.terminal-flow-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.terminal-flow-status.is-ready {
  color: var(--success);
}

.terminal-flow-status.is-running,
.terminal-flow-status.is-switching {
  color: var(--accent-strong);
}

.terminal-flow-summary-grid {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.terminal-flow-card {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 10px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-muted) 72%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.terminal-flow-card.is-running,
.terminal-flow-card.is-switching {
  border-color: color-mix(in srgb, var(--accent-strong) 32%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-muted) 42%, var(--panel-muted));
}

.terminal-flow-card.is-ready {
  border-color: color-mix(in srgb, var(--success) 26%, var(--border-subtle));
}

.terminal-flow-card.is-danger {
  border-color: color-mix(in srgb, var(--danger) 36%, var(--border-subtle));
}

.terminal-flow-card-label {
  color: var(--text-quaternary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  line-height: 14px;
  text-transform: uppercase;
}

.terminal-flow-card-value {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-flow-card-meta {
  min-width: 0;
  overflow: hidden;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-flow-main {
  display: grid;
  flex-shrink: 0;
  min-height: 0;
  grid-template-columns: minmax(260px, 0.8fr) minmax(360px, 1.2fr);
  gap: 10px;
}

.terminal-flow-section {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-muted) 74%, transparent);
}

.terminal-flow-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 0 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--shell-divider) 72%, transparent);
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.terminal-flow-section-meta {
  min-width: 0;
  overflow: hidden;
  color: var(--text-quaternary);
  font-size: 11px;
  text-overflow: ellipsis;
  text-transform: none;
  white-space: nowrap;
}

.terminal-flow-section-meta.is-ready {
  color: var(--success);
}

.terminal-flow-event-list {
  display: grid;
  padding: 4px;
}

.terminal-flow-event-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(92px, auto) minmax(90px, auto);
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--text-tertiary);
}

.terminal-flow-event-row:hover {
  background: var(--surface-soft);
}

.terminal-flow-event-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-flow-event-value {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.terminal-flow-event-meta {
  color: var(--text-quaternary);
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}

.terminal-flow-frame-list {
  display: grid;
  gap: 2px;
  padding: 4px;
}

.terminal-flow-frame-row {
  display: grid;
  grid-template-columns: 38px 110px 86px minmax(120px, 0.75fr) minmax(160px, 1.25fr);
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.terminal-flow-frame-row:hover {
  background: var(--surface-soft);
}

.terminal-flow-frame-row code {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-flow-empty {
  margin: 0;
  padding: 12px;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 18px;
}

.terminal-flow-route-map {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr;
  gap: 8px;
  padding: 12px;
}

.terminal-flow-route-node {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-soft);
}

.terminal-flow-route-node.is-active {
  border-color: color-mix(in srgb, var(--accent-strong) 36%, var(--border-subtle));
  background: color-mix(in srgb, var(--accent-muted) 48%, transparent);
}

.terminal-flow-route-kicker {
  color: var(--text-quaternary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 14px;
}

.terminal-flow-route-node strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.terminal-flow-route-node span:last-child {
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 16px;
}

.terminal-flow-route-arrow {
  align-self: center;
  color: var(--text-quaternary);
  font-size: 13px;
}

.terminal-flow-last-event {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding: 10px 12px 12px;
  color: var(--text-quaternary);
  font-size: 12px;
}

.terminal-flow-last-event code {
  min-width: 0;
  overflow: hidden;
  padding: 3px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 960px) {
  .terminal-flow-header {
    flex-direction: column;
  }

  .terminal-flow-header-actions {
    flex-wrap: wrap;
  }

  .terminal-flow-summary-grid,
  .terminal-flow-main {
    grid-template-columns: 1fr;
  }

  .terminal-flow-route-map {
    grid-template-columns: 1fr;
  }

  .terminal-flow-route-arrow {
    display: none;
  }
}
</style>
