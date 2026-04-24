/**
 * check-router-disabled.ts
 * 若 main.ts 中出现 app.use(router) 且无对应 ADR 登记 → fail（R-18.2.1 / R-18.2.3）
 */
import fs from 'node:fs';
import path from 'node:path';
import { CheckResult, ROOT, printResult, summarize } from './guard-utils.js';

const MAIN_TS = path.join(ROOT, 'src/main.ts');
const ROUTER_INDEX = path.join(ROOT, 'src/router/index.ts');
const ADR_ROUTER_DORMANT = path.join(ROOT, 'docs/architecture/ADR-0006-router-dormant.md');
const ADR_ROUTER_ACTIVE = path.join(ROOT, 'docs/architecture/ADR-20260423-welcome-smil-svg.md');

const results: CheckResult[] = [];

const readFileIfExists = (filePath: string): string | null =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;

if (!fs.existsSync(MAIN_TS)) {
  results.push({
    severity: 'WARN',
    message: 'src/main.ts 不存在，跳过路由检查',
    file: 'src/main.ts',
  });
} else {
  const mainContent = fs.readFileSync(MAIN_TS, 'utf-8');
  const hasRouterUse = /app\s*\.\s*use\s*\(\s*router\s*\)/i.test(mainContent);
  const routerIndexContent = readFileIfExists(ROUTER_INDEX) ?? '';
  const routerHeader = routerIndexContent.split('\n').slice(0, 5).join('\n');
  const isRouterActive = /@status:\s*active/i.test(routerHeader);
  const activeAdrContent = readFileIfExists(ADR_ROUTER_ACTIVE);
  const hasAcceptedActiveAdr =
    activeAdrContent !== null &&
    (/Status.*accepted/i.test(activeAdrContent) || /状态.*accepted/i.test(activeAdrContent));

  if (hasRouterUse) {
    if (isRouterActive && hasAcceptedActiveAdr) {
      results.push({
        severity: 'PASS',
        message: 'main.ts 中存在 app.use(router)，且已由欢迎页 ADR 明确启用',
        file: 'src/main.ts',
      });
    } else if (fs.existsSync(ADR_ROUTER_DORMANT)) {
      const dormantAdrContent = fs.readFileSync(ADR_ROUTER_DORMANT, 'utf-8');
      const hasAcceptedDormantAdr = /状态\s*[:：]\s*`?accepted`?/i.test(dormantAdrContent);

      if (hasAcceptedDormantAdr) {
        results.push({
          severity: 'ERROR',
          message: 'main.ts 中存在 app.use(router)，但 ADR-0006 决策为 router DORMANT（不注册）',
          file: 'src/main.ts',
          detail: '若确实需要启用路由，请新建 ADR 替代 ADR-0006 并经 Code Owner 批准',
        });
      } else {
        results.push({
          severity: 'WARN',
          message: 'main.ts 中存在 app.use(router)，但启用 ADR 状态未确认 accepted，请检查',
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
  } else if (isRouterActive) {
    results.push({
      severity: 'WARN',
      message: 'router 已标记 active，但 main.ts 未注册 app.use(router)',
      file: 'src/main.ts',
    });
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
