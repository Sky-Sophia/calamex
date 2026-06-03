#!/usr/bin/env node
/**
 * 完成 useAiAssistant.ts 中 finalizeSidecarTurn 重构的最后两步。
 *
 * 背景: main 上 finalizeSidecarTurn 已定义, 但 executeSidecarAgentRequest 与
 * resolveSidecarToolConfirmation 仍在用各自的旧内联收尾逻辑(重复 ~90 行)。
 * 本脚本把这两处旧内联块替换为对 finalizeSidecarTurn 的调用, 行为等价。
 *
 * 安全策略:
 *  - 仅替换这两处, 用唯一锚点定位; 任一锚点对不上立即退出、不写入、不备份。
 *  - 已经迁移过(检测到 2 次调用)则原样退出。
 *
 * 用法(在仓库根目录 D:\com.xiaojianc\my_desktop_app 执行):
 *   node finish-finalize-sidecar.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join('src', 'composables', 'ai', 'useAiAssistant.ts');

function fail(msg) {
    console.error('\u2717 ' + msg);
    console.error('  未做任何改动, 文件保持原样。');
    process.exit(1);
}

if (!fs.existsSync(FILE)) fail('找不到文件: ' + FILE + ' (请在仓库根目录运行)');
let src = fs.readFileSync(FILE, 'utf8');
const original = src;

// ---- 前置校验 ----
if (src.indexOf('const finalizeSidecarTurn = async (') < 0) {
    fail('文件里没有 finalizeSidecarTurn 定义, 脚本前提不成立。');
}
const callCount = (s) => s.split('await finalizeSidecarTurn(payload, {').length - 1;
if (callCount(src) === 2) {
    console.log('\u2713 已经迁移过(检测到 2 处调用), 无需改动。');
    process.exit(0);
}
if (callCount(src) !== 0) {
    fail('finalizeSidecarTurn 调用次数异常(期望 0, 实际 ' + callCount(src) + '), 请人工检查。');
}

const BLOCK_START = 'appendRuntimeTimelineEvents(payload.events);';
const CATCH = '    } catch (error) {';

function lineStart(s, idx) {
    return s.lastIndexOf('\n', idx) + 1;
}

const NEW_A =
    '      await finalizeSidecarTurn(payload, {\n' +
    '        assistantMessageId,\n' +
    '        threadId: targetThreadId,\n' +
    '        fallbackActivityText: initialActivityText,\n' +
    '        patchTaskId: turnId,\n' +
    '        patchSessionId: sidecarSessionId,\n' +
    '        updateSteps: true,\n' +
    '        onPendingConfirmation: (pendingConfirmation) => {\n' +
    '          persistSidecarToolConfirmation(pendingConfirmation, {\n' +
    '            sessionId: payload.sessionId,\n' +
    '            assistantMessageId,\n' +
    '            threadId: targetThreadId,\n' +
    '            turnId,\n' +
    '            baseMessages: visibleMessages,\n' +
    '            messageContent,\n' +
    '            references: sidecarContextReferences,\n' +
    '          });\n' +
    '        },\n' +
    '      });\n';

const NEW_B =
    '      await finalizeSidecarTurn(payload, {\n' +
    '        assistantMessageId: session.assistantMessageId,\n' +
    '        threadId: session.threadId,\n' +
    '        fallbackActivityText: session.messageContent,\n' +
    '        patchTaskId: session.turnId ?? session.assistantMessageId,\n' +
    '        patchSessionId: payload.sessionId,\n' +
    '        updateSteps: false,\n' +
    '        onPendingConfirmation: (pendingConfirmation) => {\n' +
    '          persistSidecarToolConfirmation(pendingConfirmation, {\n' +
    '            ...session,\n' +
    '            sessionId: payload.sessionId,\n' +
    '          });\n' +
    '        },\n' +
    '      });\n';

// ---- 先做 B(resolveSidecarToolConfirmation, 位于文件较后位置)----
const resolveStart = src.indexOf('const resolveSidecarToolConfirmation = async (');
if (resolveStart < 0) fail('找不到 resolveSidecarToolConfirmation');
{
    const blockRel = src.indexOf(BLOCK_START, resolveStart);
    if (blockRel < 0) fail('B: 找不到内联块起点 appendRuntimeTimelineEvents');
    const blockStart = lineStart(src, blockRel);
    const marker = src.indexOf("const message = toErrorMessage(error, '处理 Agent 工具确认失败。');");
    if (marker < 0) fail('B: 找不到 catch 标记 (处理 Agent 工具确认失败)');
    const catchPos = src.lastIndexOf(CATCH, marker);
    if (catchPos < 0 || catchPos < blockStart) fail('B: catch 定位异常');
    src = src.slice(0, blockStart) + NEW_B + src.slice(catchPos);
}

// ---- 再做 A(executeSidecarAgentRequest, 位于 B 之前, 索引不受 B 影响)----
const execStart = src.indexOf('const executeSidecarAgentRequest = async (');
if (execStart < 0) fail('找不到 executeSidecarAgentRequest');
{
    const blockRel = src.indexOf(BLOCK_START, execStart);
    if (blockRel < 0) fail('A: 找不到内联块起点 appendRuntimeTimelineEvents');
    const blockStart = lineStart(src, blockRel);
    const marker = src.indexOf('const wasAborted = activeAbortController.value?.signal.aborted;');
    if (marker < 0) fail('A: 找不到 catch 标记 (wasAborted)');
    const catchPos = src.lastIndexOf(CATCH, marker);
    if (catchPos < 0 || catchPos < blockStart) fail('A: catch 定位异常');
    src = src.slice(0, blockStart) + NEW_A + src.slice(catchPos);
}

// ---- 后置校验 ----
if (callCount(src) !== 2) fail('替换后 finalizeSidecarTurn 调用次数应为 2, 实际 ' + callCount(src) + '。');
if (src === original) fail('内容未发生变化, 异常。');

fs.writeFileSync(FILE, src, 'utf8');
console.log('\u2713 已完成两处替换 -> ' + FILE);
console.log('  下一步: pnpm lint && pnpm typecheck && pnpm test, 然后提交并推送到 main。');
