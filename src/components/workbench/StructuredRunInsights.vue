<template>
  <div v-if="displayedReport.hasContent" class="run-log-shell">
    <div class="run-log-wrap">
      <header class="run-log-header">
        <span class="run-log-header-title">
          <span class="run-log-header-prefix">{{ displayedReport.session.pathPrefix }} /</span>
          {{ displayedReport.session.fileLabel }}
        </span>
        <span class="mono-text run-log-header-meta">{{ displayedReport.session.meta }}</span>
      </header>

      <section class="run-log-summary-card">
        <div class="run-log-summary-top">
          <span class="run-log-led" :class="toneClass(displayedReport.summary.tone)"></span>
          <span class="run-log-summary-label">{{ displayedReport.summary.statusLabel }}</span>
          <span class="run-log-summary-sep">·</span>
          <span class="run-log-summary-sub">{{ displayedReport.summary.phaseLabel }}</span>
          <span class="mono-text run-log-summary-elapsed">
            <b>{{ displayedReport.summary.elapsedLabel }}</b>
            已耗时
          </span>
        </div>

        <div class="run-log-progress-track" aria-hidden="true">
          <div class="run-log-progress-fill" :style="{ width: `${displayedReport.summary.progress}%` }"></div>
          <div v-if="displayedReport.summary.tone === 'running'" class="run-log-progress-shimmer"></div>
        </div>

        <div class="mono-text run-log-stats">
          <span class="run-log-stat is-success">成功 <span class="run-log-stat-value">{{
            displayedReport.summary.counts.success }}</span></span>
          <span class="run-log-stat is-warning">警告 <span class="run-log-stat-value">{{
            displayedReport.summary.counts.warning }}</span></span>
          <span class="run-log-stat is-error">错误 <span class="run-log-stat-value">{{
            displayedReport.summary.counts.error }}</span></span>
          <span class="run-log-stat is-running">进行中 <span class="run-log-stat-value">{{
            displayedReport.summary.counts.running }}</span></span>
        </div>
      </section>

      <div class="run-log-timeline">
        <article
v-for="item in displayedReport.timeline" :key="item.id" class="run-log-item"
          :class="[`accent-${item.accent}`, { 'is-live': item.status === 'running' }]"
          :style="{ '--run-log-gap': String(item.gapWeight) }">
          <div class="run-log-row">
            <span class="mono-text run-log-time">{{ item.timestamp }}</span>
            <span class="run-log-tag" :class="`accent-${item.accent}`">{{ item.tag }}</span>
          </div>

          <p class="run-log-item-title">{{ item.title }}</p>
          <p class="run-log-item-desc">{{ item.description }}</p>

          <div v-if="item.details?.length" class="run-log-item-details">
            <Button variant="ghost" size="sm" class="run-log-details-toggle" @click="toggleExpanded(item.id)">
              {{ isExpanded(item.id) ? '隐藏输出' : item.detailsLabel ?? '查看输出' }}
              <span class="run-log-chevron" :class="{ 'is-open': isExpanded(item.id) }">▸</span>
            </Button>

            <Transition name="run-log-expand">
              <div v-if="isExpanded(item.id)" class="run-log-output mono-text">
                <p
v-for="detail in item.details" :key="`${item.id}-${detail.text}`" class="run-log-output-line"
                  :class="`tone-${detail.tone}`">
                  {{ detail.text }}
                </p>
              </div>
            </Transition>
          </div>
        </article>
      </div>
    </div>
  </div>

  <div v-else class="run-log-empty-state">
    <div class="run-log-empty-copy">
      <p class="run-log-empty-title">暂无运行日志</p>
      <p class="run-log-empty-text">
        运行脚本后，这里会整理为时间线视图，展示状态总览、阶段节点和可展开输出。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button';
import type { IRunLogEntry, IRunResult, TExecutorKind } from '@/types/editor';
import {
  buildStructuredRunReport,
  type IStructuredRunReport,
} from '@/utils/structured-run-report';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const MAX_REPORT_CACHE_ENTRIES = 8;
const REPORT_REBUILD_DELAY_MS = 180;

const props = defineProps<{
  active: boolean;
  terminalOutputVersion: number;
  resolveTerminalOutput: () => string;
  runLogs: IRunLogEntry[];
  lastRunResult: IRunResult | null;
  isRunning: boolean;
  executor: TExecutorKind;
  documentName: string;
  documentPath: string | null;
  workspaceRootPath: string | null;
}>();

const EMPTY_REPORT: IStructuredRunReport = {
  hasContent: false,
  session: {
    pathPrefix: 'builtin-workspace',
    fileLabel: 'startup.sh',
    meta: 'WSL · terminal',
  },
  summary: {
    tone: 'neutral',
    statusLabel: '待执行',
    phaseLabel: '等待运行',
    elapsedLabel: '—',
    progress: 0,
    counts: {
      success: 0,
      warning: 0,
      error: 0,
      running: 0,
    },
  },
  timeline: [],
};

const currentReportKey = computed(
  () => `${props.workspaceRootPath ?? ''}::${props.documentPath ?? ''}::${props.documentName}`,
);

const reportCache = ref<Map<string, IStructuredRunReport>>(new Map());

let reportBuildTimerId: number | null = null;

const buildReportSafely = (): IStructuredRunReport => {
  try {
    return (
      buildStructuredRunReport({
        terminalOutput: props.resolveTerminalOutput(),
        runLogs: props.runLogs,
        lastRunResult: props.lastRunResult,
        isRunning: props.isRunning,
        executor: props.executor,
        documentName: props.documentName,
        documentPath: props.documentPath,
        workspaceRootPath: props.workspaceRootPath,
      }) ?? EMPTY_REPORT
    );
  } catch (error) {
    console.error('Failed to build structured run report', error);
    return EMPTY_REPORT;
  }
};

const liveReport = ref<IStructuredRunReport>(EMPTY_REPORT);

const clearPendingReportBuild = (): void => {
  if (reportBuildTimerId === null) {
    return;
  }

  window.clearTimeout(reportBuildTimerId);
  reportBuildTimerId = null;
};

const cacheReport = (key: string, nextReport: IStructuredRunReport): void => {
  const nextCache = new Map(reportCache.value);
  if (nextCache.has(key)) {
    nextCache.delete(key);
  }

  nextCache.set(key, nextReport);

  while (nextCache.size > MAX_REPORT_CACHE_ENTRIES) {
    const oldestKey = nextCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    nextCache.delete(oldestKey);
  }

  reportCache.value = nextCache;
};

const updateLiveReport = (): void => {
  clearPendingReportBuild();

  const nextReport = buildReportSafely();
  liveReport.value = nextReport;

  if (nextReport.hasContent) {
    cacheReport(currentReportKey.value, nextReport);
  }
};

const scheduleLiveReportUpdate = (): void => {
  clearPendingReportBuild();

  reportBuildTimerId = window.setTimeout(() => {
    reportBuildTimerId = null;
    updateLiveReport();
  }, props.isRunning ? REPORT_REBUILD_DELAY_MS : 32);
};

watch(
  currentReportKey,
  () => {
    if (!props.active) {
      liveReport.value = EMPTY_REPORT;
      return;
    }

    updateLiveReport();
  },
  { immediate: true },
);

watch(
  () => props.active,
  (nextActive) => {
    if (!nextActive) {
      clearPendingReportBuild();
      return;
    }

    updateLiveReport();
  },
  { immediate: true },
);

watch(
  () => [
    props.terminalOutputVersion,
    props.runLogs.length,
    props.runLogs[0]?.id ?? '',
    props.lastRunResult?.finishedAt ?? '',
    props.lastRunResult?.exitCode ?? null,
    props.lastRunResult?.durationMs ?? null,
    props.isRunning,
    props.executor,
    props.documentName,
    props.documentPath,
    props.workspaceRootPath,
  ],
  () => {
    if (!props.active) {
      return;
    }

    scheduleLiveReportUpdate();
  },
  { flush: 'post' },
);

const displayedReport = computed<IStructuredRunReport>(() => {
  if (liveReport.value.hasContent) {
    return liveReport.value;
  }

  return reportCache.value.get(currentReportKey.value) ?? liveReport.value;
});

const expandedItemIds = ref<Set<string>>(new Set());

watch(
  () => displayedReport.value.timeline.map((item) => item.id),
  (ids) => {
    const nextExpandedIds = new Set<string>();

    for (const id of expandedItemIds.value) {
      if (ids.includes(id)) {
        nextExpandedIds.add(id);
      }
    }

    expandedItemIds.value = nextExpandedIds;
  },
  { immediate: true },
);

const toggleExpanded = (itemId: string): void => {
  const nextExpandedIds = new Set(expandedItemIds.value);
  if (nextExpandedIds.has(itemId)) {
    nextExpandedIds.delete(itemId);
  } else {
    nextExpandedIds.add(itemId);
  }

  expandedItemIds.value = nextExpandedIds;
};

const isExpanded = (itemId: string): boolean => expandedItemIds.value.has(itemId);

const toneClass = (tone: 'neutral' | 'success' | 'warning' | 'error' | 'running'): string =>
  `tone-${tone}`;

onBeforeUnmount(() => {
  clearPendingReportBuild();
});
</script>

<style scoped>
.run-log-shell {
  min-height: 100%;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--accent-strong) 14%, transparent), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, var(--panel-bg) 88%, transparent), var(--panel-bg));
}

.run-log-wrap {
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 36px 20px 72px;
}

.run-log-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.run-log-header-title {
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.run-log-header-prefix {
  color: var(--text-quaternary);
  font-weight: 400;
}

.run-log-header-meta {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--text-quaternary);
}

.run-log-summary-card {
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius) + 4px);
  background: color-mix(in srgb, var(--panel-bg) 94%, transparent);
  box-shadow: 0 22px 48px rgba(0, 0, 0, 0.22);
  padding: 16px 18px;
  margin-bottom: 30px;
}

.run-log-summary-top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.run-log-led {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent-strong);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent-strong) 60%, transparent);
}

.run-log-led::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
  opacity: 0.45;
  animation: run-log-pulse 1.8s infinite ease-out;
}

.run-log-led.tone-success {
  background: var(--success);
  color: var(--success);
}

.run-log-led.tone-warning {
  background: var(--warning);
  color: var(--warning);
}

.run-log-led.tone-error {
  background: var(--danger);
  color: var(--danger);
}

.run-log-led.tone-running,
.run-log-led.tone-neutral {
  background: var(--accent-strong);
  color: var(--accent-strong);
}

.run-log-summary-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.run-log-summary-sep {
  color: var(--text-quaternary);
}

.run-log-summary-sub {
  font-size: 11.5px;
  color: var(--text-quaternary);
}

.run-log-summary-elapsed {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.run-log-summary-elapsed b {
  margin-right: 4px;
  color: var(--text-primary);
  font-weight: 500;
}

.run-log-progress-track {
  position: relative;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-subtle) 90%, transparent);
}

.run-log-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg,
      var(--success),
      color-mix(in srgb, var(--success) 58%, var(--accent-strong) 42%),
      var(--accent-strong));
}

.run-log-progress-shimmer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 72px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.28), transparent);
  animation: run-log-slide 1.8s linear infinite;
}

.run-log-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--text-quaternary);
}

.run-log-stat {
  color: var(--text-quaternary);
}

.run-log-stat-value {
  margin-left: 2px;
  font-weight: 500;
}

.run-log-stat.is-success .run-log-stat-value {
  color: color-mix(in srgb, var(--success) 82%, white 18%);
}

.run-log-stat.is-warning .run-log-stat-value {
  color: color-mix(in srgb, var(--warning) 84%, white 16%);
}

.run-log-stat.is-error .run-log-stat-value {
  color: color-mix(in srgb, var(--danger) 84%, white 16%);
}

.run-log-stat.is-running .run-log-stat-value {
  color: color-mix(in srgb, var(--accent-strong) 84%, white 16%);
}

.run-log-timeline {
  position: relative;
  padding-left: 24px;
}

.run-log-timeline::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(to bottom,
      var(--danger) 0%,
      color-mix(in srgb, var(--danger) 48%, var(--warning) 52%) 18%,
      var(--warning) 38%,
      color-mix(in srgb, var(--warning) 46%, var(--success) 54%) 58%,
      color-mix(in srgb, var(--success) 55%, var(--accent-strong) 45%) 76%,
      var(--accent-strong) 100%);
  box-shadow: 0 0 14px rgba(122, 132, 201, 0.14);
  mask-image: linear-gradient(to bottom, transparent 0, black 4%, black 96%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 4%, black 96%, transparent 100%);
}

.run-log-item {
  position: relative;
  padding-bottom: calc(var(--run-log-gap) * 26px + 6px);
}

.run-log-item:last-child {
  padding-bottom: 0;
}

.run-log-item::before {
  content: '';
  position: absolute;
  left: -24px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--app-bg);
  border: 2px solid var(--text-quaternary);
}

.run-log-item.accent-red::before {
  border-color: var(--danger);
  background: var(--danger);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent), 0 0 12px color-mix(in srgb, var(--danger) 36%, transparent);
}

.run-log-item.accent-orange::before {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--warning) 58%);
  background: color-mix(in srgb, var(--danger) 42%, var(--warning) 58%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent), 0 0 12px color-mix(in srgb, var(--warning) 32%, transparent);
}

.run-log-item.accent-yellow::before {
  border-color: var(--warning);
  background: var(--warning);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent), 0 0 12px color-mix(in srgb, var(--warning) 30%, transparent);
}

.run-log-item.accent-green::before {
  border-color: var(--success);
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent), 0 0 12px color-mix(in srgb, var(--success) 32%, transparent);
}

.run-log-item.accent-teal::before {
  border-color: color-mix(in srgb, var(--success) 52%, var(--accent-strong) 48%);
  background: color-mix(in srgb, var(--success) 52%, var(--accent-strong) 48%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong) 16%, transparent), 0 0 12px color-mix(in srgb, var(--accent-strong) 28%, transparent);
}

.run-log-item.accent-blue::before {
  border-color: var(--accent-strong);
  background: var(--app-bg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-strong) 18%, transparent), 0 0 14px color-mix(in srgb, var(--accent-strong) 40%, transparent);
}

.run-log-item.is-live::after {
  content: '';
  position: absolute;
  left: -30px;
  top: -2px;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1.5px solid var(--accent-strong);
  opacity: 0.45;
  animation: run-log-pulse 1.8s infinite ease-out;
}

.run-log-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.run-log-time {
  min-width: 64px;
  font-size: 11px;
  color: var(--text-quaternary);
}

.run-log-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.run-log-tag.accent-red {
  color: color-mix(in srgb, var(--danger) 82%, white 18%);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.run-log-tag.accent-orange {
  color: color-mix(in srgb, var(--warning) 84%, white 16%);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.run-log-tag.accent-yellow {
  color: color-mix(in srgb, var(--warning) 84%, white 16%);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.run-log-tag.accent-green {
  color: color-mix(in srgb, var(--success) 82%, white 18%);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}

.run-log-tag.accent-teal {
  color: color-mix(in srgb, var(--accent-strong) 82%, white 18%);
  background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
}

.run-log-tag.accent-blue {
  color: color-mix(in srgb, var(--accent-strong) 82%, white 18%);
  background: color-mix(in srgb, var(--accent-strong) 18%, transparent);
}

.run-log-item-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.run-log-item-desc {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.run-log-item-details {
  margin-top: 10px;
}

.run-log-details-toggle {
  gap: 6px;
  padding-inline: 0;
  color: var(--text-quaternary);
}

.run-log-details-toggle:hover {
  color: var(--text-secondary);
}

.run-log-chevron {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.run-log-chevron.is-open {
  transform: rotate(90deg);
}

.run-log-output {
  margin-top: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius) + 1px);
  background: color-mix(in srgb, var(--app-bg) 86%, transparent);
  padding: 12px 13px;
  font-size: 11.5px;
  line-height: 1.7;
}

.run-log-output-line {
  margin: 0;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.run-log-output-line+.run-log-output-line {
  margin-top: 4px;
}

.run-log-output-line.tone-muted {
  color: var(--text-quaternary);
}

.run-log-output-line.tone-success {
  color: color-mix(in srgb, var(--success) 82%, white 18%);
}

.run-log-output-line.tone-warning {
  color: color-mix(in srgb, var(--warning) 84%, white 16%);
}

.run-log-output-line.tone-error {
  color: color-mix(in srgb, var(--danger) 82%, white 18%);
}

.run-log-empty-state {
  display: flex;
  min-height: 100%;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.run-log-empty-copy {
  max-width: 320px;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius) + 4px);
  background: color-mix(in srgb, var(--panel-bg) 96%, transparent);
  padding: 18px 20px;
}

.run-log-empty-title {
  margin: 0 0 6px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
}

.run-log-empty-text {
  margin: 0;
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 1.6;
}

.run-log-expand-enter-active,
.run-log-expand-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.run-log-expand-enter-from,
.run-log-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes run-log-pulse {
  0% {
    transform: scale(0.72);
    opacity: 0.6;
  }

  100% {
    transform: scale(1.72);
    opacity: 0;
  }
}

@keyframes run-log-slide {
  0% {
    transform: translateX(-100%);
  }

  100% {
    transform: translateX(760px);
  }
}

@media (max-width: 720px) {
  .run-log-wrap {
    padding-inline: 14px;
    padding-top: 24px;
  }

  .run-log-header,
  .run-log-summary-top {
    flex-wrap: wrap;
  }

  .run-log-header-meta,
  .run-log-summary-elapsed {
    margin-left: 0;
  }
}
</style>
