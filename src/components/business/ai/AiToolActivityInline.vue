<script setup lang="ts">
import {
  Activity,
  CircleAlert,
  CircleCheck,
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
import { computed } from 'vue';
import type { Component } from 'vue';

import type { IAiToolCall } from '@/types/ai';

const props = defineProps<{
  toolCalls: IAiToolCall[];
}>();

type TToolActionKind =
  | 'read'
  | 'search'
  | 'diagnose'
  | 'patch'
  | 'applyPatch'
  | 'execute'
  | 'verify'
  | 'git'
  | 'web'
  | 'tree'
  | 'unknown';

interface IToolActionMeta {
  label: string;
  fallbackTarget: string;
  icon: Component;
}

interface IToolActivityItem extends IAiToolCall {
  actionLabel: string;
  statusLabel: string;
  target: string;
  lineRange: string | null;
  rowLabel: string;
  toolIcon: Component;
  statusIcon: Component;
  isSpinning: boolean;
}

const TOOL_ACTION_BY_NAME: Record<string, TToolActionKind> = {
  read_current_file: 'read',
  read_selected_text: 'read',
  read_file: 'read',
  read_project_file: 'read',
  list_open_files: 'read',
  list_project_files: 'tree',
  get_package_scripts: 'read',
  get_test_targets: 'read',
  get_terminal_log: 'read',
  search_files: 'search',
  search_text: 'search',
  search_symbols: 'search',
  search_project_files: 'search',
  get_diagnostics: 'diagnose',
  get_git_diff: 'git',
  get_project_tree: 'tree',
  web_search: 'web',
  web_fetch: 'web',
  propose_patch: 'patch',
  auto_apply_patch: 'applyPatch',
  write_file: 'applyPatch',
  delete_file: 'execute',
  run_test: 'verify',
  run_command: 'execute',
  run_shell_command: 'execute',
  install_package: 'execute',
  stage_file: 'git',
  create_commit: 'git',
  git_commit: 'git',
};

const TOOL_ACTION_META: Record<TToolActionKind, IToolActionMeta> = {
  read: {
    label: '读取',
    fallbackTarget: '文件',
    icon: FileText,
  },
  search: {
    label: '搜索',
    fallbackTarget: '项目',
    icon: Search,
  },
  diagnose: {
    label: '诊断',
    fallbackTarget: '工作区',
    icon: Activity,
  },
  patch: {
    label: '生成 Patch',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  applyPatch: {
    label: '应用 Patch',
    fallbackTarget: '变更',
    icon: Pencil,
  },
  execute: {
    label: '执行',
    fallbackTarget: '命令',
    icon: Terminal,
  },
  verify: {
    label: '验证',
    fallbackTarget: '测试',
    icon: Terminal,
  },
  git: {
    label: 'Git',
    fallbackTarget: '变更',
    icon: GitBranch,
  },
  web: {
    label: '网页',
    fallbackTarget: '资源',
    icon: Globe,
  },
  tree: {
    label: '读取目录',
    fallbackTarget: '项目结构',
    icon: FolderTree,
  },
  unknown: {
    label: '工具',
    fallbackTarget: '调用',
    icon: Activity,
  },
};

const TOOL_STATUS_META: Record<IAiToolCall['status'], { label: string; icon: Component }> = {
  pending: {
    label: '等待中',
    icon: Clock3,
  },
  running: {
    label: '进行中',
    icon: LoaderCircle,
  },
  succeeded: {
    label: '已完成',
    icon: CircleCheck,
  },
  failed: {
    label: '失败',
    icon: CircleAlert,
  },
  denied: {
    label: '已取消',
    icon: XCircle,
  },
};

const STATUS_PREFIX_PATTERN =
  /^(?:正在|已|等待|调用失败|已拒绝|Agent\s*)\s*(?:读取|搜索|加载|使用|应用|生成|验证|执行|运行|检索|分析|暂存|提交|调用|完成)?\s*[：:，,]?\s*/u;

const GENERIC_TARGET_PREFIX_PATTERN =
  /^(?:当前文件|当前选区|项目内容|文件名|符号|诊断|Git\s*变更|终端日志|网页|Patch|测试|命令|Git\s*暂存|Git\s*提交|文件|打开文件|package scripts|测试目标|工作区)\s*[：:，,]?\s*/iu;

const getActionKind = (toolName: string): TToolActionKind =>
  TOOL_ACTION_BY_NAME[toolName] ?? 'unknown';

const normalizeTargetText = (value: string): string =>
  value
    .replace(/…+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();

const stripTargetNoise = (value: string): string => {
  const withoutStatus = normalizeTargetText(value).replace(STATUS_PREFIX_PATTERN, '').trim();
  const withoutGenericPrefix = withoutStatus.replace(GENERIC_TARGET_PREFIX_PATTERN, '').trim();

  return withoutGenericPrefix || withoutStatus;
};

const isUrlLike = (value: string): boolean => /^https?:\/\//iu.test(value);

const isFileLikeTarget = (value: string): boolean =>
  /[\\/]/u.test(value) || /\.[a-z0-9]{1,12}(?::|#L|\s*$)/iu.test(value);

const formatLineRange = (start: string, end: string | undefined): string =>
  end && end !== start ? `L${start}-${end}` : `L${start}`;

const parseTarget = (value: string): { target: string; lineRange: string | null } => {
  const target = normalizeTargetText(value);

  if (!target || isUrlLike(target)) {
    return {
      target,
      lineRange: null,
    };
  }

  const hashLineMatch = target.match(/^(.+?)#L(\d+)(?:-L?(\d+))?$/u);
  if (hashLineMatch?.[1] && hashLineMatch[2] && isFileLikeTarget(hashLineMatch[1])) {
    return {
      target: hashLineMatch[1].trim(),
      lineRange: formatLineRange(hashLineMatch[2], hashLineMatch[3]),
    };
  }

  const colonLineMatch = target.match(/^(.+):(\d+)(?:-(\d+))?$/u);
  if (colonLineMatch?.[1] && colonLineMatch[2] && isFileLikeTarget(colonLineMatch[1])) {
    return {
      target: colonLineMatch[1].trim(),
      lineRange: formatLineRange(colonLineMatch[2], colonLineMatch[3]),
    };
  }

  return {
    target,
    lineRange: null,
  };
};

const getPreviewSource = (toolCall: IAiToolCall, fallbackTarget: string): string =>
  toolCall.targetPreview?.trim() || toolCall.summary.trim() || fallbackTarget;

const buildActivityItem = (toolCall: IAiToolCall): IToolActivityItem => {
  const actionMeta = TOOL_ACTION_META[getActionKind(toolCall.name)];
  const statusMeta = TOOL_STATUS_META[toolCall.status];
  const parsedTarget = parseTarget(stripTargetNoise(getPreviewSource(toolCall, actionMeta.fallbackTarget)));
  const target = parsedTarget.target || actionMeta.fallbackTarget;
  const rowLabel = `${statusMeta.label}，${actionMeta.label}：${target}${
    parsedTarget.lineRange ? `，${parsedTarget.lineRange}` : ''
  }`;

  return {
    ...toolCall,
    actionLabel: actionMeta.label,
    statusLabel: statusMeta.label,
    target,
    lineRange: parsedTarget.lineRange,
    rowLabel,
    toolIcon: actionMeta.icon,
    statusIcon: statusMeta.icon,
    isSpinning: toolCall.status === 'running',
  };
};

const items = computed(() => props.toolCalls.map(buildActivityItem));
</script>

<template>
  <section v-if="items.length" class="ai-tool-activity-inline" aria-label="工具调用时间线">
    <ol class="ai-tool-activity-list">
      <li
        v-for="item in items"
        :key="item.id"
        class="ai-tool-activity-item"
        :class="`is-${item.status}`"
      >
        <span class="ai-tool-activity-rail" aria-hidden="true">
          <component
            :is="item.statusIcon"
            class="ai-tool-status-icon"
            :class="{ 'is-spinning': item.isSpinning }"
          />
        </span>
        <span class="ai-tool-activity-row" :title="item.rowLabel" :aria-label="item.rowLabel">
          <component :is="item.toolIcon" class="ai-tool-kind-icon" aria-hidden="true" />
          <span class="ai-tool-action">{{ item.actionLabel }}</span>
          <span class="ai-tool-target">{{ item.target }}</span>
          <span v-if="item.lineRange" class="ai-tool-range">{{ item.lineRange }}</span>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.ai-tool-activity-inline {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.ai-tool-activity-list {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-tool-activity-item {
  position: relative;
  display: grid;
  min-width: 0;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 6px;
  color: var(--text-tertiary);
}

.ai-tool-activity-item::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 8px;
  width: 1px;
  background: color-mix(in srgb, var(--shell-divider) 70%, transparent);
  content: '';
}

.ai-tool-activity-item:first-child::before {
  top: 14px;
}

.ai-tool-activity-item:last-child::before {
  bottom: calc(100% - 14px);
}

.ai-tool-activity-item:only-child::before {
  display: none;
}

.ai-tool-activity-rail {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: center;
}

.ai-tool-status-icon {
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: var(--surface-base);
  color: var(--text-quaternary);
  stroke-width: 2;
}

.ai-tool-status-icon.is-spinning {
  animation: ai-tool-status-spin 900ms linear infinite;
  color: var(--text-secondary);
}

.ai-tool-activity-row {
  display: flex;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  color: inherit;
  padding: 3px 6px;
}

.ai-tool-kind-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--text-quaternary);
  stroke-width: 1.9;
}

.ai-tool-action {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-weight: 500;
}

.ai-tool-target {
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  text-overflow: ellipsis;
  unicode-bidi: plaintext;
  white-space: nowrap;
}

.ai-tool-range {
  flex: 0 0 auto;
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface-soft) 86%, transparent);
  color: var(--text-quaternary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  padding: 0 4px;
}

.ai-tool-activity-item.is-running {
  color: var(--text-secondary);
}

.ai-tool-activity-item.is-running .ai-tool-activity-row {
  background: color-mix(in srgb, var(--surface-soft) 58%, transparent);
}

.ai-tool-activity-item.is-succeeded .ai-tool-status-icon {
  color: var(--success);
}

.ai-tool-activity-item.is-failed .ai-tool-status-icon,
.ai-tool-activity-item.is-failed .ai-tool-action {
  color: var(--danger);
}

.ai-tool-activity-item.is-denied,
.ai-tool-activity-item.is-pending {
  color: var(--text-quaternary);
}

.ai-tool-activity-item.is-denied .ai-tool-status-icon {
  color: var(--text-quaternary);
}

@media (hover: hover) and (pointer: fine) {
  .ai-tool-activity-row:hover {
    background: color-mix(in srgb, var(--surface-hover) 72%, transparent);
  }
}

@keyframes ai-tool-status-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-tool-status-icon.is-spinning {
    animation: none;
  }
}
</style>
