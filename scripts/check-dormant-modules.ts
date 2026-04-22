/**
 * check-dormant-modules.ts
 * 扫描已标注为 dormant 的模块目录（R-18.2.2 / R-20.8.2）：
 * 1. 目录内 index.ts / index.js 顶部必须有 `@status: dormant` 注释
 * 2. 目录内必须有 README.md
 * 3. dormant 模块 MUST NOT 被业务代码 import（仅检查重要路径）
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CheckResult,
  ROOT,
  checkExemption,
  loadBaseline,
  printResult,
  summarize,
} from './guard-utils.js';

const exemptions = loadBaseline('dormant-modules');
const results: CheckResult[] = [];

/** 声明为 dormant 的目录列表 */
const DORMANT_DIRS = [{ dir: 'src/router', mainFile: 'index.ts' }];

for (const { dir, mainFile } of DORMANT_DIRS) {
  const absDir = path.join(ROOT, dir);
  const readmePath = path.join(absDir, 'README.md');
  const mainPath = path.join(absDir, mainFile);
  const relDir = dir;

  // 1. 检查 README 是否存在
  if (!fs.existsSync(readmePath)) {
    const { exempt, expired, entry } = checkExemption(
      exemptions,
      `${relDir}/${mainFile}`,
      'dormant-no-readme',
    );
    if (exempt) {
      results.push({
        severity: 'WARN',
        message: `dormant 模块缺少 README.md（豁免至 ${entry!.expiresAt}）`,
        file: `${relDir}/README.md`,
        detail: `ADR: ${entry!.adrRef}`,
      });
    } else if (expired && entry) {
      results.push({
        severity: 'ERROR',
        message: `dormant 模块缺少 README.md（豁免已到期 ${entry.expiresAt}）`,
        file: `${relDir}/README.md`,
      });
    } else {
      results.push({
        severity: 'ERROR',
        message: `dormant 模块缺少 README.md（R-18.2.2 / R-20.8.2）`,
        file: `${relDir}/README.md`,
      });
    }
  } else {
    results.push({
      severity: 'PASS',
      message: `dormant 模块有 README.md`,
      file: `${relDir}/README.md`,
    });
  }

  // 2. 检查主文件顶部是否有 @status: dormant
  if (fs.existsSync(mainPath)) {
    const content = fs.readFileSync(mainPath, 'utf-8');
    const firstLines = content.split('\n').slice(0, 5).join('\n');
    if (!/@status:\s*dormant/i.test(firstLines)) {
      const { exempt, entry } = checkExemption(
        exemptions,
        `${relDir}/${mainFile}`,
        'dormant-no-readme',
      );
      if (exempt) {
        results.push({
          severity: 'WARN',
          message: `dormant 模块主文件顶部缺少 @status: dormant 注释（豁免至 ${entry!.expiresAt}）`,
          file: `${relDir}/${mainFile}`,
        });
      } else {
        results.push({
          severity: 'ERROR',
          message: `dormant 模块主文件顶部缺少 @status: dormant 注释（R-20.8.2）`,
          file: `${relDir}/${mainFile}`,
          detail: '请在文件顶部第 1～3 行添加: // @status: dormant',
        });
      }
    } else {
      results.push({
        severity: 'PASS',
        message: `dormant 模块主文件含 @status: dormant 注释`,
        file: `${relDir}/${mainFile}`,
      });
    }
  }
}

// 3. 检查 dormant 模块是否被业务代码 import
const DORMANT_IMPORT_RE = /from\s+['"](?:@\/router|\.\.\/router|\.\.\/\.\.\/router)['"/]/g;
const SCAN_FOR_IMPORT: string[] = [
  'src/composables',
  'src/views',
  'src/layouts',
  'src/store',
  'src/services',
];

for (const scanDir of SCAN_FOR_IMPORT) {
  const absDir = path.join(ROOT, scanDir);
  if (!fs.existsSync(absDir)) continue;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') || entry.endsWith('.vue')) {
        const content = fs.readFileSync(full, 'utf-8');
        if (DORMANT_IMPORT_RE.test(content)) {
          const relPath = path.relative(ROOT, full).replace(/\\/g, '/');
          results.push({
            severity: 'ERROR',
            message: `业务代码 import 了 dormant router 模块（R-20.8.2）`,
            file: relPath,
            detail: 'dormant 模块 MUST NOT 被业务代码 import',
          });
        }
        DORMANT_IMPORT_RE.lastIndex = 0;
      }
    }
  };
  walk(absDir);
}

results.forEach(printResult);
const hasError = summarize('check-dormant-modules', results);
process.exit(hasError ? 1 : 0);
