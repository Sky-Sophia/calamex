// scripts/find-dead-css.v2.mjs — 区分 第三方/动态修饰符/@theme变量，输出可信的“真死”清单
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const CSS_DIRS = [join(ROOT, 'src/styles'), join(ROOT, 'src/assets/css')];
const SRC_DIRS = [join(ROOT, 'src'), join(ROOT, 'src-tauri')];
const SRC_EXT = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.html', '.rs']);
const SKIP = new Set(['node_modules', '.git', 'dist', 'target']);
const THIRD_PARTY = ['xterm-', 'cm-', 'reka-', 'radix-']; // 库运行时生成的 DOM 类，源码搜不到属正常

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
const hay = [...SRC_DIRS.flatMap((d) => walk(d, (p) => SRC_EXT.has(extname(p)))), join(ROOT, 'index.html')]
    .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

const usedInSrc = (t) => new RegExp('(^|[^\\w-])' + esc(t) + '([^\\w-]|$)').test(hay);
const allClasses = [...new Set([...cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
const chained = new Set([...cssText.matchAll(/\.[\w-]+\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])); // .a.b 里的 b
const isModifier = (c) => chained.has(c) || /^(is|has|no|was|will)-/.test(c);
const isThird = (c) => THIRD_PARTY.some((p) => c.startsWith(p));

const kept = { third: [], modifier: [] };
const dead = [];
for (const c of allClasses) {
    if (usedInSrc(c)) continue;
    if (isThird(c)) { kept.third.push(c); continue; }
    if (isModifier(c)) { kept.modifier.push(c); continue; }
    dead.push(c);
}

console.log(`\n===== 建议删除的“真死类名”（按文件分组，共 ${dead.length}）=====`);
for (const [f, txt] of cssByFile) {
    const inFile = new Set([...txt.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const deadHere = [...inFile].filter((c) => dead.includes(c)).sort();
    if (!deadHere.length) continue;
    const survivors = [...inFile].filter((c) => !dead.includes(c));
    const whole = survivors.every((c) => isModifier(c) || isThird(c) || !usedInSrc(c)) ? ' 【整文件疑似全死，可连 @import 一起删】' : '';
    console.log(`\n# ${relative(ROOT, f)}  (${deadHere.length}/${inFile.size})${whole}`);
    console.log('  ' + deadHere.join('\n  '));
}
console.log(`\n===== 保留·第三方运行时类（勿删，${kept.third.length}）=====\n` + kept.third.sort().join(', '));
console.log(`\n===== 保留·动态修饰符类（勿删，${kept.modifier.length}）=====\n` + kept.modifier.sort().join(', '));

const themeVars = new Set([...cssText.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1])));
const allVars = [...new Set([...cssText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))];
const varDead = allVars.filter((v) => !themeVars.has(v) && !new RegExp('var\\(\\s*' + esc(v)).test(cssText + hay));
console.log(`\n===== 建议删除的“真死 CSS 变量”（非 @theme 且无 var() 引用，${varDead.length}）=====\n` + varDead.sort().join('\n'));
console.log(`\n（@theme 内 ${themeVars.size} 个 token 一律保留：Tailwind v4 构建期消费，不走 var()。）`);
console.log('\n⚠️ 仍需人工确认：splash-* 这类启动早期注入的标记、以及字符串拼接生成的类名。');