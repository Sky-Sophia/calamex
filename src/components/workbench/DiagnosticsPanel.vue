<template>
    <section class="flex h-full min-h-0 flex-col bg-(--panel-bg)">
        <header class="flex items-center gap-2 border-b border-(--shell-divider) px-4 py-3.5">
            <h2 class="mr-auto truncate text-[13px] font-medium tracking-[-0.005em] text-(--text-primary)">
                ShellCheck 代码检查
            </h2>

            <Badge :variant="summaryBadgeVariant('error', errorCount)" :class="summaryBadgeClass(errorCount)">
                <span class="h-1.25 w-1.25 rounded-full" :class="summaryDotClass('error', errorCount)" />
                错误 {{ errorCount }}
            </Badge>

            <Badge :variant="summaryBadgeVariant('warning', warningCount)" :class="summaryBadgeClass(warningCount)">
                <span class="h-1.25 w-1.25 rounded-full" :class="summaryDotClass('warning', warningCount)" />
                警告 {{ warningCount }}
            </Badge>
        </header>

        <div v-if="!analysis.available" class="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
            <div
                class="w-full max-w-68 rounded-xl border border-[color-mix(in_srgb,var(--warning)_26%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,var(--panel-bg))] px-4 py-4">
                <div
                    class="flex items-center gap-2 text-[13px] font-medium text-[color-mix(in_srgb,var(--warning)_88%,white)]">
                    <span
                        class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[11px]">
                        !
                    </span>
                    ShellCheck 当前不可用
                </div>

                <p class="mt-3 text-[12.5px] leading-6 text-(--text-secondary)">
                    {{ analysis.message || '暂时无法返回诊断结果，请稍后重试。' }}
                </p>
            </div>
        </div>

        <div v-else-if="issueCards.length === 0" class="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
            <div class="flex max-w-60 flex-col items-center gap-3 text-center">
                <div
                    class="flex h-8 w-8 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--success)_32%,transparent)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[15px] text-(--success)">
                    ✓
                </div>

                <div class="space-y-1">
                    <p class="text-[13px] font-medium text-(--text-primary)">未发现错误或警告</p>
                    <p class="mono-text text-[11.5px] text-(--text-quaternary)">
                        {{ lastCheckedLabel }}
                    </p>
                </div>
            </div>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto">
            <article
v-for="item in issueCards" :key="item.key"
                class="group relative cursor-pointer border-b border-(--shell-divider) px-4 py-3 transition-colors duration-150 hover:bg-white/3"
                role="button" tabindex="0" :aria-label="`跳转到 L${item.line}`" @click="handleSelect(item)"
                @keydown.enter.prevent="handleSelect(item)" @keydown.space.prevent="handleSelect(item)">
                <span
class="absolute bottom-3.5 left-0 top-3.5 w-0.5 rounded-r-sm"
                    :class="issueRailClass(item.level)" />

                <div class="mb-1.5 flex items-center gap-2">
                    <Badge
:variant="severityBadgeVariant(item.level)"
                        class="rounded-md px-1.5 py-0 text-[10.5px] font-medium uppercase tracking-[0.04em]">
                        {{ severityLabel(item.level) }}
                    </Badge>
                    <span class="text-(--shell-divider)">·</span>
                    <span class="mono-text text-[11.5px] text-(--text-tertiary)">
                        {{ item.code }}
                    </span>
                    <span class="mono-text ml-auto text-[11px] text-(--text-quaternary)">L{{ item.line }}</span>
                </div>

                <p class="mb-2 text-[12.5px] leading-[1.55] text-(--text-primary)">
                    {{ item.message }}
                </p>

                <div
                    class="overflow-x-auto rounded-[5px] border border-white/6 bg-[color-mix(in_srgb,var(--app-bg)_88%,black)] px-2.5 py-1.5">
                    <div
v-if="item.isEmptyLine"
                        class="mono-text text-[11.5px] leading-5 text-[color-mix(in_srgb,var(--danger)_78%,white)]">
                        ~
                    </div>

                    <div
v-else
                        class="mono-text text-[11.5px] leading-5 text-[color-mix(in_srgb,var(--text-secondary)_88%,white)]">
                        <div
v-for="previewLine in item.previewLines" :key="previewLine.key"
                            class="min-w-max whitespace-pre">
                            <span
v-for="(fragment, index) in previewLine.fragments"
                                :key="`${previewLine.key}-${index}`"
                                :class="fragment.highlighted ? highlightClass(item.level) : undefined">{{ fragment.text
                                }}</span>
                        </div>
                    </div>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup lang="ts">
import { Badge } from '@/components/ui/badge';
import type {
    IAnalyzeScriptPayload,
    IScriptDiagnostic,
    TScriptDiagnosticSeverity,
} from '@/types/editor';
import { computed, ref, watch } from 'vue';

type TBadgeVariant = 'default' | 'secondary' | 'destructive' | 'warning' | 'success';

interface ISnippetFragment {
    text: string;
    highlighted: boolean;
}

interface ISnippetLine {
    key: string;
    fragments: ISnippetFragment[];
    isEmpty: boolean;
}

interface IDiagnosticCard extends IScriptDiagnostic {
    key: string;
    previewLines: ISnippetLine[];
    isEmptyLine: boolean;
}

const props = defineProps<{
    analysis: IAnalyzeScriptPayload;
    content: string;
    documentName: string;
}>();

const emit = defineEmits<{
    'select-diagnostic': [line: number, column: number];
}>();

const lastCheckedAt = ref(Date.now());

watch(
    () => props.analysis,
    () => {
        lastCheckedAt.value = Date.now();
    },
    { immediate: true },
);

const normalizedLines = computed(() =>
    props.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
);

const resolveFragmentBounds = (
    lineText: string,
    startColumn: number,
    endColumn: number,
): { startIndex: number; endIndex: number } => {
    if (lineText.length === 0) {
        return {
            startIndex: 0,
            endIndex: 0,
        };
    }

    const startIndex = Math.min(Math.max(startColumn - 1, 0), lineText.length - 1);
    const requestedEnd = endColumn > startColumn ? endColumn - 1 : startIndex + 1;
    const endIndex = Math.max(startIndex + 1, Math.min(requestedEnd, lineText.length));

    return {
        startIndex,
        endIndex,
    };
};

const resolvePreviewLines = (item: IScriptDiagnostic): ISnippetLine[] => {
    const startLine = Math.max(1, item.line);
    const endLine = Math.max(startLine, item.endLine);
    const previewLines: ISnippetLine[] = [];

    for (let currentLine = startLine; currentLine <= endLine; currentLine += 1) {
        const lineText = normalizedLines.value[currentLine - 1] ?? '';

        if (lineText.length === 0) {
            previewLines.push({
                key: `${item.code}-${currentLine}`,
                fragments: [{ text: '', highlighted: false }],
                isEmpty: true,
            });
            continue;
        }

        const startColumn = currentLine === startLine ? item.column : 1;
        const endColumn = currentLine === endLine ? item.endColumn : lineText.length + 1;
        const { startIndex, endIndex } = resolveFragmentBounds(lineText, startColumn, endColumn);
        const fragments: ISnippetFragment[] = [];

        if (startIndex > 0) {
            fragments.push({
                text: lineText.slice(0, startIndex),
                highlighted: false,
            });
        }

        fragments.push({
            text: lineText.slice(startIndex, endIndex),
            highlighted: true,
        });

        if (endIndex < lineText.length) {
            fragments.push({
                text: lineText.slice(endIndex),
                highlighted: false,
            });
        }

        previewLines.push({
            key: `${item.code}-${currentLine}`,
            fragments,
            isEmpty: false,
        });
    }

    return previewLines;
};

const issueCards = computed<IDiagnosticCard[]>(() =>
    props.analysis.diagnostics
        .filter((item) => item.level === 'error' || item.level === 'warning')
        .map((item) => {
            const previewLines = resolvePreviewLines(item);

            return {
                ...item,
                key: `${item.code}-${item.line}-${item.column}-${item.message}`,
                previewLines,
                isEmptyLine: previewLines.every((previewLine) => previewLine.isEmpty),
            };
        }),
);

const errorCount = computed(() => issueCards.value.filter((item) => item.level === 'error').length);

const warningCount = computed(
    () => issueCards.value.filter((item) => item.level === 'warning').length,
);

const lastCheckedLabel = computed(() => {
    const timeLabel = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(lastCheckedAt.value);

    return `last check · ${timeLabel}`;
});

const severityLabel = (level: TScriptDiagnosticSeverity): string => {
    switch (level) {
        case 'error':
            return '错误';
        case 'warning':
            return '警告';
        default:
            return '提示';
    }
};

const summaryBadgeVariant = (
    tone: 'error' | 'warning',
    count: number,
): TBadgeVariant => {
    if (count === 0) {
        return 'secondary';
    }

    return tone === 'error' ? 'destructive' : 'warning';
};

const summaryBadgeClass = (count: number): string => (count === 0 ? 'opacity-55' : '');

const summaryDotClass = (tone: 'error' | 'warning', count: number): string => {
    if (count === 0) {
        return 'bg-(--text-quaternary)';
    }

    return tone === 'error' ? 'bg-(--danger)' : 'bg-(--warning)';
};

const severityBadgeVariant = (level: TScriptDiagnosticSeverity): TBadgeVariant => {
    switch (level) {
        case 'error':
            return 'destructive';
        case 'warning':
            return 'warning';
        default:
            return 'default';
    }
};

const issueRailClass = (level: TScriptDiagnosticSeverity): string => {
    switch (level) {
        case 'error':
            return 'bg-(--danger)';
        case 'warning':
            return 'bg-(--warning)';
        default:
            return 'bg-(--text-quaternary)';
    }
};

const highlightClass = (level: TScriptDiagnosticSeverity): string => {
    switch (level) {
        case 'error':
            return 'rounded-[2px] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-[2px] text-[color-mix(in_srgb,var(--danger)_78%,white)]';
        case 'warning':
            return 'rounded-[2px] bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] px-[2px] text-[color-mix(in_srgb,var(--warning)_84%,white)]';
        default:
            return 'rounded-[2px] bg-white/8 px-[2px] text-(--text-primary)';
    }
};

const handleSelect = (item: IDiagnosticCard): void => {
    emit('select-diagnostic', item.line, item.column);
};
</script>