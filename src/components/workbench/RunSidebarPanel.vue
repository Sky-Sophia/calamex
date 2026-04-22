<script setup lang="ts">
import { useIntegratedTerminalControls } from '@/composables/useIntegratedTerminal';
import { useMessage } from '@/composables/useMessage';
import type {
    IActiveRunSummary,
    ICommandTemplate,
    IEditorDocument,
    IRunHistoryEntry,
    TExecutorKind,
} from '@/types/editor';
import { toErrorMessage } from '@/utils/error';
import { getExecutorLabel } from '@/utils/templates';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

type TSectionKey = 'configs' | 'quick' | 'templates' | 'history';
type TConfigAction = 'run' | 'open-terminal';
type TQuickAction = 'run' | 'stop' | 'open-terminal' | 'clear-history';
type TIconName = 'terminal' | 'monitor' | 'spark' | 'history' | 'trash' | 'plus';

interface IConfigRow {
    id: string;
    name: string;
    command: string;
    icon: TIconName;
    action: TConfigAction;
    disabled: boolean;
    running: boolean;
}

interface IQuickRow {
    id: string;
    name: string;
    command: string;
    icon: TIconName;
    action: TQuickAction;
    badge: string;
    disabled: boolean;
    running: boolean;
}

const props = defineProps<{
    document: IEditorDocument;
    hasActiveDocument: boolean;
    isDesktopRuntime: boolean;
    canRun: boolean;
    isRunning: boolean;
    hasRunArtifacts: boolean;
    activeRun: IActiveRunSummary | null;
    runHistory: IRunHistoryEntry[];
    commandTemplates: ICommandTemplate[];
    executor: TExecutorKind;
}>();

const emit = defineEmits<{
    run: [];
    'create-document': [];
    'open-terminal': [];
    'insert-template': [template: ICommandTemplate];
    'clear-run-history': [];
}>();

const message = useMessage();
const { interrupt, clearScreen } = useIntegratedTerminalControls();

const searchQuery = ref('');
const elapsedNow = ref(Date.now());
const collapsedSections = ref<Record<TSectionKey, boolean>>({
    configs: false,
    quick: false,
    templates: true,
    history: false,
});

let elapsedTimerId: number | null = null;

const executorLabel = computed(() => getExecutorLabel(props.executor));
const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());
const activeElapsedLabel = computed(() => {
    if (!props.activeRun) {
        return '';
    }

    return formatDuration(
        Math.max(0, elapsedNow.value - new Date(props.activeRun.startedAt).getTime()),
    );
});

const configRows = computed<IConfigRow[]>(() => {
    const currentScriptCommand = props.activeRun?.commandLine
        ?? (props.hasActiveDocument
            ? `${executorLabel.value} · 当前脚本`
            : '创建或打开脚本后即可运行');

    return [
        {
            id: 'current-script',
            name: props.hasActiveDocument ? props.document.name : '未打开脚本',
            command: currentScriptCommand,
            icon: 'terminal',
            action: 'run',
            disabled: !props.canRun && !props.isRunning,
            running: props.isRunning,
        },
        {
            id: 'terminal-session',
            name: '集成终端',
            command: props.isDesktopRuntime
                ? `${executorLabel.value} · 查看实时输出与交互会话`
                : '浏览器预览模式下不可用',
            icon: 'monitor',
            action: 'open-terminal',
            disabled: !props.isDesktopRuntime,
            running: false,
        },
    ];
});

const filteredConfigRows = computed(() => filterItems(configRows.value, normalizedSearchQuery.value, [
    'name',
    'command',
]));

const quickRows = computed<IQuickRow[]>(() => {
    const lastHistoryEntry = props.runHistory[0] ?? null;
    const runBadge = props.isRunning ? activeElapsedLabel.value || '进行中' : '执行';

    return [
        {
            id: 'quick-run',
            name: props.isRunning ? '停止' : '运行',
            command: props.isRunning
                ? '向终端发送中断信号'
                : props.hasActiveDocument
                    ? `执行 ${props.document.name}`
                    : '当前没有可执行脚本',
            icon: props.isRunning ? 'spark' : 'terminal',
            action: props.isRunning ? 'stop' : 'run',
            badge: runBadge,
            disabled: props.isRunning ? false : !props.canRun,
            running: props.isRunning,
        },
        {
            id: 'quick-terminal',
            name: '终端',
            command: '打开集成终端面板',
            icon: 'monitor',
            action: 'open-terminal',
            badge: '面板',
            disabled: !props.isDesktopRuntime,
            running: false,
        },
        {
            id: 'quick-history',
            name: '最近',
            command: lastHistoryEntry
                ? `${formatHistoryTime(lastHistoryEntry.finishedAt)} · ${lastHistoryEntry.documentName}`
                : '查看最近的运行记录',
            icon: 'history',
            action: 'open-terminal',
            badge: props.runHistory.length > 0 ? String(props.runHistory.length) : '0',
            disabled: false,
            running: false,
        },
        {
            id: 'quick-clear',
            name: '清空',
            command: '清理输出与运行历史',
            icon: 'trash',
            action: 'clear-history',
            badge: '重置',
            disabled: !props.hasRunArtifacts,
            running: false,
        },
    ];
});

const filteredQuickRows = computed(() => filterItems(quickRows.value, normalizedSearchQuery.value, [
    'name',
    'command',
    'badge',
]));

const filteredTemplates = computed(() =>
    filterItems(props.commandTemplates, normalizedSearchQuery.value, [
        'title',
        'description',
        'category',
    ]),
);

const filteredRunHistory = computed(() =>
    filterItems(props.runHistory, normalizedSearchQuery.value, [
        'documentName',
        'commandLine',
        'executorLabel',
    ]),
);

const startElapsedTimer = (): void => {
    if (elapsedTimerId !== null) {
        return;
    }

    elapsedNow.value = Date.now();
    elapsedTimerId = window.setInterval(() => {
        elapsedNow.value = Date.now();
    }, 1000);
};

const stopElapsedTimer = (): void => {
    if (elapsedTimerId === null) {
        return;
    }

    window.clearInterval(elapsedTimerId);
    elapsedTimerId = null;
};

watch(
    () => props.activeRun?.runId ?? null,
    (runId) => {
        if (runId) {
            startElapsedTimer();
            return;
        }

        stopElapsedTimer();
        elapsedNow.value = Date.now();
    },
    { immediate: true },
);

onBeforeUnmount(() => {
    stopElapsedTimer();
});

const toggleSection = (section: TSectionKey): void => {
    collapsedSections.value[section] = !collapsedSections.value[section];
};

const handleRun = (): void => {
    if (!props.canRun && !props.isRunning) {
        message.info('当前没有可执行脚本。');
        return;
    }

    emit('run');
};

const handleStop = async (): Promise<void> => {
    try {
        await interrupt();
        emit('open-terminal');
    } catch (error) {
        message.error(toErrorMessage(error, '停止运行失败'));
    }
};

const handleClearHistory = async (): Promise<void> => {
    emit('clear-run-history');

    try {
        await clearScreen();
    } catch {
        // 日志已清空，忽略终端清屏失败。
    }
};

const handleConfigAction = async (row: IConfigRow): Promise<void> => {
    if (row.disabled) {
        return;
    }

    if (row.action === 'open-terminal') {
        emit('open-terminal');
        return;
    }

    if (props.isRunning) {
        await handleStop();
        return;
    }

    handleRun();
};

const handleQuickAction = async (row: IQuickRow): Promise<void> => {
    if (row.disabled) {
        return;
    }

    switch (row.action) {
        case 'run':
            handleRun();
            return;
        case 'stop':
            await handleStop();
            return;
        case 'open-terminal':
            emit('open-terminal');
            return;
        case 'clear-history':
            await handleClearHistory();
            return;
    }
};

const handleTemplateClick = (template: ICommandTemplate): void => {
    emit('insert-template', template);
};

const handleHistoryClick = (): void => {
    emit('open-terminal');
};

function filterItems<T extends Record<string, unknown>>(
    items: T[],
    query: string,
    fields: string[],
): T[] {
    if (!query) {
        return items;
    }

    return items.filter((item) =>
        fields.some((field) => String(item[field] ?? '').toLowerCase().includes(query)),
    );
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1000) {
        return `${durationMs}ms`;
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

function formatHistoryTime(isoString: string): string {
    const target = new Date(isoString);
    if (Number.isNaN(target.getTime())) {
        return '未知时间';
    }

    const now = new Date();
    const hours = String(target.getHours()).padStart(2, '0');
    const minutes = String(target.getMinutes()).padStart(2, '0');

    if (target.toDateString() === now.toDateString()) {
        return `今天 ${hours}:${minutes}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (target.toDateString() === yesterday.toDateString()) {
        return `昨天 ${hours}:${minutes}`;
    }

    return `${target.getMonth() + 1}/${target.getDate()} ${hours}:${minutes}`;
}

function resolveHistoryExitLabel(entry: IRunHistoryEntry): string {
    if (entry.status === 'success' || entry.exitCode === null) {
        return '';
    }

    return `exit ${entry.exitCode}`;
}
</script>

<template>
    <section class="run-sidebar-shell" aria-label="运行侧边栏">
        <header class="run-sidebar-header">
            <div class="run-sidebar-title-row">
                <span class="run-sidebar-title">运行</span>

                <div class="run-sidebar-actions">
                    <button type="button" class="run-sidebar-icon-button" aria-label="新建脚本" title="新建脚本"
                        @click="emit('create-document')">
                        <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm" fill="none"
                            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                            aria-hidden="true">
                            <path d="M8 3.5v9" />
                            <path d="M3.5 8h9" />
                        </svg>
                    </button>

                    <button type="button" class="run-sidebar-icon-button" aria-label="打开终端" title="打开终端"
                        @click="emit('open-terminal')">
                        <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm" fill="none"
                            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                            aria-hidden="true">
                            <circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
                            <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
                            <circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none" />
                        </svg>
                    </button>
                </div>
            </div>

            <label class="run-sidebar-search" aria-label="搜索运行项">
                <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm" fill="none" stroke="currentColor"
                    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.5" />
                    <path d="M10.5 10.5L13.5 13.5" />
                </svg>
                <input v-model="searchQuery" type="text" placeholder="搜索配置…">
            </label>

            <div class="run-sidebar-progress" :class="{ 'is-active': isRunning }" aria-hidden="true">
                <div class="run-sidebar-progress-bar"></div>
            </div>
        </header>

        <div class="run-sidebar-scroll">
            <section class="run-sidebar-section" :class="{ 'is-collapsed': collapsedSections.configs }">
                <button type="button" class="run-sidebar-section-head" @click="toggleSection('configs')">
                    <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm run-sidebar-chevron"
                        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                        stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span>运行配置</span>
                    <span class="run-sidebar-count">{{ filteredConfigRows.length }}</span>
                </button>

                <div v-show="!collapsedSections.configs" class="run-sidebar-section-body">
                    <div v-if="filteredConfigRows.length === 0" class="run-sidebar-empty-state">
                        {{ normalizedSearchQuery ? '无匹配结果' : '暂无运行配置' }}
                    </div>

                    <div v-for="row in filteredConfigRows" :key="row.id" class="run-sidebar-row" :class="{
                        'is-running': row.running,
                        'is-disabled': row.disabled,
                    }" @click="void handleConfigAction(row)">
                        <span class="run-sidebar-row-icon">
                            <svg v-if="row.running" viewBox="0 0 16 16" class="run-sidebar-status-icon is-running"
                                fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="6" stroke="var(--accent-strong)" stroke-width="1.6" />
                                <circle cx="8" cy="8" r="2.4" fill="var(--accent-strong)" stroke="none" />
                            </svg>

                            <svg v-else-if="row.icon === 'monitor'" viewBox="0 0 16 16" class="run-sidebar-icon"
                                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                stroke-linejoin="round" aria-hidden="true">
                                <rect x="2.5" y="3.5" width="11" height="8" rx="1.5" />
                                <path d="M6 13h4" />
                            </svg>

                            <svg v-else viewBox="0 0 16 16" class="run-sidebar-icon" fill="none" stroke="currentColor"
                                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 5l2.5 2.5L3 10" />
                                <path d="M7.5 11h5.5" />
                            </svg>
                        </span>

                        <div class="run-sidebar-row-main">
                            <div class="run-sidebar-row-name">{{ row.name }}</div>
                            <div class="run-sidebar-row-sub mono-text">{{ row.command }}</div>
                        </div>

                        <span v-if="row.running && activeElapsedLabel" class="run-sidebar-elapsed mono-text">
                            {{ activeElapsedLabel }}
                        </span>

                        <button type="button" class="run-sidebar-row-action"
                            :class="row.running ? 'is-stop' : 'is-play'" :disabled="row.disabled"
                            :aria-label="row.running ? '停止' : row.action === 'open-terminal' ? '打开终端' : '运行'"
                            @click.stop="void handleConfigAction(row)">
                            <svg v-if="row.running" viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm"
                                fill="currentColor" aria-hidden="true">
                                <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1" />
                            </svg>

                            <svg v-else-if="row.action === 'open-terminal'" viewBox="0 0 16 16"
                                class="run-sidebar-icon run-sidebar-icon-sm" fill="none" stroke="currentColor"
                                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 5l2.5 2.5L3 10" />
                                <path d="M7.5 11h5.5" />
                            </svg>

                            <svg v-else viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm"
                                fill="currentColor" aria-hidden="true">
                                <path d="M5.5 3.5l7 4.5-7 4.5z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </section>

            <section class="run-sidebar-section" :class="{ 'is-collapsed': collapsedSections.quick }">
                <button type="button" class="run-sidebar-section-head" @click="toggleSection('quick')">
                    <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm run-sidebar-chevron"
                        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                        stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span>快速命令</span>
                </button>

                <div v-show="!collapsedSections.quick" class="run-sidebar-section-body">
                    <div v-if="filteredQuickRows.length === 0" class="run-sidebar-empty-state">
                        未找到匹配项
                    </div>

                    <div v-for="row in filteredQuickRows" :key="row.id" class="run-sidebar-row run-sidebar-quick-row"
                        :class="{
                            'is-running': row.running,
                            'is-disabled': row.disabled,
                        }" @click="void handleQuickAction(row)">
                        <span class="run-sidebar-row-icon">
                            <svg v-if="row.running" viewBox="0 0 16 16" class="run-sidebar-status-icon is-running"
                                fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="6" stroke="var(--accent-strong)" stroke-width="1.6" />
                                <circle cx="8" cy="8" r="2.4" fill="var(--accent-strong)" stroke="none" />
                            </svg>

                            <svg v-else-if="row.icon === 'history'" viewBox="0 0 16 16" class="run-sidebar-icon"
                                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                stroke-linejoin="round" aria-hidden="true">
                                <path d="M8 3.25a4.75 4.75 0 1 1-3.95 2.1" />
                                <path d="M3.5 3.25v3h3" />
                                <path d="M8 5.25v3l2 1.25" />
                            </svg>

                            <svg v-else-if="row.icon === 'trash'" viewBox="0 0 16 16" class="run-sidebar-icon"
                                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                stroke-linejoin="round" aria-hidden="true">
                                <path d="M2.5 4.5h11" />
                                <path d="M6 4.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                                <path d="M4.25 4.5l.7 8a1 1 0 0 0 1 .91h4.1a1 1 0 0 0 1-.91l.7-8" />
                            </svg>

                            <svg v-else-if="row.icon === 'monitor'" viewBox="0 0 16 16" class="run-sidebar-icon"
                                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                stroke-linejoin="round" aria-hidden="true">
                                <rect x="2.5" y="3.5" width="11" height="8" rx="1.5" />
                                <path d="M6 13h4" />
                            </svg>

                            <svg v-else-if="row.icon === 'spark'" viewBox="0 0 16 16" class="run-sidebar-icon"
                                fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                                stroke-linejoin="round" aria-hidden="true">
                                <path d="M9 2L4.5 8H8l-1 6 4.5-6H8l1-6z" />
                            </svg>

                            <svg v-else viewBox="0 0 16 16" class="run-sidebar-icon" fill="none" stroke="currentColor"
                                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M3 5l2.5 2.5L3 10" />
                                <path d="M7.5 11h5.5" />
                            </svg>
                        </span>

                        <span class="run-sidebar-quick-name">{{ row.name }}</span>
                        <span class="run-sidebar-quick-command mono-text">{{ row.command }}</span>

                        <button v-if="row.running" type="button" class="run-sidebar-row-action is-stop" aria-label="停止"
                            @click.stop="void handleQuickAction(row)">
                            <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm" fill="currentColor"
                                aria-hidden="true">
                                <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1" />
                            </svg>
                        </button>

                        <span v-else class="run-sidebar-kbd mono-text">{{ row.badge }}</span>
                    </div>
                </div>
            </section>

            <section class="run-sidebar-section" :class="{ 'is-collapsed': collapsedSections.templates }">
                <button type="button" class="run-sidebar-section-head" @click="toggleSection('templates')">
                    <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm run-sidebar-chevron"
                        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                        stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span>脚本模板</span>
                </button>

                <div v-show="!collapsedSections.templates" class="run-sidebar-section-body">
                    <div v-if="filteredTemplates.length === 0" class="run-sidebar-empty-state">
                        {{ normalizedSearchQuery ? '无匹配模板' : '暂无可用模板' }}
                    </div>

                    <div v-for="template in filteredTemplates" :key="template.id" class="run-sidebar-row"
                        @click="handleTemplateClick(template)">
                        <span class="run-sidebar-row-icon">
                            <svg viewBox="0 0 16 16" class="run-sidebar-icon" fill="none" stroke="currentColor"
                                stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M9 2L4.5 8H8l-1 6 4.5-6H8l1-6z" />
                            </svg>
                        </span>

                        <div class="run-sidebar-row-main">
                            <div class="run-sidebar-row-name">{{ template.title }}</div>
                            <div class="run-sidebar-template-desc">{{ template.description }}</div>
                        </div>

                        <span class="run-sidebar-template-add" aria-hidden="true">
                            <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm" fill="none"
                                stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M8 4v8" />
                                <path d="M4 8h8" />
                            </svg>
                        </span>
                    </div>
                </div>
            </section>

            <section class="run-sidebar-section" :class="{ 'is-collapsed': collapsedSections.history }">
                <button type="button" class="run-sidebar-section-head" @click="toggleSection('history')">
                    <svg viewBox="0 0 16 16" class="run-sidebar-icon run-sidebar-icon-sm run-sidebar-chevron"
                        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                        stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" />
                    </svg>
                    <span>历史记录</span>
                    <span class="run-sidebar-count">{{ filteredRunHistory.length }}</span>
                </button>

                <div v-show="!collapsedSections.history" class="run-sidebar-section-body">
                    <div v-if="filteredRunHistory.length === 0" class="run-sidebar-empty-state">
                        {{ normalizedSearchQuery ? '无匹配记录' : '暂无运行记录' }}
                    </div>

                    <div v-for="entry in filteredRunHistory" :key="entry.id" class="run-sidebar-history-row"
                        @click="handleHistoryClick()">
                        <span class="run-sidebar-history-status" :class="`is-${entry.status}`">
                            <svg v-if="entry.status === 'success'" viewBox="0 0 16 16" class="run-sidebar-status-icon"
                                fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="6" fill="var(--success)" stroke="none" />
                                <path d="M5.2 8.1l1.8 1.9L10.8 6" stroke="var(--panel-bg)" stroke-width="1.6"
                                    stroke-linecap="round" stroke-linejoin="round" />
                            </svg>

                            <svg v-else-if="entry.status === 'canceled'" viewBox="0 0 16 16"
                                class="run-sidebar-status-icon" fill="none" aria-hidden="true">
                                <circle cx="8" cy="8" r="5.5" stroke="var(--text-quaternary)" stroke-width="1.4" />
                                <path d="M5.5 5.5l5 5" stroke="var(--text-quaternary)" stroke-width="1.4"
                                    stroke-linecap="round" />
                            </svg>

                            <svg v-else viewBox="0 0 16 16" class="run-sidebar-status-icon" fill="none"
                                aria-hidden="true">
                                <circle cx="8" cy="8" r="6" fill="var(--danger)" stroke="none" />
                                <path d="M6 6l4 4M10 6l-4 4" stroke="var(--panel-bg)" stroke-width="1.6"
                                    stroke-linecap="round" />
                            </svg>
                        </span>

                        <div class="run-sidebar-history-name">{{ entry.documentName }}</div>
                        <div class="run-sidebar-history-command mono-text">{{ entry.commandLine }}</div>
                        <div class="run-sidebar-history-meta mono-text">
                            {{ formatDuration(entry.durationMs) }}
                            <span v-if="resolveHistoryExitLabel(entry)" class="run-sidebar-history-exit">
                                {{ resolveHistoryExitLabel(entry) }}
                            </span>
                        </div>
                        <div class="run-sidebar-history-time">{{ formatHistoryTime(entry.finishedAt) }}</div>
                    </div>
                </div>
            </section>
        </div>
    </section>
</template>

<style scoped>
.run-sidebar-shell {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    background: #0e0e10;
    color: var(--text-primary);
}

.run-sidebar-header {
    position: relative;
    padding: 12px 12px 8px;
    border-bottom: 1px solid var(--shell-divider);
}

.run-sidebar-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}

.run-sidebar-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
}

.run-sidebar-actions {
    display: flex;
    gap: 2px;
}

.run-sidebar-icon-button {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 4px;
    color: var(--text-tertiary);
    transition: background-color 140ms ease, color 140ms ease;
}

.run-sidebar-icon-button:hover {
    background: color-mix(in srgb, var(--surface-hover) 100%, transparent);
    color: var(--text-primary);
}

.run-sidebar-search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 10px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 85%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--panel-bg) 78%, transparent);
    color: var(--text-tertiary);
    transition: border-color 140ms ease, color 140ms ease, background-color 140ms ease;
}

.run-sidebar-search:focus-within {
    border-color: color-mix(in srgb, var(--accent-strong) 76%, transparent);
    color: var(--text-primary);
    background: color-mix(in srgb, var(--panel-bg) 88%, transparent);
}

.run-sidebar-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
}

.run-sidebar-search input::placeholder {
    color: var(--text-quaternary);
}

.run-sidebar-progress {
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 2px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 180ms ease;
}

.run-sidebar-progress.is-active {
    opacity: 1;
}

.run-sidebar-progress-bar {
    width: 40%;
    height: 100%;
    background: var(--accent-strong);
    animation: run-sidebar-progress-slide 1.4s ease-in-out infinite;
}

.run-sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0 8px;
}

.run-sidebar-scroll::-webkit-scrollbar {
    width: 6px;
}

.run-sidebar-scroll::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--shell-divider) 100%, transparent);
}

.run-sidebar-scroll::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--border-strong) 90%, transparent);
}

.run-sidebar-section {
    padding: 6px 0;
}

.run-sidebar-section-head {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    color: var(--text-tertiary);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    text-align: left;
}

.run-sidebar-section-head:hover {
    color: var(--text-primary);
}

.run-sidebar-section.is-collapsed .run-sidebar-chevron {
    transform: rotate(-90deg);
}

.run-sidebar-chevron {
    transition: transform 150ms ease;
}

.run-sidebar-count {
    margin-left: auto;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--panel-bg) 86%, transparent);
    color: var(--text-quaternary);
    font-size: 10px;
}

.run-sidebar-section-body {
    padding: 2px 4px;
}

.run-sidebar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 4px 8px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
}

.run-sidebar-row:hover {
    background: color-mix(in srgb, var(--surface-hover) 100%, transparent);
}

.run-sidebar-row.is-running {
    background: color-mix(in srgb, var(--accent-strong) 11%, transparent);
    box-shadow: inset 2px 0 0 var(--accent-strong);
}

.run-sidebar-row.is-disabled {
    opacity: 0.46;
    cursor: default;
}

.run-sidebar-row.is-disabled:hover {
    background: transparent;
}

.run-sidebar-row.is-disabled:hover .run-sidebar-row-icon {
    color: var(--text-tertiary);
}

.run-sidebar-row-icon {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
}

.run-sidebar-row:hover .run-sidebar-row-icon {
    color: var(--text-primary);
}

.run-sidebar-row-main {
    flex: 1;
    min-width: 0;
}

.run-sidebar-row-name,
.run-sidebar-history-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
}

.run-sidebar-row-sub,
.run-sidebar-template-desc,
.run-sidebar-history-command {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-quaternary);
}

.run-sidebar-template-desc {
    font-family: var(--font-sans);
}

.run-sidebar-elapsed,
.run-sidebar-history-meta {
    flex-shrink: 0;
    color: var(--accent-strong);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

.run-sidebar-row-action {
    display: grid;
    width: 20px;
    height: 20px;
    place-items: center;
    border-radius: 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.run-sidebar-row:hover .run-sidebar-row-action,
.run-sidebar-row.is-running .run-sidebar-row-action {
    opacity: 1;
}

.run-sidebar-row-action.is-play:hover {
    background: var(--accent-strong);
    color: var(--accent-foreground);
}

.run-sidebar-row-action.is-stop {
    color: var(--danger);
    opacity: 1;
}

.run-sidebar-row-action.is-stop:hover {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
}

.run-sidebar-row-action:disabled {
    opacity: 0.28 !important;
}

.run-sidebar-quick-row {
    padding-right: 10px;
}

.run-sidebar-quick-name {
    min-width: 42px;
    font-size: 12.5px;
    font-weight: 500;
}

.run-sidebar-quick-command {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-quaternary);
}

.run-sidebar-kbd {
    padding: 2px 5px;
    border: 1px solid color-mix(in srgb, var(--shell-divider) 85%, transparent);
    border-radius: 3px;
    background: color-mix(in srgb, var(--panel-bg) 86%, transparent);
    color: var(--text-tertiary);
    font-size: 10px;
    line-height: 1;
}

.run-sidebar-template-add {
    display: grid;
    width: 18px;
    height: 18px;
    place-items: center;
    color: var(--text-quaternary);
    opacity: 0;
    transition: opacity 120ms ease;
}

.run-sidebar-row:hover .run-sidebar-template-add {
    opacity: 1;
}

.run-sidebar-history-row {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 1px;
    padding: 6px 8px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 140ms ease;
}

.run-sidebar-history-row:hover {
    background: color-mix(in srgb, var(--surface-hover) 100%, transparent);
}

.run-sidebar-history-status {
    grid-column: 1;
    grid-row: 1 / span 2;
    align-self: center;
}

.run-sidebar-history-command {
    grid-column: 2;
    grid-row: 2;
}

.run-sidebar-history-meta {
    grid-column: 3;
    grid-row: 1;
    text-align: right;
    color: var(--text-tertiary);
}

.run-sidebar-history-time {
    grid-column: 3;
    grid-row: 2;
    text-align: right;
    color: var(--text-quaternary);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
}

.run-sidebar-history-exit {
    margin-left: 6px;
    color: var(--danger);
}

.run-sidebar-empty-state {
    padding: 14px 12px;
    color: var(--text-quaternary);
    font-size: 12px;
    text-align: center;
}

.run-sidebar-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}

.run-sidebar-icon-sm {
    width: 12px;
    height: 12px;
}

.run-sidebar-status-icon {
    display: block;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
}

.run-sidebar-status-icon.is-running {
    animation: run-sidebar-pulse 1.6s ease-in-out infinite;
}

@keyframes run-sidebar-progress-slide {
    0% {
        transform: translateX(-100%);
    }

    100% {
        transform: translateX(350%);
    }
}

@keyframes run-sidebar-pulse {

    0%,
    100% {
        opacity: 1;
    }

    50% {
        opacity: 0.55;
    }
}
</style>
