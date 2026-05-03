<script setup lang="ts">
import { computed, ref } from 'vue';

import { classifyRuntimeToolKind, normalizeRuntimeToolName, type TAiRuntimeToolKind } from '@/constants/ai-runtime-tools';
import type { TAgentRuntimeEvent } from '@/types/agent-sidecar';

const REASONING_SEGMENT_CHARS = 420;

interface ITreeNodeItem {
  id: string;
  kind: TAiRuntimeToolKind;
  action: string;
  tags: string[];
  tail?: string;
  isThinking?: boolean;
}

type TTimelineItem =
  | { type: 'line'; id: string; text: string; segments: string[]; isLong: boolean }
  | { type: 'muted'; id: string; text: string }
  | { type: 'tree'; id: string; nodes: ITreeNodeItem[] };

const props = defineProps<{
  events: TAgentRuntimeEvent[];
}>();

const collapsedReasoningMap = ref<Record<string, boolean>>({});

const splitReasoningSegments = (value: string): string[] => {
  const normalized = value.trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const segments: string[] = [];

  for (const paragraph of paragraphs) {
    const chars = Array.from(paragraph);

    if (chars.length <= REASONING_SEGMENT_CHARS) {
      segments.push(paragraph);
      continue;
    }

    let cursor = 0;
    while (cursor < chars.length) {
      segments.push(chars.slice(cursor, cursor + REASONING_SEGMENT_CHARS).join(''));
      cursor += REASONING_SEGMENT_CHARS;
    }
  }

  return segments;
};

const isReasoningCollapsed = (itemId: string): boolean =>
  Boolean(collapsedReasoningMap.value[itemId]);

const toggleReasoningCollapsed = (itemId: string): void => {
  collapsedReasoningMap.value = {
    ...collapsedReasoningMap.value,
    [itemId]: !isReasoningCollapsed(itemId),
  };
};

const clipTag = (value: string, limit = 96): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(normalized);

  if (chars.length <= limit) {
    return normalized;
  }

  return `${chars.slice(0, limit).join('')}...`;
};

const parsePreviewValue = (value: string | undefined): string[] => {
  if (!value || !value.trim()) {
    return [];
  }

  const normalized = value.trim();

  try {
    const parsed = JSON.parse(normalized) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const candidates = [
        'query',
        'path',
        'filePath',
        'pattern',
        'url',
        'command',
        'toolName',
        'includePattern',
      ];
      const tags = candidates
        .map((key) => {
          const valueAtKey = record[key];
          return typeof valueAtKey === 'string' ? clipTag(valueAtKey) : null;
        })
        .filter((valueAtKey): valueAtKey is string => Boolean(valueAtKey));

      if (tags.length > 0) {
        return tags;
      }
    }
  } catch {
    // 这里是原始文本预览，保持原样展示。
  }

  return [clipTag(normalized)];
};

const describeRunEvent = (event: TAgentRuntimeEvent): string | null => {
  switch (event.type) {
    case 'agent.run.started':
      return '已开始执行 Agent 流程';
    case 'agent.run.completed':
      return event.stopReason ? `Agent 执行完成（${event.stopReason}）` : 'Agent 执行完成';
    case 'agent.run.error':
      return `Agent 执行失败：${event.errorMessage}`;
    case 'agent.model.started':
      return event.projectedInputTokensAvailable
        ? `模型调用开始，预计输入 token：${event.projectedInputTokens ?? 0}`
        : '模型调用开始';
    case 'agent.model.completed':
      return event.ok
        ? `模型调用完成${event.stopReason ? `（${event.stopReason}）` : ''}`
        : `模型调用失败：${event.errorMessage ?? '未知错误'}`;
    case 'agent.text.delta':
      return null;
    case 'agent.message.added':
      return event.role ? `追加消息：${event.role}` : '已追加消息';
    case 'agent.tool.progress':
      return null;
    case 'agent.debug':
      return event.name ? `调试事件：${event.name}` : null;
    default:
      return null;
  }
};

const createToolNode = (event: Extract<TAgentRuntimeEvent, {
  type: 'agent.tool.started' | 'agent.tool.completed' | 'agent.tool.progress';
}>): ITreeNodeItem => {
  const kind = event.type === 'agent.tool.progress'
    ? 'thinking'
    : classifyRuntimeToolKind(event.toolName);

  if (event.type === 'agent.tool.progress') {
    return {
      id: event.id,
      kind,
      action: '工具执行中',
      tags: parsePreviewValue(event.dataPreview),
      isThinking: true,
    };
  }

  const toolName = normalizeRuntimeToolName(event.toolName);

  if (event.type === 'agent.tool.started') {
    return {
      id: event.id,
      kind,
      action: `开始调用 ${toolName}`,
      tags: [toolName, ...parsePreviewValue(event.inputPreview)].slice(0, 3),
      tail: '执行中',
    };
  }

  return {
    id: event.id,
    kind,
    action: `完成调用 ${toolName}`,
    tags: [toolName, ...parsePreviewValue(event.resultPreview)].slice(0, 3),
    tail: event.ok ? '成功' : `失败：${event.errorMessage ?? '未知错误'}`,
  };
};

const buildTimelineItems = (events: readonly TAgentRuntimeEvent[]): TTimelineItem[] => {
  const items: TTimelineItem[] = [];
  let toolNodesBuffer: ITreeNodeItem[] = [];

  const flushToolNodes = (): void => {
    if (toolNodesBuffer.length === 0) {
      return;
    }

    items.push({
      type: 'tree',
      id: `tree:${toolNodesBuffer[0]?.id ?? String(items.length)}`,
      nodes: toolNodesBuffer,
    });
    toolNodesBuffer = [];
  };

  for (const event of events) {
    if (event.type === 'agent.reasoning.delta') {
      flushToolNodes();
      const segments = splitReasoningSegments(event.text);
      items.push({
        type: 'line',
        id: `line:${event.id}`,
        text: event.text,
        segments,
        isLong: segments.length > 1,
      });
      continue;
    }

    if (
      event.type === 'agent.tool.started'
      || event.type === 'agent.tool.completed'
      || event.type === 'agent.tool.progress'
    ) {
      toolNodesBuffer.push(createToolNode(event));
      continue;
    }

    const message = describeRunEvent(event);
    if (message) {
      flushToolNodes();
      items.push({
        type: 'muted',
        id: `muted:${event.id}`,
        text: message,
      });
    }
  }

  flushToolNodes();

  return items;
};

const timelineItems = computed(() =>
  buildTimelineItems(props.events),
);
</script>

<template>
  <section v-if="timelineItems.length > 0" class="ai-runtime-timeline" aria-label="Agent 活动树">
    <template v-for="item in timelineItems" :key="item.id">
      <div v-if="item.type === 'line'" class="agent-line">
        <p v-for="(segment, segmentIndex) in (isReasoningCollapsed(item.id) ? item.segments.slice(0, 1) : item.segments)"
          :key="`${item.id}:segment:${segmentIndex}`" class="agent-line__segment">
          {{ segment }}
        </p>
        <button v-if="item.isLong" type="button" class="agent-line__toggle" @click="toggleReasoningCollapsed(item.id)">
          {{ isReasoningCollapsed(item.id) ? '展开全部推理' : '收起长推理' }}
        </button>
      </div>
      <p v-else-if="item.type === 'muted'" class="agent-line muted">{{ item.text }}</p>
      <div v-else class="activity-tree">
        <div v-for="node in item.nodes" :key="node.id" class="tree-node" :class="`${node.kind}-node`">
          <div class="node-icon" :class="{ thinking: node.isThinking }">
            <svg v-if="node.kind === 'search'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <svg v-else-if="node.kind === 'read'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            <svg v-else-if="node.kind === 'write'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
            <svg v-else-if="node.kind === 'git'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 12h8"></path>
              <path d="M12 8v8"></path>
            </svg>
            <svg v-else-if="node.kind === 'browser'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z">
              </path>
            </svg>
            <svg v-else-if="node.kind === 'terminal'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2"></rect>
              <path d="m7 9 3 3-3 3"></path>
              <line x1="13" y1="15" x2="17" y2="15"></line>
            </svg>
            <svg v-else-if="node.kind === 'thinking'" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <path d="M9 18h6"></path>
              <path d="M10 22h4"></path>
              <path d="M12 2a7 7 0 0 0-4 12.8V16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-1.2A7 7 0 0 0 12 2Z"></path>
            </svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 8v4"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </div>
          <div class="node-content">
            <span>{{ node.action }}</span>
            <span v-for="tag in node.tags" :key="`${node.id}:${tag}`" class="code-tag">{{ tag }}</span>
            <span v-if="node.tail">，{{ node.tail }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ai-runtime-timeline {
  flex: 0 0 auto;
  padding: 8px 12px 4px;
  color: #e5e7eb;
  font-size: 14px;
  line-height: 1.7;
}

.agent-line {
  margin: 0 0 8px;
  color: #e5e7eb;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-line__segment {
  margin: 0;
}

.agent-line__segment+.agent-line__segment {
  margin-top: 6px;
}

.agent-line__toggle {
  margin-top: 6px;
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, #1f2937 86%, transparent);
  padding: 2px 8px;
  color: #9ca3af;
  font-size: 12px;
  line-height: 18px;
}

.agent-line__toggle:hover {
  color: #d1d5db;
}

.agent-line.muted {
  margin: 3px 0 10px;
  color: #9ca3af;
  font-size: 13px;
}

.activity-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0 0 14px 12px;
}

.tree-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.tree-node::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 19px;
  bottom: -10px;
  width: 1px;
  background-color: #4b5563;
  z-index: 1;
}

.tree-node:last-child::before {
  display: none;
}

.node-icon {
  position: relative;
  z-index: 2;
  display: flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
}

.node-icon.thinking {
  animation: pulse 1.2s infinite alternate;
}

.node-content {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 1px;
  color: #e5e7eb;
}

.code-tag {
  display: inline-flex;
  max-width: min(560px, 72vw);
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 6px;
  background-color: #1f2937;
  padding: 2px 8px;
  color: #d1d5db;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.search-node .node-icon {
  color: #a78bfa;
}

.read-node .node-icon {
  color: #60a5fa;
}

.write-node .node-icon {
  color: #34d399;
}

.git-node .node-icon {
  color: #f87171;
}

.browser-node .node-icon {
  color: #38bdf8;
}

.terminal-node .node-icon {
  color: #fbbf24;
}

.task-node .node-icon,
.network-node .node-icon,
.diagram-node .node-icon,
.symbol-node .node-icon,
.python-node .node-icon,
.java-node .node-icon,
.memory-node .node-icon,
.thinking-node .node-icon,
.system-node .node-icon {
  color: #9ca3af;
}

@keyframes pulse {
  0% {
    opacity: 0.6;
  }

  100% {
    opacity: 1;
  }
}
</style>
