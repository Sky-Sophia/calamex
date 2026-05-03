import type { IAgentActivity, TAgentActivityEvent } from '@/types/agent-activity';
import type { IActivityNote, IAiToolCall } from '@/types/ai';
import { materializeAgentActivities } from '@/utils/agent-activity';
import {
    getActionKind,
    getToolDisplayName,
    type TToolActionKind,
} from '@/utils/agent-activity-inline-catalog';
import {
    formatElapsed,
    getDetailPreview,
    getTargetLeafLabel,
    getTargetSource,
    isFileLikeTarget,
    isMachinePreview,
    isUrlLike,
    normalizeText,
    parseTarget,
    stripTargetNoise,
    uniqueStrings,
} from '@/utils/agent-activity-inline-formatters';
import {
    sectionizeToolDetails,
    type IToolDetailSection,
} from '@/utils/agent-activity-inline-sections';

export interface IActivityFeedDiffSummary {
    additions: number;
    deletions: number;
}

export interface IActivityFeedNote {
    id: string;
    text: string;
    source: IActivityNote['source'];
    tone: IActivityNote['tone'];
    status?: IActivityNote['status'];
    trigger?: IActivityNote['trigger'];
}

export interface IActivityFeedRow {
    id: string;
    toolName: string;
    actionKind: TToolActionKind;
    sourceKind: IAgentActivity['kind'] | 'tool_call';
    status: IAiToolCall['status'];
    compactLine: string;
    target: string;
    durationLabel: string | null;
    diff: IActivityFeedDiffSummary | null;
    sections: IToolDetailSection[];
}

export interface IActivityFeedGroup {
    id: string;
    title: string;
    completedSteps: number;
    diff: IActivityFeedDiffSummary | null;
    status: IAiToolCall['status'];
    rows: IActivityFeedRow[];
}

export type TActivityFeedBlock =
    | {
        id: string;
        kind: 'assistant_note';
        note: IActivityFeedNote;
    }
    | {
        id: string;
        kind: 'action_group';
        group: IActivityFeedGroup;
    };

interface IActivityFeedEntryRow {
    kind: 'row';
    row: IActivityFeedRow;
}

interface IActivityFeedEntryNote {
    kind: 'note';
    note: IActivityFeedNote;
}

type TActivityFeedEntry = IActivityFeedEntryRow | IActivityFeedEntryNote;

interface IBuildActivityFeedOptions {
    toolCalls: readonly IAiToolCall[];
    activityText?: string;
    activityTrail?: readonly string[];
    activityNotes?: readonly IActivityNote[];
    activities?: readonly IAgentActivity[];
    activityEvents?: readonly TAgentActivityEvent[];
}

interface IRowSource {
    id: string;
    toolName: string;
    sourceKind: IAgentActivity['kind'] | 'tool_call';
    status: IAiToolCall['status'];
    actionKind: TToolActionKind;
    actionLabel: string;
    target: string;
    lineRange: string | null;
    preview: string | null;
    durationLabel: string | null;
    detailItems: string[];
    inputSummary?: string | null;
    outputSummary?: string | null;
    errorMessage?: string | null;
}

const TOOL_ACTION_LABELS: Record<TToolActionKind, string> = {
    read: '查看文件',
    fileSearch: '搜索文件',
    symbolSearch: '搜索符号',
    diagnose: '检查',
    patch: '生成 Patch',
    applyPatch: '应用编辑',
    execute: '运行命令',
    verify: '运行验证',
    git: '查看 Git 信息',
    knowledge: '处理知识图谱',
    reasoning: '任务规划',
    time: '获取时间',
    web: '联网搜索',
    webFetch: '读取网页',
    tree: '查看目录',
    unknown: '调用工具',
};

const ACTIVITY_STATUS_TO_TOOL_STATUS: Record<
    IAgentActivity['status'],
    IAiToolCall['status']
> = {
    pending: 'pending',
    running: 'running',
    success: 'succeeded',
    error: 'failed',
    cancelled: 'denied',
};

const DETAIL_SEPARATOR_PATTERN = /[:：]/u;
const DIFF_PLUS_MINUS_PATTERN = /\+(\d+)\s*-\s*(\d+)/u;
const DIFF_ADDITION_PATTERN = /(?:新增|增加|added?|additions?)\s*[:：]?\s*(\d+)/iu;
const DIFF_DELETION_PATTERN = /(?:删除|移除|deleted?|deletions?)\s*[:：]?\s*(\d+)/iu;
const RESULT_COUNT_PATTERN = /(\d+\s*个(?:结果|命中|文件|组件|变更|错误))/u;
const PASSED_RESULT_PATTERN = /(?:通过|success|passed)/iu;
const GENERIC_TREE_TARGETS = new Set(['查看目录', '项目结构']);

const parseStructuredDetail = (
    value: string,
): { label: string | null; value: string } => {
    const normalized = normalizeText(value);
    const separatorIndex = normalized.search(DETAIL_SEPARATOR_PATTERN);

    if (separatorIndex <= 0) {
        return {
            label: null,
            value: normalized,
        };
    }

    return {
        label: normalized.slice(0, separatorIndex),
        value: normalized.slice(separatorIndex + 1).trim(),
    };
};

const toCompactPathLabel = (value: string): string => {
    if (!value) {
        return value;
    }

    if (isUrlLike(value)) {
        try {
            return new URL(value).host || value;
        }
        catch {
            return value;
        }
    }

    if (!isFileLikeTarget(value)) {
        return value;
    }

    return value.split(/[\\/]/u).filter(Boolean).at(-1) ?? value;
};

const formatLineRangeText = (lineRange: string | null): string | null => {
    if (!lineRange) {
        return null;
    }

    const match = lineRange.match(/^L(\d+)(?:-(\d+))?$/u);
    if (!match?.[1]) {
        return lineRange;
    }

    return match[2]
        ? `行 ${match[1]} 到 ${match[2]}`
        : `第 ${match[1]} 行`;
};

const collectSourceStrings = (source: IRowSource): string[] => uniqueStrings([
    source.target,
    source.preview ?? '',
    source.inputSummary ?? '',
    source.outputSummary ?? '',
    source.errorMessage ?? '',
    ...source.detailItems,
]);

const extractDetailValue = (
    source: IRowSource,
    labels: readonly string[],
): string | null => {
    for (const item of source.detailItems) {
        const parsed = parseStructuredDetail(item);
        if (!parsed.label || !labels.includes(parsed.label)) {
            continue;
        }

        if (parsed.value && !isMachinePreview(parsed.value)) {
            return parsed.value;
        }
    }

    return null;
};

const extractDiffSummary = (source: IRowSource): IActivityFeedDiffSummary | null => {
    const joined = collectSourceStrings(source).join('\n');
    const plusMinusMatch = joined.match(DIFF_PLUS_MINUS_PATTERN);

    if (plusMinusMatch?.[1] && plusMinusMatch[2]) {
        return {
            additions: Number.parseInt(plusMinusMatch[1], 10),
            deletions: Number.parseInt(plusMinusMatch[2], 10),
        };
    }

    const additionsMatch = joined.match(DIFF_ADDITION_PATTERN);
    const deletionsMatch = joined.match(DIFF_DELETION_PATTERN);

    if (!additionsMatch?.[1] && !deletionsMatch?.[1]) {
        return null;
    }

    return {
        additions: additionsMatch?.[1] ? Number.parseInt(additionsMatch[1], 10) : 0,
        deletions: deletionsMatch?.[1] ? Number.parseInt(deletionsMatch[1], 10) : 0,
    };
};

const formatDiffSummary = (diff: IActivityFeedDiffSummary | null): string => {
    if (!diff || (!diff.additions && !diff.deletions)) {
        return '';
    }

    return ` +${diff.additions} -${diff.deletions}`;
};

const extractResultSummary = (source: IRowSource): string | null => {
    const joined = collectSourceStrings(source).join('\n');
    const countMatch = joined.match(RESULT_COUNT_PATTERN);

    if (countMatch?.[1]) {
        return countMatch[1];
    }

    if (PASSED_RESULT_PATTERN.test(joined)) {
        return '通过';
    }

    return null;
};

const quoteQuery = (value: string): string => `「${value}」`;

const buildCompactReadLine = (source: IRowSource): string => {
    const lineRangeText = formatLineRangeText(source.lineRange);
    const targetLabel = toCompactPathLabel(source.target);

    return lineRangeText
        ? `读取 ${targetLabel}，${lineRangeText}`
        : `读取 ${targetLabel}`;
};

const buildCompactSearchLine = (
    source: IRowSource,
    prefix: '搜索' | '联网搜索' | '读取网页' | '查看站点地图',
): string => {
    if (!extractDetailValue(source, ['搜索', '查询']) && source.lineRange && isFileLikeTarget(source.target)) {
        return buildCompactReadLine(source);
    }

    const query = extractDetailValue(source, ['搜索', '查询', '网址', '站点'])
        ?? source.target;
    const quoted = prefix === '读取网页' || isFileLikeTarget(query) || isUrlLike(query)
        ? query
        : quoteQuery(query);
    const result = extractResultSummary(source);
    const separator = quoted.startsWith('「') ? '' : ' ';

    return result ? `${prefix}${separator}${quoted}，${result}` : `${prefix}${separator}${quoted}`;
};

const buildCompactTreeLine = (source: IRowSource): string => {
    const target = toCompactPathLabel(source.target);

    return target && !GENERIC_TREE_TARGETS.has(target)
        ? `查看目录 ${target}`
        : '查看目录';
};

const resolveMutationVerb = (source: IRowSource): string => {
    switch (source.toolName) {
        case 'create_directory':
            return source.status === 'running' ? '正在创建目录' : '已创建目录';
        case 'move_file':
            return source.status === 'running' ? '正在移动' : '已移动';
        case 'delete_file':
            return source.status === 'running' ? '正在删除' : '已删除';
        case 'write_file':
            return source.status === 'running' ? '正在写入' : '已写入';
        case 'propose_patch':
            return source.status === 'running' ? '正在生成 Patch' : '已生成 Patch';
        default:
            return source.status === 'running' ? '正在应用编辑' : '已编辑';
    }
};

const buildCompactMutationLine = (source: IRowSource): string => {
    const verb = resolveMutationVerb(source);
    const target = toCompactPathLabel(source.target);
    const diff = formatDiffSummary(extractDiffSummary(source));
    const result = extractResultSummary(source);
    const suffix = diff || (result ? `，${result}` : '');

    return `${verb} ${target}${suffix}`;
};

const buildCompactCommandLine = (source: IRowSource): string => {
    const command = extractDetailValue(source, ['命令']) ?? source.target;
    const result = extractResultSummary(source);

    return result ? `运行 ${command}，${result}` : `运行 ${command}`;
};

const buildCompactGitLine = (source: IRowSource): string => {
    const result = extractResultSummary(source);

    if (source.toolName === 'git_status') {
        return result ? `查看 Git 状态，${result}` : '查看 Git 状态';
    }

    if (source.toolName === 'git_diff_unstaged') {
        return result ? `查看未暂存 diff，${result}` : '查看未暂存 diff';
    }

    if (source.toolName === 'git_diff_staged') {
        return result ? `查看已暂存 diff，${result}` : '查看已暂存 diff';
    }

    const scope = extractDetailValue(source, ['范围']) ?? source.target;

    return scope && scope !== 'Git 变更'
        ? `查看 Git ${scope}`
        : '查看 Git 信息';
};

const buildCompactTimeLine = (source: IRowSource): string => {
    const timezone = extractDetailValue(source, ['时区', '目标时区']) ?? source.target;
    const currentTime = extractDetailValue(source, ['当前时间']) ?? source.preview;

    if (currentTime && !isMachinePreview(currentTime)) {
        return `获取当前时间 ${timezone}，${currentTime}`;
    }

    return `获取当前时间 ${timezone}`;
};

const buildCompactUnknownLine = (source: IRowSource): string => {
    const target = source.target || source.actionLabel;

    return source.status === 'running'
        ? `正在处理 ${target}`
        : `${source.actionLabel} ${target}`;
};

const buildCompactLine = (source: IRowSource): string => {
    switch (source.actionKind) {
        case 'read':
            return buildCompactReadLine(source);
        case 'fileSearch':
        case 'symbolSearch':
            return buildCompactSearchLine(source, '搜索');
        case 'web':
            return buildCompactSearchLine(source, '联网搜索');
        case 'webFetch':
            return buildCompactSearchLine(source, '读取网页');
        case 'tree':
            return buildCompactTreeLine(source);
        case 'patch':
        case 'applyPatch':
            return buildCompactMutationLine(source);
        case 'execute':
        case 'verify':
            return buildCompactCommandLine(source);
        case 'git':
            return buildCompactGitLine(source);
        case 'time':
            return buildCompactTimeLine(source);
        default:
            return buildCompactUnknownLine(source);
    }
};

const buildToolRowSource = (toolCall: IAiToolCall): IRowSource => {
    const actionKind = getActionKind(toolCall.name);
    const actionLabel = getToolDisplayName(toolCall.name, TOOL_ACTION_LABELS[actionKind]);
    const parsedTarget = parseTarget(
        stripTargetNoise(getTargetSource(toolCall, TOOL_ACTION_LABELS[actionKind])),
    );
    const detailItems = uniqueStrings(toolCall.detailItems ?? [])
        .filter((item) => !isMachinePreview(item));

    return {
        id: toolCall.id,
        toolName: toolCall.name,
        sourceKind: 'tool_call',
        status: toolCall.status,
        actionKind,
        actionLabel,
        target: parsedTarget.target || TOOL_ACTION_LABELS[actionKind],
        lineRange: parsedTarget.lineRange,
        preview: getDetailPreview(toolCall.summary, parsedTarget.target, actionLabel),
        durationLabel: formatElapsed(toolCall.elapsedMs),
        detailItems: uniqueStrings([
            ...detailItems,
            getTargetLeafLabel(
                actionKind,
                parsedTarget.target,
                TOOL_ACTION_LABELS[actionKind],
                detailItems,
            ) ?? '',
            parsedTarget.lineRange ? `位置：${parsedTarget.lineRange}` : '',
        ]),
        inputSummary: parsedTarget.target,
        outputSummary: toolCall.summary,
    };
};

const inferActionKindFromActivity = (activity: IAgentActivity): TToolActionKind => {
    if (activity.kind === 'search') {
        const searchableText = [
            activity.title,
            activity.description ?? '',
            ...(activity.details ?? []).map((detail) => `${detail.label}：${detail.value}`),
        ].join(' ');

        return /联网|网页|站点|网址|URL|Tavily/iu.test(searchableText)
            ? 'web'
            : 'fileSearch';
    }

    if (activity.kind === 'read_file') {
        return /目录|项目结构|工作区/u.test(`${activity.title} ${activity.description ?? ''}`)
            ? 'tree'
            : 'read';
    }

    if (activity.kind === 'edit_file') {
        return 'applyPatch';
    }

    if (activity.kind === 'command') {
        return /git/iu.test(`${activity.title} ${activity.command?.command ?? ''}`)
            ? 'git'
            : 'execute';
    }

    return 'unknown';
};

const buildActivityRowSource = (activity: IAgentActivity): IRowSource => {
    const status = ACTIVITY_STATUS_TO_TOOL_STATUS[activity.status];
    const toolName = activity.tool?.name ?? activity.kind;
    const actionKind = activity.tool?.name
        ? getActionKind(toolName)
        : inferActionKindFromActivity(activity);
    const targetSource = normalizeText(
        activity.description ?? activity.inputSummary ?? activity.outputSummary ?? '',
    );
    const parsedTarget = parseTarget(targetSource);
    const detailItems = uniqueStrings((activity.details ?? [])
        .map((detail) => `${detail.label}：${detail.value}`)
        .filter((detail) => !isMachinePreview(detail)));

    return {
        id: activity.id,
        toolName,
        sourceKind: activity.kind,
        status,
        actionKind,
        actionLabel: activity.title,
        target: parsedTarget.target || activity.title,
        lineRange: parsedTarget.lineRange,
        preview: activity.outputSummary ?? activity.error?.message ?? null,
        durationLabel: formatElapsed(activity.durationMs),
        detailItems,
        inputSummary: activity.inputSummary ?? activity.description ?? null,
        outputSummary: activity.outputSummary ?? null,
        errorMessage: activity.error?.message ?? null,
    };
};

const buildRow = (source: IRowSource): IActivityFeedRow => {
    const diff = extractDiffSummary(source);

    return {
        id: source.id,
        toolName: source.toolName,
        actionKind: source.actionKind,
        sourceKind: source.sourceKind,
        status: source.status,
        compactLine: buildCompactLine(source),
        target: source.target,
        durationLabel: source.durationLabel,
        diff,
        sections: sectionizeToolDetails({
            toolLabel: source.actionLabel,
            status: source.status,
            statusDetail: source.actionLabel,
            target: source.target,
            lineRange: source.lineRange,
            durationLabel: source.durationLabel,
            preview: source.preview,
            leafItems: source.detailItems,
            inputSummary: source.inputSummary,
            outputSummary: source.outputSummary,
            errorMessage: source.errorMessage,
        }),
    };
};

const createFeedNote = (params: {
    id: string;
    text: string;
    source: IActivityNote['source'];
    tone: IActivityNote['tone'];
    status?: IActivityNote['status'];
    trigger?: IActivityNote['trigger'];
}): IActivityFeedNote | null => {
    const normalized = normalizeText(params.text);

    if (!normalized) {
        return null;
    }

    return {
        id: params.id,
        text: normalized,
        source: params.source,
        tone: params.tone,
        ...(params.status ? { status: params.status } : {}),
        ...(params.trigger ? { trigger: params.trigger } : {}),
    };
};

const resolveActivityEntries = (activities: readonly IAgentActivity[]): TActivityFeedEntry[] => {
    const root = activities.find((activity) => !activity.parentId) ?? null;

    if (!root) {
        return [];
    }

    const entries: TActivityFeedEntry[] = [];
    const childrenByParentId = new Map<string, IAgentActivity[]>();

    for (const activity of activities) {
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

    const appendNote = (
        id: string,
        text: string,
        source: IActivityNote['source'],
        tone: IActivityNote['tone'],
    ): void => {
        const note = createFeedNote({
            id,
            text,
            source,
            tone,
        });

        if (!note) {
            return;
        }

        const previous = entries.at(-1);
        if (previous?.kind === 'note' && normalizeText(previous.note.text) === note.text) {
            return;
        }

        entries.push({
            kind: 'note',
            note,
        });
    };

    appendNote(`${root.id}:title`, root.title, 'trail', 'progress');

    const walk = (parentId: string): void => {
        const children = childrenByParentId.get(parentId) ?? [];

        for (const child of children) {
            if (child.kind === 'reasoning_summary' || child.kind === 'llm') {
                appendNote(child.id, child.description ?? child.title, 'reasoning_summary', 'progress');
            }
            else {
                entries.push({
                    kind: 'row',
                    row: buildRow(buildActivityRowSource(child)),
                });
            }

            walk(child.id);
        }
    };

    walk(root.id);

    return entries;
};

const resolveFallbackEntries = (options: {
    toolCalls: readonly IAiToolCall[];
    activityText?: string;
    activityTrail?: readonly string[];
}): TActivityFeedEntry[] => {
    const entries: TActivityFeedEntry[] = [];
    const rowEntries: IActivityFeedEntryRow[] = options.toolCalls.map((toolCall) => ({
        kind: 'row',
        row: buildRow(buildToolRowSource(toolCall)),
    }));
    const normalizedActivityText = normalizeText(options.activityText ?? '');
    const shouldKeepActivityText = normalizedActivityText.length > 0
        && !rowEntries.some((entry) => normalizeText(entry.row.compactLine) === normalizedActivityText);
    const noteTexts = uniqueStrings([
        ...(shouldKeepActivityText ? [options.activityText?.trim() ?? ''] : []),
        ...(options.activityTrail ?? []),
    ]);

    for (const noteText of noteTexts) {
        const note = createFeedNote({
            id: `note:${noteText}`,
            text: noteText,
            source: 'trail',
            tone: 'progress',
        });

        if (!note) {
            continue;
        }

        entries.push({
            kind: 'note',
            note,
        });
    }

    for (const rowEntry of rowEntries) {
        entries.push(rowEntry);
    }

    return entries;
};

const matchesRelatedActionId = (row: IActivityFeedRow, relatedActionId: string): boolean =>
    row.id === relatedActionId || row.id.endsWith(`:${relatedActionId}`);

const injectActivityNotes = (
    entries: readonly TActivityFeedEntry[],
    activityNotes: readonly IActivityNote[],
): TActivityFeedEntry[] => {
    const visibleActivityNotes = activityNotes.filter((activityNote) => activityNote.source !== 'narrator');

    if (!visibleActivityNotes.length) {
        return [...entries];
    }

    const nextEntries = [...entries];
    const sortedNotes = [...visibleActivityNotes]
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((activityNote) => createFeedNote({
            id: activityNote.id,
            text: activityNote.text,
            source: activityNote.source,
            tone: activityNote.tone,
            status: activityNote.status,
            trigger: activityNote.trigger,
        }))
        .filter((note): note is IActivityFeedNote => Boolean(note));

    for (const note of sortedNotes) {
        const relatedActionIds = visibleActivityNotes.find((item) => item.id === note.id)?.relatedActionIds ?? [];
        const duplicateIndex = nextEntries.findIndex((entry) =>
            entry.kind === 'note' && normalizeText(entry.note.text) === note.text
        );

        if (duplicateIndex >= 0) {
            continue;
        }

        const insertIndex = relatedActionIds.length
            ? nextEntries.findIndex((entry) =>
                entry.kind === 'row' && relatedActionIds.some((relatedActionId) =>
                    matchesRelatedActionId(entry.row, relatedActionId)
                )
            )
            : -1;

        if (insertIndex >= 0) {
            nextEntries.splice(insertIndex, 0, {
                kind: 'note',
                note,
            });
            continue;
        }

        nextEntries.push({
            kind: 'note',
            note,
        });
    }

    return nextEntries;
};

const getGroupStatus = (rows: readonly IActivityFeedRow[]): IAiToolCall['status'] => {
    if (rows.some((row) => row.status === 'failed')) {
        return 'failed';
    }

    if (rows.some((row) => row.status === 'running')) {
        return 'running';
    }

    if (rows.some((row) => row.status === 'pending')) {
        return 'pending';
    }

    if (rows.some((row) => row.status === 'denied')) {
        return 'denied';
    }

    return 'succeeded';
};

const aggregateGroupDiff = (rows: readonly IActivityFeedRow[]): IActivityFeedDiffSummary | null => {
    let additions = 0;
    let deletions = 0;
    let hasDiff = false;

    for (const row of rows) {
        if (!row.diff) {
            continue;
        }

        additions += row.diff.additions;
        deletions += row.diff.deletions;
        hasDiff = true;
    }

    return hasDiff ? { additions, deletions } : null;
};

const buildGroupTitle = (rows: readonly IActivityFeedRow[]): {
    title: string;
    completedSteps: number;
    diff: IActivityFeedDiffSummary | null;
} => {
    const completedSteps = rows.filter((row) =>
        row.status === 'succeeded' || row.status === 'failed' || row.status === 'denied'
    ).length;
    const diff = aggregateGroupDiff(rows);
    const title = completedSteps > 0
        ? `已完成 ${completedSteps} 个步骤${formatDiffSummary(diff)}`
        : `正在进行 ${rows.length} 个步骤${formatDiffSummary(diff)}`;

    return {
        title,
        completedSteps,
        diff,
    };
};

const groupEntries = (entries: readonly TActivityFeedEntry[]): TActivityFeedBlock[] => {
    const blocks: TActivityFeedBlock[] = [];
    let currentRows: IActivityFeedRow[] = [];

    const flushGroup = (): void => {
        if (!currentRows.length) {
            return;
        }

        const firstRow = currentRows[0];
        if (!firstRow) {
            currentRows = [];
            return;
        }

        const { title, completedSteps, diff } = buildGroupTitle(currentRows);

        blocks.push({
            id: `group:${firstRow.id}`,
            kind: 'action_group',
            group: {
                id: `group:${firstRow.id}`,
                title,
                completedSteps,
                diff,
                status: getGroupStatus(currentRows),
                rows: currentRows,
            },
        });

        currentRows = [];
    };

    for (const entry of entries) {
        if (entry.kind === 'note') {
            flushGroup();
            blocks.push({
                id: entry.note.id,
                kind: 'assistant_note',
                note: entry.note,
            });
            continue;
        }

        currentRows.push(entry.row);
    }

    flushGroup();

    return blocks;
};

export const buildActivityFeedBlocks = (
    options: IBuildActivityFeedOptions,
): TActivityFeedBlock[] => {
    const resolvedActivities = options.activities?.length
        ? options.activities
        : options.activityEvents?.length
            ? materializeAgentActivities(options.activityEvents)
            : [];
    const baseEntries = resolvedActivities.length
        ? resolveActivityEntries(resolvedActivities)
        : resolveFallbackEntries(options);
    const entries = injectActivityNotes(baseEntries, options.activityNotes ?? []);

    return groupEntries(entries);
};