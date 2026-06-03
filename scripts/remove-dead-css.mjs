// scripts/remove-dead-css.mjs
// 预览：node scripts/remove-dead-css.mjs        实际写入：node scripts/remove-dead-css.mjs --write
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const WRITE = process.argv.includes('--write');
const CSS_DIRS = [join(ROOT, 'src/styles'), join(ROOT, 'src/assets/css')];
const SRC_DIRS = [join(ROOT, 'src'), join(ROOT, 'src-tauri')];
const SRC_EXT = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.html', '.rs']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'target']);
const THIRD_PARTY = ['xterm-', 'cm-', 'reka-', 'radix-'];

const walk = (dir, ok, out = []) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, ok, out); }
        else if (ok(p)) out.push(p);
    }
    return out;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cssFiles = CSS_DIRS.flatMap((d) => walk(d, (p) => extname(p) === '.css'));
const cssByFile = new Map(cssFiles.map((f) => [f, readFileSync(f, 'utf8')]));
const cssText = [...cssByFile.values()].join('\n');
const srcFiles = [...SRC_DIRS.flatMap((d) => walk(d, (p) => SRC_EXT.has(extname(p)))), join(ROOT, 'index.html')];
const hay = srcFiles.map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

// —— 复用 v2 判定，确保删的就是上面那份清单 ——
const usedInSrc = (t) => new RegExp('(^|[^\\w-])' + esc(t) + '([^\\w-]|$)').test(hay);
const allClasses = [...new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
const chained = new Set([...cssText.matchAll(/\.[\w-]+\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const isMod = (c) => chained.has(c) || /^(is|has|no|was|will)-/.test(c);
const isThird = (c) => THIRD_PARTY.some((p) => c.startsWith(p));
const deadClasses = new Set(allClasses.filter((c) => !usedInSrc(c) && !isThird(c) && !isMod(c)));
const themeVars = new Set([...cssText.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1])));
const allVars = [...new Set([...cssText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))];
const deadVars = new Set(allVars.filter((v) => !themeVars.has(v) && !new RegExp('var\\(\\s*' + esc(v)).test(cssText + hay)));

// —— CSS 切块（大括号配平、跳过注释）——
function splitNodes(body) {
    const nodes = []; let i = 0, buf = ''; const n = body.length;
    while (i < n) {
        const ch = body[i];
        if (ch === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; buf += body.slice(i, end); i = end; continue; }
        if (ch === ';') { buf += ';'; nodes.push({ type: 'stmt', raw: buf }); buf = ''; i++; continue; }
        if (ch === '{') {
            let depth = 1, j = i + 1;
            while (j < n && depth > 0) {
                const cj = body[j];
                if (cj === '/' && body[j + 1] === '*') { const e = body.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
                if (cj === '{') depth++; else if (cj === '}') depth--; j++;
            }
            nodes.push({ type: 'block', prelude: buf, inner: body.slice(i + 1, j - 1) });
            buf = ''; i = j; continue;
        }
        buf += ch; i++;
    }
    if (buf.trim()) nodes.push({ type: 'stmt', raw: buf });
    return nodes;
}
const classesIn = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
// 选择器“死”：含≥1死类，且不含任何源码中真实使用的类（挂在活动元素上的一律保留）
function selectorDead(sel) {
    const cs = classesIn(sel);
    if (!cs.length) return false;
    if (!cs.some((c) => deadClasses.has(c))) return false;
    if (cs.some((c) => usedInSrc(c))) return false;
    return true;
}
const RECURSE = /^@(media|supports|layer|container|scope)\b/i;

let removedRules = 0;
function processBody(body) {
    const out = [];
    for (const node of splitNodes(body)) {
        if (node.type === 'stmt') { out.push(node.raw); continue; }
        const prelude = node.prelude.trim();
        if (prelude.startsWith('@')) {
            if (RECURSE.test(prelude)) {
                const inner = processBody(node.inner);
                if (inner.trim()) out.push(node.prelude + '{' + inner + '}'); // 空 @media 整块丢弃
            } else out.push(node.prelude + '{' + node.inner + '}');         // @theme/@keyframes 原样保留
            continue;
        }
        const sels = prelude.split(',').map((s) => s.trim()).filter(Boolean);
        if (sels.length && sels.every(selectorDead)) { removedRules++; continue; }
        out.push(node.prelude + '{' + node.inner + '}');
    }
    return out.join('');
}

const emptyCandidates = []; let varRemovals = 0;
for (const [f, original] of cssByFile) {
    let css = processBody(original);
    for (const v of deadVars) css = css.replace(new RegExp('[ \\t]*' + esc(v) + '\\s*:[^;{}]*;\\n?', 'g'), () => { varRemovals++; return ''; });
    css = css.replace(/\n{3,}/g, '\n\n').replace(/^[ \t]+\n/gm, '\n');
    if (css === original) continue;
    const rel = relative(ROOT, f);
    const meaningful = splitNodes(css).some((nd) => {
        if (nd.type === 'stmt') return /\S/.test(nd.raw.replace(/\/\*[\s\S]*?\*\//g, ''));
        const pre = nd.prelude.trim();
        if (pre.startsWith('@')) return !RECURSE.test(pre) || nd.inner.trim();
        return nd.prelude.split(',').some((s) => { const cs = classesIn(s); return cs.length === 0 || cs.some((c) => usedInSrc(c)); });
    });
    console.log(`修改 ${rel}: ${original.length} → ${css.length} 字节`);
    if (!meaningful) emptyCandidates.push(rel);
    if (WRITE) writeFileSync(f, css);
}

console.log(`\n共删除规则 ${removedRules} 条、死变量声明 ${varRemovals} 处。`);
if (emptyCandidates.length) {
    console.log('\n以下文件清理后已无有效样式，建议手动删文件并移除其 import：');
    for (const rel of emptyCandidates) {
        const base = rel.split(/[\\/]/).pop();
        const importers = [...cssFiles, ...srcFiles].filter((p) => { try { return readFileSync(p, 'utf8').includes(base); } catch { return false; } }).map((p) => relative(ROOT, p)).filter((p) => p !== rel);
        console.log(`  - ${rel}  ← 被引用于: ${importers.join(', ') || '（无）'}`);
    }
}
console.log(WRITE ? '\n已写入。请 git diff 复查，再 pnpm tsc --noEmit 与构建验证。' : '\n（dry-run 预览，未改文件；加 --write 落盘。）');