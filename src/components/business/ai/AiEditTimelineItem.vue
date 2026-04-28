<script setup lang="ts">
import type { IAiEditTimelineEntry } from '@/types/ai-edit';
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        entry: IAiEditTimelineEntry;
        canUndo?: boolean;
        canRestore?: boolean;
    }>(),
    {
        canUndo: false,
        canRestore: false,
    },
);

const emit = defineEmits<{
    undo: [entry: IAiEditTimelineEntry];
    restore: [entry: IAiEditTimelineEntry];
}>();

const timestampLabel = computed(() => {
    const source = props.entry.type === 'snapshot'
        ? props.entry.data.createdAt
        : props.entry.data.appliedAt;
    const parsed = Date.parse(source);
    if (!Number.isFinite(parsed)) {
        return '刚刚';
    }
    return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(parsed));
});

const kindLabel = computed(() => {
    if (props.entry.type === 'snapshot') {
        return props.entry.data.scope;
    }

    switch (props.entry.data.kind) {
        case 'create':
            return 'create';
        case 'delete':
            return 'delete';
        case 'rename':
            return 'rename';
        default:
            return 'modify';
    }
});

const title = computed(() => {
    if (props.entry.type === 'snapshot') {
        return props.entry.data.label;
    }
    return props.entry.data.path;
});

const subtitle = computed(() => {
    if (props.entry.type === 'snapshot') {
        return `${props.entry.data.fileRefs.length} files · ${props.entry.data.sizeBytes} bytes`;
    }

    const before = props.entry.data.bytesBefore ?? 0;
    const after = props.entry.data.bytesAfter ?? 0;
    return `${before} → ${after} bytes`;
});

const isUndoEnabled = computed(() => {
    if (props.entry.type !== 'operation') {
        return false;
    }

    return props.canUndo && Boolean(props.entry.data.sourceSnapshotId);
});
</script>

<template>
    <article class="ai-edit-timeline-item">
        <div class="ai-edit-timeline-item__meta">
            <span class="ai-edit-timeline-item__kind">{{ kindLabel }}</span>
            <time class="ai-edit-timeline-item__time">{{ timestampLabel }}</time>
        </div>
        <div class="ai-edit-timeline-item__body">
            <strong class="ai-edit-timeline-item__title">{{ title }}</strong>
            <p class="ai-edit-timeline-item__subtitle">{{ subtitle }}</p>
        </div>
        <div class="ai-edit-timeline-item__actions">
            <button v-if="entry.type === 'operation'" type="button" class="ai-edit-timeline-item__action"
                :disabled="!isUndoEnabled" @click="emit('undo', entry)">
                撤销
            </button>
            <button v-if="entry.type === 'snapshot'" type="button" class="ai-edit-timeline-item__action"
                :disabled="!canRestore" @click="emit('restore', entry)">
                恢复
            </button>
        </div>
    </article>
</template>

<style scoped>
.ai-edit-timeline-item {
    display: grid;
    gap: 8px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 80%, transparent);
    background: color-mix(in srgb, var(--shell-elevated) 72%, transparent);
    padding: 12px;
}

.ai-edit-timeline-item__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: 11px;
    text-transform: uppercase;
}

.ai-edit-timeline-item__kind {
    letter-spacing: 0.08em;
}

.ai-edit-timeline-item__body {
    display: grid;
    gap: 4px;
}

.ai-edit-timeline-item__title {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
}

.ai-edit-timeline-item__subtitle {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.5;
}

.ai-edit-timeline-item__actions {
    display: flex;
    gap: 8px;
}

.ai-edit-timeline-item__action {
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 82%, transparent);
    background: transparent;
    padding: 5px 10px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
}

.ai-edit-timeline-item__action:disabled {
    cursor: not-allowed;
    opacity: 0.42;
}
</style>