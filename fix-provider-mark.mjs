import { readFile, writeFile } from 'node:fs/promises';

const FILE = 'src/components/business/ai/shell/AiAssistantPanel.vue';

const source = await readFile(FILE, 'utf8');

// 只圈定 .ai-provider-mark 规则块（CSS 声明里不含 '}'，[^}]* 足以安全界定整块）
const blockRe = /\.ai-provider-mark\s*\{[^}]*\}/;
const match = source.match(blockRe);

if (!match) {
    throw new Error(
        '未找到 .ai-provider-mark 规则；本地文件可能落后于远程，请先执行 `git pull origin main` 再运行。',
    );
}

const original = match[0];
// 去掉冗余的 max-width / flex（兼容 LF 与 CRLF，容忍空格差异）
const fixed = original
    .replace(/[ \t]*max-width:\s*min\(48%,\s*320px\);\r?\n?/, '')
    .replace(/[ \t]*flex:\s*0 1 auto;\r?\n?/, '');

if (fixed === original) {
    console.log('· 规则里已无 max-width/flex，无需改动（可能已修复）。');
} else {
    await writeFile(FILE, source.replace(original, fixed));
    console.log('✓ 已移除 .ai-provider-mark 的冗余 max-width / flex（修复左上角模型名被截成 “g…”）。');
}