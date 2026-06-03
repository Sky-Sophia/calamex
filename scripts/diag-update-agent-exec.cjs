'use strict';
const fs = require('fs');
const path = require('path');
const { matchClose, splitTopLevel } = require('./migrate-update-agent-exec-options.cjs');

const FILE = process.argv[2] || path.join('src', 'composables', 'ai', 'useAiAssistant.ts');
const FN = 'updateAgentExecutionMessage';
const src = fs.readFileSync(FILE, 'utf8');

const needle = FN + '(';
let from = 0;
let n = 0;
for (; ;) {
    const at = src.indexOf(needle, from);
    if (at < 0) break;
    from = at + 1;
    const prev = src[at - 1];
    if (prev && /[A-Za-z0-9_$]/.test(prev)) continue;
    const line = src.slice(0, at).split('\n').length;
    const open = at + FN.length;
    const close = matchClose(src, open);
    const args = close > 0 ? splitTopLevel(src.slice(open + 1, close)) : [];
    console.log(
        '#' + ++n + '  line ' + line + '  argc=' + args.length +
        '\n     arg0=' + (args[0] || '') +
        '\n     arg1=' + (args[1] || ''),
    );
}
console.log('\n共 ' + n + ' 处调用');