/**
 * check-file-size.ts
 * 检查关键文件行数是否超过阈值（R-20.1.3 / R-20.1.4 / R-20.5.1 / R-20.6.3）
 *
 * 阈值：
 *   useWorkbench.ts           ≤ 400 行（总行数）
 *   useIntegratedTerminal.ts  ≤ 400 行（总行数，非终极目标但先设护栏）
 *   ShellWorkbenchView.vue    ≤ 120 行（<script setup> 行数）
 *   main.ts                  ≤ 120 行（内联 DOM 行数，此处用总行数近似）
 *   src-tauri/…/commands/mod.rs ≤ 80 行（见 rust-mod-size 守卫）
 */
import path from 'node:path';
import {
    CheckResult,
    ROOT,
    checkExemption,
    countLines,
    countScriptSetupLines,
    loadBaseline,
    printResult,
    summarize,
} from './guard-utils.js';

interface Rule {
    label: string;
    relPath: string;
    ruleId: string;
    limit: number;
    measure: (absPath: string) => number;
    unit: string;
}

const RULES: Rule[] = [
    {
        label: 'useWorkbench.ts 行数',
        relPath: 'src/composables/useWorkbench.ts',
        ruleId: 'max-lines-400',
        limit: 400,
        measure: countLines,
        unit: '行',
    },
    {
        label: 'useIntegratedTerminal.ts 行数',
        relPath: 'src/composables/useIntegratedTerminal.ts',
        ruleId: 'max-lines-composable',
        limit: 400,
        measure: countLines,
        unit: '行',
    },
    {
        label: 'ShellWorkbenchView.vue <script setup> 行数',
        relPath: 'src/views/ShellWorkbenchView.vue',
        ruleId: 'max-script-setup-120',
        limit: 120,
        measure: countScriptSetupLines,
        unit: '行',
    },
    {
        label: 'main.ts 行数',
        relPath: 'src/main.ts',
        ruleId: 'max-inline-dom-120',
        limit: 120,
        measure: countLines,
        unit: '行',
    },
];

const exemptions = loadBaseline('file-size');
const results: CheckResult[] = [];

for (const rule of RULES) {
    const absPath = path.join(ROOT, rule.relPath);
    const count = rule.measure(absPath);
    if (count <= rule.limit) {
        results.push({ severity: 'PASS', message: `${rule.label} = ${count}${rule.unit} ≤ ${rule.limit}`, file: rule.relPath });
    } else {
        const { exempt, expired, entry } = checkExemption(exemptions, rule.relPath, rule.ruleId);
        if (exempt) {
            results.push({
                severity: 'WARN',
                message: `${rule.label} = ${count}${rule.unit} > ${rule.limit}（豁免至 ${entry!.expiresAt}）`,
                file: rule.relPath,
                detail: `原因: ${entry!.reason} | ADR: ${entry!.adrRef} | 责任人: ${entry!.owner}`,
            });
        } else if (expired && entry) {
            results.push({
                severity: 'ERROR',
                message: `${rule.label} = ${count}${rule.unit} > ${rule.limit}（豁免已于 ${entry.expiresAt} 到期）`,
                file: rule.relPath,
                detail: `请立即整改或重新申请豁免（ADR: ${entry.adrRef}）`,
            });
        } else {
            results.push({
                severity: 'ERROR',
                message: `${rule.label} = ${count}${rule.unit} > ${rule.limit}（无豁免条目）`,
                file: rule.relPath,
                detail: `新增违规，请整改或在 scripts/baselines/file-size.json 登记豁免`,
            });
        }
    }
}

results.forEach(printResult);
const hasError = summarize('check-file-size', results);
process.exit(hasError ? 1 : 0);
