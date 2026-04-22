/**
 * check-router-disabled.ts
 * 若 main.ts 中出现 app.use(router) 且无对应 ADR 登记 → fail（R-18.2.1 / R-18.2.3）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CheckResult, ROOT, printResult, summarize } from './guard-utils.js';

const MAIN_TS = path.join(ROOT, 'src/main.ts');
const ADR_ROUTER = path.join(ROOT, 'docs/architecture/ADR-0006-router-dormant.md');

const results: CheckResult[] = [];

if (!fs.existsSync(MAIN_TS)) {
    results.push({ severity: 'WARN', message: 'src/main.ts 不存在，跳过路由检查', file: 'src/main.ts' });
} else {
    const content = fs.readFileSync(MAIN_TS, 'utf-8');
    // 检测 app.use(router) 或 app.use(Router)
    const hasRouterUse = /app\s*\.\s*use\s*\(\s*router\s*\)/i.test(content);

    if (hasRouterUse) {
        // 检查是否有 ADR 覆盖（ADR-0006 或更新的 ADR）
        const adrExists = fs.existsSync(ADR_ROUTER);
        if (adrExists) {
            // 检查 ADR 状态是否 accepted
            const adrContent = fs.readFileSync(ADR_ROUTER, 'utf-8');
            const hasAccepted = /状态.*?accepted/i.test(adrContent);
            if (hasAccepted) {
                results.push({
                    severity: 'ERROR',
                    message: 'main.ts 中存在 app.use(router)，但 ADR-0006 决策为 router DORMANT（不注册）',
                    file: 'src/main.ts',
                    detail: '若确实需要启用路由，请新建 ADR 替代 ADR-0006 并经 Code Owner 批准',
                });
            } else {
                results.push({
                    severity: 'WARN',
                    message: 'main.ts 中存在 app.use(router)，关联 ADR 状态非 accepted，请确认',
                    file: 'src/main.ts',
                });
            }
        } else {
            results.push({
                severity: 'ERROR',
                message: 'main.ts 中存在 app.use(router)，但缺少 ADR 登记（R-18.2.3）',
                file: 'src/main.ts',
                detail: '启用路由前 MUST 先完成 ADR，经 Code Owner 批准',
            });
        }
    } else {
        results.push({
            severity: 'PASS',
            message: 'main.ts 中无 app.use(router)，路由保持休眠状态',
            file: 'src/main.ts',
        });
    }
}

results.forEach(printResult);
const hasError = summarize('check-router-disabled', results);
process.exit(hasError ? 1 : 0);
