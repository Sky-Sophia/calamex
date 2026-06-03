#!/usr/bin/env node
/**
 * ③ 重构: 将 useAiAssistant.ts 中的 updateAgentExecutionMessage
 * 从 9 个位置参数改为单一 options 对象。
 *
 * 设计: 数据驱动 + 括号配对。脚本从你真实文件里读出函数定义的
 * 参数名/类型/默认值, 自动生成 input 接口与解构; 再按参数顺序把每个
 * 调用点的位置实参转成具名属性。对缩进/空白完全不敏感。
 *
 * 安全策略: fail-loud(任何假设不成立立即退出、不写入、不备份);
 *           幂等(检测到接口已存在则跳过); 预期调用点数 = 5。
 *
 * 用法(仓库根目录): node migrate-update-agent-exec-options.cjs
 */
'use strict';

const FN = 'updateAgentExecutionMessage';
const IFACE = 'IUpdateAgentExecutionMessageInput';
const EXPECTED_CALLS = 6;

// 跳过字符串(含转义); i 指向引号。返回闭合引号的下标。
function skipString(s, i) {
    const q = s[i];
    if (q === '`') return skipTemplate(s, i);
    for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') {
            j++;
            continue;
        }
        if (s[j] === q) return j;
    }
    return s.length - 1;
}

// 跳过模板串(含 ${ ... } 插值, 可嵌套)。i 指向反引号。
function skipTemplate(s, i) {
    for (let j = i + 1; j < s.length; j++) {
        if (s[j] === '\\') {
            j++;
            continue;
        }
        if (s[j] === '`') return j;
        if (s[j] === '$' && s[j + 1] === '{') {
            let depth = 1;
            j += 2;
            for (; j < s.length; j++) {
                const c = s[j];
                if (c === '\\') {
                    j++;
                    continue;
                }
                if (c === "'" || c === '"' || c === '`') {
                    j = skipString(s, j);
                    continue;
                }
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) break;
                }
            }
        }
    }
    return s.length - 1;
}

// 给定开括号下标(任意 ( [ {), 返回其匹配闭括号下标。源码合法时成立。
function matchClose(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === "'" || c === '"' || c === '`') {
            i = skipString(s, i);
            continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// 按顶层逗号拆分(跳过字符串/嵌套括号)。
function splitTopLevel(s) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "'" || c === '"' || c === '`') {
            i = skipString(s, i);
            continue;
        }
        if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
        else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
        else if (c === ',' && depth === 0) {
            out.push(s.slice(start, i));
            start = i + 1;
        }
    }
    const last = s.slice(start);
    if (last.trim() !== '') out.push(last);
    return out.map((x) => x.trim()).filter((x) => x !== '');
}

// 拆分参数时不能把泛型里的逗号当分隔; 上面 splitTopLevel 已将 < > 计入深度。
function parseParam(p) {
    const m = p.match(/^([A-Za-z_$][\w$]*)\s*(\??)\s*:\s*([\s\S]*)$/);
    if (!m) throw new Error('无法解析参数: ' + p);
    const name = m[1];
    const optional = m[2] === '?';
    const rest = m[3];
    let type = rest;
    let def = null;
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (c === "'" || c === '"' || c === '`') {
            i = skipString(rest, i);
            continue;
        }
        if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
        else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
        else if (
            c === '=' &&
            depth === 0 &&
            rest[i - 1] !== '=' &&
            rest[i - 1] !== '!' &&
            rest[i - 1] !== '<' &&
            rest[i - 1] !== '>' &&
            rest[i + 1] !== '=' &&
            rest[i + 1] !== '>'
        ) {
            type = rest.slice(0, i).trim();
            def = rest.slice(i + 1).trim();
            break;
        }
    }
    return { name, optional, type: type.trim(), default: def };
}

function lineIndent(s, idx) {
    const ls = s.lastIndexOf('\n', idx) + 1;
    const seg = s.slice(ls, idx);
    const m = seg.match(/^[ \t]*/);
    return m ? m[0] : '';
}

function transform(src) {
    if (src.includes(IFACE)) {
        return { src, changed: false, reason: 'already' };
    }

    // ---- 解析定义 ----
    const defMarker = 'const ' + FN + ' = (';
    const defIdx = src.indexOf(defMarker);
    if (defIdx < 0) throw new Error('找不到 ' + FN + ' 定义');
    if (src.indexOf(defMarker, defIdx + 1) >= 0) throw new Error('出现多个定义, 人工检查');
    const defOpen = defIdx + defMarker.length - 1; // '(' 下标
    const defClose = matchClose(src, defOpen);
    if (defClose < 0) throw new Error('定义括号未配对');
    const params = splitTopLevel(src.slice(defOpen + 1, defClose)).map(parseParam);
    if (params.length < 3) throw new Error('参数个数异常: ' + params.length);
    if (params[0].name !== 'messageId' || params[1].name !== 'content') {
        throw new Error('参数顺序与预期不符: ' + params.map((p) => p.name).join(','));
    }

    // 定义体开始的 { 位置 (在 ) 之后的 => { )
    const arrowIdx = src.indexOf('=>', defClose);
    if (arrowIdx < 0 || arrowIdx > defClose + 60) throw new Error('未找到箭头体');
    const bodyBrace = src.indexOf('{', arrowIdx);
    if (bodyBrace < 0) throw new Error('未找到函数体 {');

    // ---- 先转调用点(后向前, 保持下标有效) ----
    const callIdxs = [];
    const needle = FN + '(';
    let from = 0;
    for (; ;) {
        const at = src.indexOf(needle, from);
        if (at < 0) break;
        from = at + 1;
        const prev = src[at - 1];
        if (prev && /[A-Za-z0-9_$]/.test(prev)) continue; // 嵌在别名里
        callIdxs.push(at);
    }
    if (callIdxs.length !== EXPECTED_CALLS) {
        throw new Error(
            '调用点数与预期不符(期望 ' +
            EXPECTED_CALLS +
            ', 实际 ' +
            callIdxs.length +
            ')。是否未先跑 ① finalizeSidecarTurn 脚本?',
        );
    }

    let out = src;
    for (let k = callIdxs.length - 1; k >= 0; k--) {
        const at = callIdxs[k];
        const open = at + FN.length;
        if (out[open] !== '(') throw new Error('调用点括号定位异常');
        const close = matchClose(out, open);
        if (close < 0) throw new Error('调用点括号未配对');
        const args = splitTopLevel(out.slice(open + 1, close));
        if (args.length < 2 || args.length > params.length) {
            throw new Error('调用实参个数异常: ' + args.length);
        }
        const base = lineIndent(out, at);
        const props = args
            .map((a, i) => base + '  ' + params[i].name + ': ' + a + ',')
            .join('\n');
        const repl = '({\n' + props + '\n' + base + '})';
        out = out.slice(0, open) + repl + out.slice(close + 1);
    }

    // ---- 再转定义(在调用点之前, 在转完的 out 上重新定位) ----
    const defIdx2 = out.indexOf(defMarker);
    if (defIdx2 < 0) throw new Error('二次定位定义失败');
    const defOpen2 = defIdx2 + defMarker.length - 1;
    const defClose2 = matchClose(out, defOpen2);
    const arrowIdx2 = out.indexOf('=>', defClose2);
    const bodyBrace2 = out.indexOf('{', arrowIdx2);
    const between2 = out.slice(defClose2 + 1, bodyBrace2 + 1);
    const lineStart = out.lastIndexOf('\n', defIdx2) + 1;
    const indent = out.slice(lineStart, defIdx2);

    const ifaceBody = params
        .map((p) => {
            const opt = p.optional || p.default != null ? '?' : '';
            return indent + '  ' + p.name + opt + ': ' + p.type + ';';
        })
        .join('\n');
    const ifaceText = indent + 'interface ' + IFACE + ' {\n' + ifaceBody + '\n' + indent + '}';

    const destructNames = params
        .map((p) => indent + '    ' + p.name + (p.default != null ? ' = ' + p.default : '') + ',')
        .join('\n');
    const destructure =
        indent + '  const {\n' + destructNames + '\n' + indent + '  } = input;';

    const newSig = indent + 'const ' + FN + ' = (input: ' + IFACE + ')' + between2;

    out =
        out.slice(0, lineStart) +
        ifaceText +
        '\n\n' +
        newSig +
        '\n' +
        destructure +
        out.slice(bodyBrace2 + 1);

    // ---- 后置校验 ----
    if (!out.includes('interface ' + IFACE)) throw new Error('接口未生成');
    const objCalls = out.split(FN + '({').length - 1;
    if (objCalls !== EXPECTED_CALLS) throw new Error('对象形式调用数异常: ' + objCalls);
    if (out.includes('const ' + FN + ' = (input: ' + IFACE + ')') === false) {
        throw new Error('新签名未生成');
    }

    return { src: out, changed: true, reason: 'migrated', params: params.map((p) => p.name) };
}

module.exports = { transform, splitTopLevel, matchClose, parseParam };

if (require.main === module) {
    const fs = require('fs');
    const path = require('path');
    const FILE = path.join('src', 'composables', 'ai', 'useAiAssistant.ts');
    const fail = (msg) => {
        console.error('\u2717 ' + msg);
        console.error('  未做任何改动, 文件保持原样。');
        process.exit(1);
    };
    if (!fs.existsSync(FILE)) fail('找不到文件: ' + FILE + ' (请在仓库根目录运行)');
    const original = fs.readFileSync(FILE, 'utf8');
    let result;
    try {
        result = transform(original);
    } catch (e) {
        fail(e.message);
    }
    if (!result.changed) {
        console.log('\u2713 已迁移过(检测到 ' + IFACE + '), 无需改动。');
        process.exit(0);
    }
    fs.writeFileSync(FILE, result.src, 'utf8');
    console.log('\u2713 已将 ' + FN + ' 改为 options 对象(参数: ' + result.params.join(', ') + ')');
    console.log('  下一步: pnpm lint && pnpm typecheck && pnpm test src/composables/ai/useAiAssistant.spec.ts');
}