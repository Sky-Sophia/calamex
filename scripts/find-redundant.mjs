// scripts/find-redundant.mjs
// 扫描“无人引用的冗余文件”和“清理后已空的 CSS 文件”。只报告，不删除。
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', '.vite']);
const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.vue'];
const ALL_EXT = new Set([...CODE_EXT, '.css', '.json']);
const norm = (p) => p.replace(/\\/g, '/');

const walk = (dir, out = []) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
        else out.push(p);
    }
    return out;
};

const srcFiles = walk(SRC).filter((p) => ALL_EXT.has(extname(p)));
const fileSet = new Set(srcFiles.map(norm));
const repoFiles = walk(ROOT).filter((p) => /\.(ts|tsx|js|jsx|mts|cts|vue|css|json|html|rs|toml)$/.test(p));
const repoText = new Map(repoFiles.map((p) => { try { return [norm(p), readFileSync(p, 'utf8')]; } catch { return [norm(p), '']; } }));

function resolveSpec(spec, fromFile) {
    let base;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));        // 假设 @ → src（如你的 alias 不同请告诉我）
    else if (spec.startsWith('.') || spec.startsWith('/')) base = resolve(dirname(fromFile), spec.replace(/^\//, './'));
    else return null;                                                  // 裸模块（npm 包）忽略
    const ext = extname(base), cands = [];
    if (ext && ALL_EXT.has(ext)) cands.push(base);
    else { for (const e of [...CODE_EXT, '.css', '.json']) cands.push(base + e); for (const e of CODE_EXT) cands.push(join(base, 'index' + e)); }
    for (const c of cands) { const n = norm(c); if (fileSet.has(n)) return n; }
    return null;
}
function globToRe(g, fromFile) {
    const abs = g.startsWith('@/') ? join(SRC, g.slice(2)) : resolve(dirname(fromFile), g);
    let s = norm(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
    return new RegExp('^' + s + '$');
}

const referenced = new Set(), globRes = [];
const importRe = /from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|@import\s*(?:url\()?\s*['"]([^'"]+)['"]/gm;
const globRe = /import\.meta\.glob(?:Eager)?\s*\(\s*\[?\s*['"]([^'"]+)['"]/g;

for (const f of srcFiles) {
    const txt = repoText.get(norm(f)) || '';
    for (const m of txt.matchAll(importRe)) { const spec = m[1] || m[2] || m[3] || m[4]; const r = spec && resolveSpec(spec, f); if (r) referenced.add(r); }
    for (const m of txt.matchAll(globRe)) { try { globRes.push(globToRe(m[1], f)); } catch { } }
}
for (const f of srcFiles) { const n = norm(f); if (globRes.some((re) => re.test(n))) referenced.add(n); }

const ROOTS = ['src/main.ts', 'src/main.tsx', 'src/App.vue', 'src/styles.css'].map((p) => norm(join(ROOT, p)));
const indexHtml = repoText.get(norm(join(ROOT, 'index.html'))) || '';
for (const m of indexHtml.matchAll(/(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)) { const r = resolveSpec(m[1], join(ROOT, 'index.html')); if (r) referenced.add(r); }

const basenameHits = (file) => {
    const base = file.split('/').pop().replace(/\.(vue|ts|tsx|js|jsx|mts|cts|css)$/, '');
    let h = 0; for (const [p, t] of repoText) { if (p !== file && t.includes(base)) h++; } return h;
};

const candidates = srcFiles.map(norm).filter((n) => !referenced.has(n) && !ROOTS.includes(n) && !/\.d\.ts$/.test(n));
const emptyCss = srcFiles.filter((f) => extname(f) === '.css').filter((f) => {
    const t = (repoText.get(norm(f)) || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@charset[^;]*;/g, '');
    return !/[{};]/.test(t);
});

console.log('===== 可能冗余的文件（src/ 下无人 import，需人工确认）=====');
for (const c of candidates.sort()) { const h = basenameHits(c); console.log(`${h === 0 ? '【高可信·零引用】' : `【需复核·basename 命中 ${h} 处】`} ${relative(ROOT, c)}`); }
if (!candidates.length) console.log('（无）');
console.log('\n===== 清理后已彻底变空的 CSS 文件（建议删文件 + 移除其 import）=====');
emptyCss.length ? emptyCss.forEach((f) => console.log('  ' + relative(ROOT, f))) : console.log('（无）');
console.log('\n⚠️ 【高可信·零引用】也请扫一眼：是否被 动态拼接路径 / Rust·Tauri 侧 / vite 插件 glob 引用。确认后我来删。');