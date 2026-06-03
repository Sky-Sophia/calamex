// scripts/wire-split.mjs —— 一次性脚本：把 useAiAssistant.ts 接上 4 个切片（可删）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = 'src/composables/ai';
const MAIN = join(ROOT, DIR, 'useAiAssistant.ts');
const SIBLINGS = [
    'useAiAssistant.attachments',
    'useAiAssistant.runtime-events',
    'useAiAssistant.stream',
    'useAiAssistant.patch',
];

if (!existsSync(MAIN)) {
    console.error(`找不到 ${MAIN}，请在仓库根目录运行`);
    process.exit(1);
}

const headRe =
    /^(export\s+)?(?:declare\s+)?(const|function|interface|type|class)\s+([A-Za-z0-9_$]+)/;

// 1) 从切片抽取：所有顶层声明名(删除集) + 导出名/是否类型(导入集)
const deleteNames = new Set();
const exportsByModule = new Map(); // './mod' -> [{name,isType}]
for (const mod of SIBLINGS) {
    const p = join(ROOT, DIR, `${mod}.ts`);
    if (!existsSync(p)) {
        console.error(`缺少切片 ${p}，请先 git pull`);
        process.exit(1);
    }
    const exps = [];
    for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = headRe.exec(line);
        if (!m) continue;
        const [, exported, kind, name] = m;
        deleteNames.add(name);
        if (exported) exps.push({ name, isType: kind === 'interface' || kind === 'type' });
    }
    exportsByModule.set(`./${mod}`, exps);
}

// 2) 删除主文件中的同名顶层块（按声明类型决定块结束）
let lines = readFileSync(MAIN, 'utf8').split('\n');
const notFound = new Set(deleteNames);
const removed = [];

const blockEnd = (startIdx) => {
    const kind = headRe.exec(lines[startIdx])[2];
    let depth = 0;
    let opened = false;
    for (let i = startIdx; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '(' || ch === '[' || ch === '{') {
                depth++;
                opened = true;
            } else if (ch === ')' || ch === ']' || ch === '}') {
                depth--;
            }
        }
        const t = lines[i].trimEnd();
        if (kind === 'const' || kind === 'type') {
            if (depth <= 0 && t.endsWith(';')) return i; // 语句以 ; 结束
        } else if (opened && depth <= 0) {
            return i; // interface/function/class 以闭合 } 结束
        }
    }
    return startIdx;
};

let changed = true;
while (changed) {
    changed = false;
    for (let i = 0; i < lines.length; i++) {
        const m = headRe.exec(lines[i]);
        if (!m || !deleteNames.has(m[3])) continue;
        const end = blockEnd(i);
        let start = i;
        while (start > 0 && /^\s*(\/\/|\/\*|\*|\*\/)/.test(lines[start - 1])) start--; // 吃掉前置注释
        let tail = end;
        if (lines[tail + 1] !== undefined && lines[tail + 1].trim() === '') tail++; // 吃掉后一个空行
        lines.splice(start, tail - start + 1);
        notFound.delete(m[3]);
        removed.push(m[3]);
        changed = true;
        break; // 重新扫描，避免索引错位
    }
}

// 3) 仍被引用的导出符号 -> 最小 import
const body = lines.join('\n');
const importStmts = [];
for (const [mod, exps] of exportsByModule) {
    const used = exps.filter((e) => new RegExp(`\\b${e.name}\\b`).test(body));
    if (!used.length) continue;
    const parts = used.map((e) => (e.isType ? `type ${e.name}` : e.name));
    importStmts.push(`import {\n  ${parts.join(',\n  ')},\n} from '${mod}';`);
}

// 4) 插入到第一个“保留的顶层声明”之前（即现有 import 之后）
if (!body.includes('// [auto-split imports]') && importStmts.length) {
    const block = ['// [auto-split imports]', ...importStmts, ''].join('\n');
    let at = lines.findIndex((l) => /^(export\s+)?(const|function|interface|type|class)\b/.test(l));
    if (at < 0) {
        let last = -1;
        lines.forEach((l, i) => {
            if (/^\s*import\b/.test(l) || /^\s*}\s*from\s+['"]/.test(l)) last = i;
        });
        at = last + 1;
    }
    lines.splice(at, 0, block);
}

// 5) 备份 + 写回
writeFileSync(`${MAIN}.bak`, readFileSync(MAIN));
writeFileSync(MAIN, lines.join('\n'));

console.log(`✅ 删除 ${removed.length} 个顶层块：\n  ${removed.sort().join(', ')}`);
if (notFound.size) {
    console.log(`ℹ️ 切片里有、但主文件没找到同名顶层声明（通常是切片的内部私有助手，主文件本来就没有，可忽略）：\n  ${[...notFound].sort().join(', ')}`);
}
console.log(`\n✅ 已插入 import：\n${importStmts.join('\n')}`);
console.log(`\n📦 备份：${DIR}/useAiAssistant.ts.bak`);
console.log(`\n⚠️ 若 useAiAssistant.ts 此前对外导出过 IAiConversationCheckpoint，手动补一行保留公开 API：`);
console.log(`  export type { IAiConversationCheckpoint } from './useAiAssistant.runtime-events';`);