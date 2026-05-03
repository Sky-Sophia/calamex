import type { IAiToolCall } from '@/types/ai';
import { isMachinePreview, normalizeText, uniqueStrings } from '@/utils/agent-activity-inline-formatters';

export type TActivityDetailTone = 'default' | 'warning' | 'danger';

export interface IToolDetailSection {
    title: string;
    items: string[];
    tone?: TActivityDetailTone;
}

const INPUT_DETAIL_LABELS = new Set([
    '查询',
    '搜索',
    '范围',
    '文件',
    '目录',
    '路径',
    '目标',
    '网址',
    '站点',
    '命令',
    '时区',
    '源时间',
    '目标时区',
    '起始 URL',
    '搜索目录',
    '根目录',
    '来源',
]);

const RESULT_DETAIL_LABELS = new Set([
    '结果',
    '状态',
    '耗时',
    '当前时间',
    '统计',
    '提交哈希',
    '总大小',
    '文件数',
    '目录数',
    '大小',
    '行数',
]);

const CONCLUSION_DETAIL_LABELS = new Set([
    '结论',
    '对任务的影响',
    '下一步',
]);

const RISK_DETAIL_LABELS = new Set([
    '风险',
    '建议',
    '错误',
    '失败文件',
]);

const parseStructuredDetail = (value: string): { label: string | null; item: string } => {
    const normalized = normalizeText(value);
    const separatorIndex = normalized.search(/[:：]/u);

    if (separatorIndex <= 0) {
        return {
            label: null,
            item: normalized,
        };
    }

    return {
        label: normalized.slice(0, separatorIndex),
        item: normalized,
    };
};

interface ISectionizeToolDetailsOptions {
    toolLabel: string;
    status: IAiToolCall['status'];
    statusDetail: string;
    target: string;
    lineRange: string | null;
    durationLabel: string | null;
    preview: string | null;
    leafItems: readonly string[];
    inputSummary?: string | null;
    outputSummary?: string | null;
    errorMessage?: string | null;
}

export const sectionizeToolDetails = (options: ISectionizeToolDetailsOptions): IToolDetailSection[] => {
    const inputItems: string[] = [];
    const resultItems: string[] = [];
    const evidenceItems: string[] = [];
    const conclusionItems: string[] = [];
    const riskItems: string[] = [];

    if (options.inputSummary && options.inputSummary !== options.target) {
        inputItems.push(options.inputSummary);
    }

    if (options.target && !isMachinePreview(options.target)) {
        inputItems.push(`目标：${options.target}`);
    }

    if (options.outputSummary && !isMachinePreview(options.outputSummary)) {
        resultItems.push(`结果：${options.outputSummary}`);
    }

    if (options.preview && !isMachinePreview(options.preview)) {
        resultItems.push(`摘要：${options.preview}`);
    }

    if (options.lineRange) {
        evidenceItems.push(`位置：${options.lineRange}`);
    }

    for (const rawItem of options.leafItems) {
        const detail = parseStructuredDetail(rawItem);

        if (detail.label && INPUT_DETAIL_LABELS.has(detail.label)) {
            inputItems.push(detail.item);
            continue;
        }

        if (detail.label && RESULT_DETAIL_LABELS.has(detail.label)) {
            resultItems.push(detail.item);
            continue;
        }

        if (detail.label && CONCLUSION_DETAIL_LABELS.has(detail.label)) {
            conclusionItems.push(detail.item);
            continue;
        }

        if (detail.label && RISK_DETAIL_LABELS.has(detail.label)) {
            riskItems.push(detail.item);
            continue;
        }

        evidenceItems.push(detail.item);
    }

    if (options.durationLabel) {
        resultItems.push(`耗时：${options.durationLabel}`);
    }

    if (!resultItems.length) {
        resultItems.push(`状态：${options.statusDetail}`);
    }

    if (options.errorMessage) {
        riskItems.unshift(`错误：${options.errorMessage}`);
    }

    const sections: IToolDetailSection[] = [
        {
            title: '工具',
            items: [options.toolLabel],
        },
        {
            title: '输入摘要',
            items: uniqueStrings(inputItems),
        },
        {
            title: '结果摘要',
            items: uniqueStrings(resultItems),
        },
        {
            title: '关键证据',
            items: uniqueStrings(evidenceItems),
        },
        {
            title: '结论',
            items: uniqueStrings(conclusionItems),
        },
        {
            title: '风险与错误',
            items: uniqueStrings(riskItems),
            tone: options.errorMessage || options.status === 'failed' ? 'danger' : 'warning',
        },
    ];

    return sections.filter((section) => section.items.length > 0);
};