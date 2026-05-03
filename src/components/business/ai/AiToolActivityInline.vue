<script setup lang="ts">
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  LoaderCircle,
  Pencil,
  Search,
  Terminal,
  XCircle,
} from 'lucide-vue-next';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import type { Component } from 'vue';
import { computed, ref } from 'vue';

import type {
  IAgentActivity,
  IAgentActivityDetail,
  TAgentActivityEvent,
  TAgentActivityStatus,
} from '@/types/agent-activity';
import type { IAiToolCall } from '@/types/ai';
import { materializeAgentActivities } from '@/utils/agent-activity';
import {
  getActionKind,
  getPhaseKeyForActivity,
  getPhaseKeyForToolName,
  getToolDisplayName,
  type TActivityPhaseKey,
  type TToolActionKind,
} from '@/utils/agent-activity-inline-catalog';
import {
  formatElapsed,
  getAggregateDurationLabel,
  getDetailPreview,
  getTargetLeafLabel,
  getTargetSource,
  isMachinePreview,
  normalizeText,
  parseTarget,
  stripTargetNoise,
  uniqueStrings,
} from '@/utils/agent-activity-inline-formatters';
import { sectionizeToolDetails, type IToolDetailSection } from '@/utils/agent-activity-inline-sections';

const props = defineProps<{
  toolCalls: IAiToolCall[];
  activityText?: string;
  activityTrail?: string[];
  activities?: IAgentActivity[];
  activityEvents?: TAgentActivityEvent[];
}>();

interface IToolActionMeta {
  verb: string;
  fallbackTarget: string;
  icon: Component;
}

interface IToolStatusMeta {
  label: string;
  badgeLabel: string;
  detail: string;
  icon: Component;
}

interface IToolTimelineItem extends IAiToolCall {
  toolName: string;
  actionLabel: string;
  headline: string;
  statusLabel: string;
  target: string;
  preview: string | null;
  leafItems: string[];
  lineRange: string | null;
  toolIcon: Component;
  durationLabel: string | null;
  defaultOpen: boolean;
  phaseKey: TActivityPhaseKey;
  sections: IToolDetailSection[];
}

interface IToolPhaseRow {
  id: string;
  key: TActivityPhaseKey;
  title: string;
  summary: string;
  icon: Component;
  status: IAiToolCall['status'];
  statusLabel: string;
  durationLabel: string | null;
  processItems: string[];
  items: IToolTimelineItem[];
  defaultOpen: boolean;
}

interface IToolActivityRow {
  id: string;
  title: string;
  status: IAiToolCall['status'];
  leadingIcon: Component;
  statusIcon: Component;
  statusLabel: string;
  durationLabel: string | null;
  isSpinning: boolean;
}

type TActivityOpenState = Record<string, boolean>;

const TOOL_ACTION_META: Record<TToolActionKind, IToolActionMeta> = {
  read: {
    verb: '查看文件',
    fallbackTarget: '文件',
    icon: FileText,
  },
  fileSearch: {
    verb: '搜索文件',
    fallbackTarget: '项目',
    icon: Search,
  },
  symbolSearch: {
    verb: '搜索符号',
    fallbackTarget: '项目',
    icon: Search,
  },
  diagnose: {
    verb: '检查',
    fallbackTarget: '工作区',
    icon: Activity,
  },
  patch: {
    verb: '生成 Patch',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  applyPatch: {
    verb: '应用 Patch',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  execute: {
    verb: '执行',
    fallbackTarget: '命令',
    icon: Terminal,
  },
  verify: {
    verb: '验证',
    fallbackTarget: '测试',
    icon: Terminal,
  },
  git: {
    verb: 'Git',
    fallbackTarget: '变更',
    icon: GitBranch,
  },
  knowledge: {
    verb: '知识图谱',
    fallbackTarget: '节点',
    icon: Brain,
  },
  reasoning: {
    verb: '任务规划',
    fallbackTarget: '计划',
    icon: Brain,
  },
  time: {
    verb: '时间工具',
    fallbackTarget: '时间',
    icon: Clock3,
  },
  web: {
    verb: '检索',
    fallbackTarget: '资源',
    icon: Globe,
  },
  webFetch: {
    verb: '查看网页',
    fallbackTarget: '网页',
    icon: Globe,
  },
  tree: {
    verb: '查看目录',
    fallbackTarget: '项目结构',
    icon: FolderTree,
  },
  unknown: {
    verb: '调用',
    fallbackTarget: '任务',
    icon: Activity,
  },
};

const TOOL_STATUS_META: Record<IAiToolCall['status'], IToolStatusMeta> = {
  pending: {
    label: '等待中',
    badgeLabel: '等待',
    detail: '等待确认',
    icon: Clock3,
  },
  running: {
    label: '运行中',
    badgeLabel: '进行中',
    detail: '正在执行',
    icon: LoaderCircle,
  },
  succeeded: {
    label: '已完成',
    badgeLabel: '完成',
    detail: '结果已返回',
    icon: CheckCircle2,
  },
  failed: {
    label: '失败',
    badgeLabel: '失败',
    detail: '执行失败',
    icon: CircleAlert,
  },
  denied: {
    label: '已停止',
    badgeLabel: '已停止',
    detail: '已停止',
    icon: XCircle,
  },
};

const ACTIVITY_STATUS_TO_TOOL_STATUS: Record<TAgentActivityStatus, IAiToolCall['status']> = {
  pending: 'pending',
  running: 'running',
  success: 'succeeded',
  error: 'failed',
  cancelled: 'denied',
};

const PHASE_META: Record<TActivityPhaseKey, { title: string; icon: Component; order: number }> = {
  planning: {
    title: '任务规划',
    icon: Brain,
    order: 0,
  },
  safety: {
    title: '权限与安全',
    icon: Activity,
    order: 1,
  },
  project_scan: {
    title: '项目扫描',
    icon: FolderTree,
    order: 2,
  },
  files_read: {
    title: '阅读文件',
    icon: FileText,
    order: 3,
  },
  files_modify: {
    title: '修改文件',
    icon: Pencil,
    order: 4,
  },
  knowledge: {
    title: '知识图谱',
    icon: Brain,
    order: 5,
  },
  web: {
    title: '网络研究',
    icon: Globe,
    order: 6,
  },
  git: {
    title: 'Git 操作',
    icon: GitBranch,
    order: 7,
  },
  verify: {
    title: '验证结果',
    icon: Terminal,
    order: 8,
  },
  summary: {
    title: '总结',
    icon: CheckCircle2,
    order: 9,
  },
};

const ACTIVITY_KIND_ICON: Record<IAgentActivity['kind'], Component> = {
  run: Activity,
  search: Search,
  read_file: FileText,
  edit_file: Pencil,
  tool_call: Activity,
  command: Terminal,
  reasoning_summary: Activity,
  llm: Activity,
  error: CircleAlert,
};
const getFactStatusIcon = (
  status: IAiToolCall['status'],
  isActive = false,
): Component => {
  if (status === 'running' && isActive) {
    return LoaderCircle;
  }

  return TOOL_STATUS_META[status].icon;
};

const getFactTopicIcon = (value: string): Component => {
  if (/计划|规划|步骤|阶段/u.test(value)) {
    return Brain;
  }

  if (/搜索|检索|查询|命中/u.test(value)) {
    return Search;
  }

  if (/目录|项目结构|工作区/u.test(value)) {
    return FolderTree;
  }

  if (/文件|路径|位置|读取|打开/u.test(value)) {
    return FileText;
  }

  if (/网页|联网|站点|URL|网址/u.test(value)) {
    return Globe;
  }

  if (/命令|终端|测试|验证/u.test(value)) {
    return Terminal;
  }

  if (/Git|提交|暂存/u.test(value)) {
    return GitBranch;
  }

  return Activity;
};

const phaseOpenState = ref<TActivityOpenState>({});
const itemOpenState = ref<TActivityOpenState>({});

const shouldAutoOpenPhase = (phase: IToolPhaseRow): boolean =>
  phase.defaultOpen || phase.status === 'running' || phase.status === 'failed';

const shouldAutoOpenItem = (item: IToolTimelineItem): boolean =>
  item.defaultOpen || item.status === 'failed';

const resolveNodeOpen = <TNode extends { id: string }>(
  openState: TActivityOpenState,
  node: TNode,
  getFallback: (target: TNode) => boolean,
): boolean => openState[node.id] ?? getFallback(node);

const isPhaseOpen = (phase: IToolPhaseRow): boolean =>
  resolveNodeOpen(phaseOpenState.value, phase, shouldAutoOpenPhase);

const isItemOpen = (item: IToolTimelineItem): boolean =>
  resolveNodeOpen(itemOpenState.value, item, shouldAutoOpenItem);

const updatePhaseOpen = (phaseId: string, open: boolean): void => {
  phaseOpenState.value = {
    ...phaseOpenState.value,
    [phaseId]: open,
  };
};

const updateItemOpen = (itemId: string, open: boolean): void => {
  itemOpenState.value = {
    ...itemOpenState.value,
    [itemId]: open,
  };
};

const buildPhaseSummary = (
  phaseKey: TActivityPhaseKey,
  processValues: readonly string[],
  timelineItems: readonly IToolTimelineItem[],
): string => {
  if (!timelineItems.length && processValues.length === 1) {
    return processValues[0] ?? '';
  }

  if (timelineItems.length === 1 && !processValues.length) {
    return timelineItems[0]?.headline ?? '';
  }

  if (phaseKey === 'planning' && processValues.length) {
    return `${processValues.length} 条可见摘要`;
  }

  const totalCount = processValues.length + timelineItems.length;
  const failureCount = timelineItems.filter((item) => item.status === 'failed').length;
  const runningCount = timelineItems.filter((item) => item.status === 'running').length;

  if (failureCount > 0) {
    return `${totalCount} 个节点，${failureCount} 个异常`;
  }

  if (runningCount > 0) {
    return `${totalCount} 个节点，${runningCount} 个进行中`;
  }

  return `${totalCount} 个节点`;
};

const buildTimelineItem = (toolCall: IAiToolCall): IToolTimelineItem => {
  const actionKind = getActionKind(toolCall.name);
  const actionMeta = TOOL_ACTION_META[actionKind];
  const statusMeta = TOOL_STATUS_META[toolCall.status];
  const parsedTarget = parseTarget(stripTargetNoise(getTargetSource(toolCall, actionMeta.fallbackTarget)));
  const target = parsedTarget.target || actionMeta.fallbackTarget;
  const elapsed = formatElapsed(toolCall.elapsedMs);
  const actionLabel = getToolDisplayName(toolCall.name, actionMeta.verb);
  const headline = `${actionLabel} · ${target}`;
  const preview = getDetailPreview(toolCall.summary, target, statusMeta.detail);
  const detailItems = uniqueStrings(toolCall.detailItems ?? [])
    .filter((item) => !isMachinePreview(item))
    .slice(0, 4);
  const lineRange = parsedTarget.lineRange;
  const metaItems = uniqueStrings([
    getTargetLeafLabel(actionKind, target, actionMeta.fallbackTarget, detailItems) ?? '',
    lineRange ? `位置：${lineRange}` : '',
    elapsed ? `耗时：${elapsed}` : '',
    preview ? `结果：${preview}` : '',
    detailItems.length || preview ? '' : `状态：${statusMeta.detail}`,
  ]);
  const leafItems = uniqueStrings([
    ...detailItems,
    ...metaItems,
  ]).slice(0, 7);
  const phaseKey = getPhaseKeyForToolName(toolCall.name);

  return {
    ...toolCall,
    toolName: toolCall.name,
    actionLabel,
    headline,
    statusLabel: statusMeta.badgeLabel,
    target,
    preview,
    leafItems,
    lineRange,
    toolIcon: actionMeta.icon,
    durationLabel: elapsed,
    defaultOpen: false,
    phaseKey,
    sections: sectionizeToolDetails({
      toolLabel: actionLabel,
      status: toolCall.status,
      statusDetail: statusMeta.detail,
      target,
      lineRange,
      durationLabel: elapsed,
      preview,
      leafItems,
    }),
  };
};

const formatActivityDetail = (detail: IAgentActivityDetail): string =>
  `${detail.label}：${detail.value}`;

const buildActivityLeafItems = (activity: IAgentActivity): string[] => {
  const detailItems = (activity.details ?? [])
    .map(formatActivityDetail)
    .filter((item) => !isMachinePreview(item));
  const output = activity.outputSummary && !isMachinePreview(activity.outputSummary)
    ? `结果：${activity.outputSummary}`
    : '';
  const error = activity.error?.message ? `错误：${activity.error.message}` : '';
  const duration = formatElapsed(activity.durationMs);

  return uniqueStrings([
    ...detailItems,
    output,
    error,
    duration ? `耗时：${duration}` : '',
    detailItems.length || output || error ? '' : `状态：${TOOL_STATUS_META[
      ACTIVITY_STATUS_TO_TOOL_STATUS[activity.status]
    ].detail}`,
  ]).slice(0, 7);
};

const buildTimelineItemFromActivity = (activity: IAgentActivity): IToolTimelineItem => {
  const status = ACTIVITY_STATUS_TO_TOOL_STATUS[activity.status];
  const target = normalizeText(
    activity.description ?? activity.inputSummary ?? activity.outputSummary ?? '',
  );
  const fallbackTarget = activity.kind === 'search' ? '检索' : '任务';
  const displayTarget = target || fallbackTarget;
  const preview = activity.outputSummary ?? activity.error?.message ?? null;
  const leafItems = buildActivityLeafItems(activity);
  const toolName = activity.tool?.name ?? activity.kind;
  const phaseKey = getPhaseKeyForActivity(activity);

  return {
    id: activity.id,
    name: toolName,
    status,
    summary: activity.outputSummary ?? activity.description ?? activity.title,
    targetPreview: displayTarget,
    elapsedMs: activity.durationMs,
    toolName,
    actionLabel: activity.title,
    headline: target ? `${activity.title} · ${target}` : activity.title,
    statusLabel: TOOL_STATUS_META[status].label,
    target: displayTarget,
    preview,
    leafItems,
    lineRange: null,
    toolIcon: ACTIVITY_KIND_ICON[activity.kind],
    durationLabel: formatElapsed(activity.durationMs),
    defaultOpen: false,
    phaseKey,
    sections: sectionizeToolDetails({
      toolLabel: activity.title,
      status,
      statusDetail: TOOL_STATUS_META[status].detail,
      target: displayTarget,
      lineRange: null,
      durationLabel: formatElapsed(activity.durationMs),
      preview,
      leafItems,
      inputSummary: activity.inputSummary ?? activity.description ?? null,
      outputSummary: activity.outputSummary ?? null,
      errorMessage: activity.error?.message ?? null,
    }),
  };
};

const resolvedActivities = computed(() => {
  if (props.activities?.length) {
    return props.activities;
  }

  if (props.activityEvents?.length) {
    return materializeAgentActivities(props.activityEvents);
  }

  return [];
});

const activityRoot = computed(() =>
  resolvedActivities.value.find((activity) => !activity.parentId) ?? null,
);

const activityDescendants = computed(() => {
  const root = activityRoot.value;

  if (!root) {
    return [];
  }

  const childrenByParentId = new Map<string, IAgentActivity[]>();

  for (const activity of resolvedActivities.value) {
    if (!activity.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(activity.parentId);
    if (siblings) {
      siblings.push(activity);
      continue;
    }

    childrenByParentId.set(activity.parentId, [activity]);
  }

  const descendants: IAgentActivity[] = [];
  const visited = new Set<string>();

  const appendDescendants = (parentId: string): void => {
    const children = childrenByParentId.get(parentId) ?? [];

    for (const child of children) {
      if (visited.has(child.id)) {
        continue;
      }

      visited.add(child.id);
      descendants.push(child);
      appendDescendants(child.id);
    }
  };

  appendDescendants(root.id);

  return descendants;
});

const items = computed(() => {
  if (activityRoot.value) {
    return activityDescendants.value
      .filter((activity) => activity.kind !== 'reasoning_summary' && activity.kind !== 'llm')
      .map(buildTimelineItemFromActivity);
  }

  return props.toolCalls.map(buildTimelineItem);
});

const processItems = computed(() => {
  if (activityRoot.value) {
    return uniqueStrings(
      activityDescendants.value
        .filter((activity) => activity.kind === 'reasoning_summary' || activity.kind === 'llm')
        .map((activity) => activity.description ?? activity.title),
    ).slice(-3);
  }

  const activityTitle = normalizeText(props.activityText ?? '');

  return uniqueStrings(props.activityTrail ?? [])
    .filter((item) => !isMachinePreview(item))
    .filter((item) => normalizeText(item) !== activityTitle)
    .slice(-2);
});

const overallStatus = computed<IAiToolCall['status']>(() => {
  if (activityRoot.value) {
    return ACTIVITY_STATUS_TO_TOOL_STATUS[activityRoot.value.status];
  }

  return items.value.length ? getGroupStatus(items.value) : 'running';
});

const phases = computed<IToolPhaseRow[]>(() => {
  const groups = new Map<TActivityPhaseKey, { processItems: string[]; items: IToolTimelineItem[] }>();

  if (processItems.value.length) {
    groups.set('planning', {
      processItems: processItems.value,
      items: [],
    });
  }

  for (const item of items.value) {
    const existing = groups.get(item.phaseKey);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(item.phaseKey, {
      processItems: [],
      items: [item],
    });
  }

  return [...groups.entries()]
    .sort((left, right) => PHASE_META[left[0]].order - PHASE_META[right[0]].order)
    .map(([phaseKey, group]) => {
      const phaseStatus = group.items.length ? getGroupStatus(group.items) : overallStatus.value;
      const phaseMeta = PHASE_META[phaseKey];

      return {
        id: `${activityRow.value?.id ?? 'run'}:${phaseKey}`,
        key: phaseKey,
        title: phaseMeta.title,
        summary: buildPhaseSummary(phaseKey, group.processItems, group.items),
        icon: phaseMeta.icon,
        status: phaseStatus,
        statusLabel: TOOL_STATUS_META[phaseStatus].badgeLabel,
        durationLabel: getAggregateDurationLabel(group.items.map((item) => item.elapsedMs)),
        processItems: group.processItems,
        items: group.items,
        defaultOpen: true,
      };
    });
});

const getPrimaryItem = (timelineItems: readonly IToolTimelineItem[]): IToolTimelineItem | null => {
  const running = timelineItems.find((item) => item.status === 'running');
  if (running) {
    return running;
  }

  const failed = timelineItems.find((item) => item.status === 'failed');
  if (failed) {
    return failed;
  }

  return timelineItems[timelineItems.length - 1] ?? null;
};

const getGroupStatus = (timelineItems: readonly IToolTimelineItem[]): IAiToolCall['status'] => {
  if (timelineItems.some((item) => item.status === 'failed')) {
    return 'failed';
  }

  if (timelineItems.some((item) => item.status === 'running')) {
    return 'running';
  }

  if (timelineItems.some((item) => item.status === 'pending')) {
    return 'pending';
  }

  if (timelineItems.some((item) => item.status === 'denied')) {
    return 'denied';
  }

  return 'succeeded';
};

const activityRow = computed<IToolActivityRow | null>(() => {
  const root = activityRoot.value;
  if (root) {
    const status = ACTIVITY_STATUS_TO_TOOL_STATUS[root.status];
    const statusMeta = TOOL_STATUS_META[status];
    const durationLabel = formatElapsed(root.durationMs)
      ?? getAggregateDurationLabel(activityDescendants.value.map((activity) => activity.durationMs));

    return {
      id: root.id,
      title: root.title,
      status,
      leadingIcon: Bot,
      statusIcon: statusMeta.icon,
      statusLabel: statusMeta.badgeLabel,
      durationLabel,
      isSpinning: status === 'running',
    };
  }

  const trimmedActivity = props.activityText?.trim();
  if (!trimmedActivity && !items.value.length && !processItems.value.length) {
    return null;
  }

  const primaryItem = getPrimaryItem(items.value);
  const status = overallStatus.value;
  const statusMeta = TOOL_STATUS_META[status];
  const durationLabel = getAggregateDurationLabel(items.value.map((item) => item.elapsedMs));

  return {
    id: 'current-activity',
    title: trimmedActivity || primaryItem?.headline || statusMeta.detail,
    status,
    leadingIcon: Bot,
    statusIcon: statusMeta.icon,
    statusLabel: statusMeta.badgeLabel,
    durationLabel,
    isSpinning: status === 'running',
  };
});
</script>

<template>
  <section v-if="activityRow" class="ai-tool-activity-inline ai-tool-run-timeline" :class="`is-${activityRow.status}`"
    aria-label="工具调用树">
    <ol class="ai-tool-tree">
      <li class="ai-tool-tree-node ai-tool-run-item ai-tool-run-current" :class="`is-${activityRow.status}`"
        aria-live="polite">
        <CollapsibleRoot class="ai-tool-node-details ai-tool-root-details" :default-open="true">
          <CollapsibleTrigger as-child>
            <button type="button" class="ai-tool-tree-row ai-tool-tree-root-row">
              <span class="ai-tool-run-status-node">
                <component :is="activityRow.leadingIcon" class="ai-tool-node-icon" />
              </span>
              <span class="ai-tool-row-copy">
                <span class="ai-tool-run-title" :title="activityRow.title">{{ activityRow.title }}</span>
              </span>
              <span v-if="activityRow.status !== 'succeeded' || activityRow.durationLabel" class="ai-tool-row-meta">
                <span v-if="activityRow.status !== 'succeeded'" class="ai-tool-status-text"
                  :class="`is-${activityRow.status}`">{{ activityRow.statusLabel }}</span>
                <span v-if="activityRow.durationLabel" class="ai-tool-duration-pill">{{ activityRow.durationLabel
                }}</span>
              </span>
              <span class="ai-tool-chevron-shell" aria-hidden="true">
                <ChevronRight class="ai-tool-run-chevron" />
              </span>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent v-if="phases.length" force-mount as-child>
            <div class="ai-tool-collapsible-content">
              <div class="ai-tool-collapsible-shell">
                <TransitionGroup name="ai-tool-list-motion" tag="ol"
                  class="ai-tool-subtree ai-tool-tool-list ai-tool-phase-list">
      <li v-for="phase in phases" :key="phase.id" class="ai-tool-tree-node ai-tool-phase-node"
        :class="`is-${phase.status}`">
        <CollapsibleRoot class="ai-tool-node-details ai-tool-phase-details" :open="isPhaseOpen(phase)"
          @update:open="(open) => updatePhaseOpen(phase.id, open)">
          <CollapsibleTrigger as-child>
            <button type="button" class="ai-tool-tree-row ai-tool-phase-summary">
              <span class="ai-tool-run-status-node is-branch">
                <component :is="phase.icon" class="ai-tool-node-icon" />
              </span>
              <span class="ai-tool-run-main ai-tool-phase-main">
                <span class="ai-tool-run-heading-line ai-tool-phase-heading-line">
                  <span class="ai-tool-run-action ai-tool-phase-title">{{ phase.title }}</span>
                  <span class="ai-tool-phase-summary-text" :title="phase.summary">{{ phase.summary }}</span>
                </span>
              </span>
              <span v-if="phase.status !== 'succeeded' || phase.durationLabel" class="ai-tool-row-meta">
                <span v-if="phase.status !== 'succeeded'" class="ai-tool-status-text" :class="`is-${phase.status}`">{{
                  phase.statusLabel }}</span>
                <span v-if="phase.durationLabel" class="ai-tool-duration-pill">{{ phase.durationLabel }}</span>
              </span>
              <span class="ai-tool-chevron-shell" aria-hidden="true">
                <ChevronRight class="ai-tool-run-chevron" />
              </span>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent v-if="phase.processItems.length || phase.items.length" as-child>
            <ol class="ai-tool-subtree ai-tool-phase-items ai-tool-collapsible-content">
              <li v-for="process in phase.processItems" :key="`${phase.id}:process:${process}`"
                class="ai-tool-tree-node ai-tool-detail-node ai-tool-process-node">
                <span class="ai-tool-fact-rail" aria-hidden="true">
                  <span class="ai-tool-fact-status" :class="`is-${phase.status}`">
                    <component
                      :is="getFactStatusIcon(phase.status, phase.status === 'running' && process === phase.processItems.at(-1))"
                      class="ai-tool-fact-status-icon"
                      :class="{ 'is-spinning': phase.status === 'running' && process === phase.processItems.at(-1) }" />
                  </span>
                  <span class="ai-tool-fact-topic">
                    <component :is="getFactTopicIcon(process)" class="ai-tool-fact-topic-icon" />
                  </span>
                </span>
                <span class="ai-tool-run-fact" :title="process">{{ process }}</span>
              </li>

              <li v-for="item in phase.items" :key="item.id" class="ai-tool-tree-node ai-tool-run-item"
                :class="`is-${item.status}`">
                <CollapsibleRoot class="ai-tool-node-details" :open="isItemOpen(item)"
                  @update:open="(open) => updateItemOpen(item.id, open)">
                  <CollapsibleTrigger as-child>
                    <button type="button" class="ai-tool-tree-row ai-tool-run-summary">
                      <span class="ai-tool-run-status-node is-branch">
                        <component :is="item.toolIcon" class="ai-tool-node-icon" />
                      </span>
                      <span class="ai-tool-run-main">
                        <span class="ai-tool-run-heading-line">
                          <span class="ai-tool-run-action">{{ item.actionLabel }}</span>
                          <span class="ai-tool-run-target" :title="item.target">{{ item.target }}</span>
                        </span>
                      </span>
                      <span v-if="item.status !== 'succeeded' || item.durationLabel" class="ai-tool-row-meta">
                        <span v-if="item.status !== 'succeeded'" class="ai-tool-status-text"
                          :class="`is-${item.status}`">{{ item.statusLabel }}</span>
                        <span v-if="item.durationLabel" class="ai-tool-duration-pill">{{ item.durationLabel }}</span>
                      </span>
                      <span class="ai-tool-chevron-shell" aria-hidden="true">
                        <ChevronRight class="ai-tool-run-chevron" />
                      </span>
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent v-if="item.sections.length" as-child>
                    <div class="ai-tool-collapsible-content ai-tool-detail-card">
                      <section v-for="section in item.sections" :key="`${item.id}:section:${section.title}`"
                        class="ai-tool-detail-section" :class="section.tone ? `is-${section.tone}` : ''">
                        <h4 class="ai-tool-detail-heading">{{ section.title }}</h4>
                        <ol class="ai-tool-detail-points">
                          <li v-for="detail in section.items" :key="`${item.id}:detail:${section.title}:${detail}`"
                            class="ai-tool-detail-point" :title="detail">
                            {{ detail }}
                          </li>
                        </ol>
                      </section>
                    </div>
                  </CollapsibleContent>
                </CollapsibleRoot>
              </li>
            </ol>
          </CollapsibleContent>
        </CollapsibleRoot>
      </li>
      </TransitionGroup>
      </div>
      </div>
      </CollapsibleContent>
      </CollapsibleRoot>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ai-tool-run-timeline {
  width: min(100%, 760px);
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.ai-tool-run-status-node {
  display: inline-flex;
  width: 24px;
  min-width: 24px;
  height: 20px;
  align-items: center;
  justify-content: center;
}

.ai-tool-run-status-node.is-branch {
  width: 24px;
  min-width: 24px;
  height: 20px;
}

.ai-tool-node-icon {
  width: 14px;
  height: 14px;
  color: var(--text-secondary);
  stroke-width: 2;
}

.ai-tool-fact-status-icon {
  width: 12px;
  height: 12px;
  stroke-width: 2;
}

.ai-tool-fact-status-icon.is-spinning {
  animation: ai-tool-status-spin 900ms linear infinite;
  color: var(--text-secondary);
}

.ai-tool-run-title {
  min-width: 0;
  color: inherit;
  font-size: 14px;
  font-weight: 560;
  line-height: 22px;
  unicode-bidi: plaintext;
  word-break: break-word;
}

.ai-tool-tree,
.ai-tool-subtree {
  display: grid;
  min-width: 0;
  list-style: none;
}

.ai-tool-tree {
  gap: 2px;
  margin: 0;
  padding: 0;
}

.ai-tool-subtree {
  gap: 2px;
  margin: 6px 0 0 17px;
  border-left: 1px solid color-mix(in srgb, var(--shell-divider) 68%, transparent);
  padding: 2px 0 4px 18px;
}

.ai-tool-tree-node {
  position: relative;
  min-width: 0;
}

.ai-tool-run-item {
  padding: 4px 0;
}

.ai-tool-subtree>.ai-tool-tree-node::before {
  position: absolute;
  top: 18px;
  left: -18px;
  width: 14px;
  border-top: 1px solid color-mix(in srgb, var(--shell-divider) 68%, transparent);
  content: '';
}

.ai-tool-run-current {
  padding-top: 0;
}

.ai-tool-tree-row {
  display: grid;
  min-width: 0;
  align-items: center;
  column-gap: 8px;
  width: 100%;
}

.ai-tool-tree-root-row {
  grid-template-columns: 24px minmax(0, 1fr) auto 14px;
  min-height: 34px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  list-style: none;
  padding: 3px 0;
  transition:
    background-color 140ms cubic-bezier(0.23, 1, 0.32, 1),
    color 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-node-details {
  display: block;
  min-width: 0;
}

.ai-tool-tree-root-row,
.ai-tool-phase-summary,
.ai-tool-run-summary {
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  appearance: none;
}

.ai-tool-chevron-shell {
  display: inline-flex;
  width: 14px;
  align-items: center;
  justify-content: center;
  justify-self: end;
}

.ai-tool-row-copy {
  display: grid;
  min-width: 0;
}

.ai-tool-row-meta {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  justify-self: end;
}

.ai-tool-duration-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.ai-tool-duration-pill {
  color: var(--text-quaternary);
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--surface-panel) 54%, transparent);
}

.ai-tool-status-text {
  color: var(--text-quaternary);
  font-size: 11px;
  font-weight: 520;
  line-height: 16px;
  white-space: nowrap;
}

.ai-tool-status-text.is-running {
  color: var(--text-secondary);
}

.ai-tool-status-text.is-failed,
.ai-tool-status-text.is-denied {
  color: color-mix(in srgb, var(--danger) 84%, var(--text-secondary));
}

.ai-tool-run-summary {
  grid-template-columns: 24px minmax(0, 1fr) auto 14px;
  min-height: 30px;
  gap: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  list-style: none;
  padding: 2px 0;
  transition:
    background-color 140ms cubic-bezier(0.23, 1, 0.32, 1),
    color 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-phase-summary {
  grid-template-columns: 24px minmax(0, 1fr) auto 14px;
  min-height: 30px;
  gap: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  list-style: none;
  padding: 2px 0;
  transition:
    background-color 140ms cubic-bezier(0.23, 1, 0.32, 1),
    color 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-run-main {
  display: grid;
  min-width: 0;
}

.ai-tool-phase-main {
  align-items: center;
}

.ai-tool-run-heading-line {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  flex-wrap: wrap;
}

.ai-tool-phase-heading-line {
  align-items: center;
}

.ai-tool-phase-title {
  font-weight: 560;
}

.ai-tool-phase-summary-text {
  max-width: 100%;
}

.ai-tool-kind-icon {
  width: 13px;
  height: 13px;
  color: var(--text-quaternary);
  stroke-width: 1.9;
}

.ai-tool-run-action {
  color: var(--text-primary);
  font-weight: 540;
  white-space: nowrap;
}

.ai-tool-run-target {
  min-width: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--text-secondary) 84%, var(--text-tertiary));
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
}

.ai-tool-run-status {
  color: var(--text-quaternary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.ai-tool-run-fact {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 19px;
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
}

.ai-tool-detail-list {
  margin-top: 4px;
}

.ai-tool-detail-card {
  display: grid;
  gap: 10px;
  margin: 6px 0 0 11px;
  border-left: 1px solid color-mix(in srgb, var(--shell-divider) 68%, transparent);
  padding: 6px 0 4px 21px;
}

.ai-tool-detail-section {
  display: grid;
  gap: 4px;
}

.ai-tool-detail-section.is-warning .ai-tool-detail-heading,
.ai-tool-detail-section.is-warning .ai-tool-detail-point {
  color: color-mix(in srgb, var(--warning) 84%, var(--text-secondary));
}

.ai-tool-detail-section.is-danger .ai-tool-detail-heading,
.ai-tool-detail-section.is-danger .ai-tool-detail-point {
  color: color-mix(in srgb, var(--danger) 84%, var(--text-secondary));
}

.ai-tool-detail-heading {
  margin: 0;
  color: var(--text-quaternary);
  font-size: 11px;
  font-weight: 560;
  letter-spacing: 0.02em;
  line-height: 16px;
}

.ai-tool-detail-points {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-tool-detail-point {
  position: relative;
  min-width: 0;
  padding-left: 12px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 19px;
  unicode-bidi: plaintext;
  word-break: break-word;
}

.ai-tool-detail-point::before {
  position: absolute;
  top: 8px;
  left: 0;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-quaternary) 72%, transparent);
  content: '';
}

.ai-tool-detail-node {
  display: grid;
  min-width: 0;
  grid-template-columns: 24px minmax(0, 1fr);
  column-gap: 8px;
  padding: 2px 0;
}

.ai-tool-process-node {
  align-items: center;
}

.ai-tool-fact-rail {
  display: inline-flex;
  width: 24px;
  min-width: 24px;
  align-items: center;
  gap: 4px;
}

.ai-tool-fact-status,
.ai-tool-fact-topic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ai-tool-fact-status {
  color: var(--text-quaternary);
}

.ai-tool-fact-topic-icon {
  width: 12px;
  height: 12px;
  color: color-mix(in srgb, var(--text-quaternary) 78%, transparent);
  stroke-width: 2;
}

.ai-tool-run-timeline.is-running .ai-tool-tree-root-row {
  color: var(--text-primary);
}

.ai-tool-run-chevron {
  width: 13px;
  height: 13px;
  color: var(--text-quaternary);
  stroke-width: 2;
  transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-node-details[data-state='open']>.ai-tool-tree-row .ai-tool-run-chevron {
  transform: rotate(90deg);
}

.ai-tool-root-details>.ai-tool-collapsible-content {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition:
    grid-template-rows 180ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 120ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-root-details>.ai-tool-collapsible-content[data-state='closed'] {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
}

.ai-tool-collapsible-shell {
  min-height: 0;
  overflow: hidden;
}

.ai-tool-list-motion-enter-active {
  transition:
    transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

.ai-tool-list-motion-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.ai-tool-list-motion-move {
  transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

@media (hover: hover) and (pointer: fine) {

  .ai-tool-tree-root-row:hover,
  .ai-tool-phase-summary:hover,
  .ai-tool-run-summary:hover {
    background: color-mix(in srgb, var(--surface-hover) 42%, transparent);
    color: var(--text-primary);
  }
}

.ai-tool-tree-root-row:focus-visible,
.ai-tool-phase-summary:focus-visible,
.ai-tool-run-summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong) 46%, transparent);
  outline-offset: 2px;
}

@keyframes ai-tool-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {

  .ai-tool-fact-status-icon.is-spinning,
  .ai-tool-run-chevron,
  .ai-tool-root-details>.ai-tool-collapsible-content,
  .ai-tool-list-motion-enter-active,
  .ai-tool-list-motion-move {
    animation: none;
    transition: none;
  }

  .ai-tool-list-motion-enter-from {
    opacity: 1;
    transform: none;
  }
}
</style>
