'use strict';
// ② 抽取 sidecar 管线重复（最稳妥范围）：
//   - 新增共享小工具 src/composables/ai/sidecar-stream-listener.ts
//   - useAiAssistant.ts: 抽 failSidecarAgentMessage + 收敛 2 处监听样板
//   - useAiAgentRun.ts: 抽 appendStepFinalAnswerFromProjection + 收敛 2 处监听样板
// 完全保行为。fail-loud：任一计数不符即整体中止、不写盘。幂等：检测到 marker 跳过该文件。
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const L = (...lines) => lines.join('\n');

const NEW_FILE = 'src/composables/ai/sidecar-stream-listener.ts';
const NEW_FILE_CONTENT = L(
    "import { aiService } from '@/services/ipc/ai.service';",
    "import type { TAgentUiEvent } from '@/types/ai/sidecar';",
    '',
    '/**',
    ' * 订阅 sidecar 流式事件，并按 sessionId 过滤。',
    ' * 收敛 useAiAssistant / useAiAgentRun 中重复的 onSidecarStream + sessionId 守卫样板。',
    ' * 返回的 Promise resolve 为取消订阅函数。',
    ' */',
    'export const subscribeSidecarSessionStream = (',
    '  sessionId: string,',
    '  onEvent: (event: TAgentUiEvent) => void,',
    ') =>',
    '  aiService.onSidecarStream((payload) => {',
    '    if (payload.sessionId !== sessionId) {',
    '      return;',
    '    }',
    '',
    '    onEvent(payload.event);',
    '  });',
    '',
);

const MARKER = 'subscribeSidecarSessionStream';

const FILES = {
    'src/composables/ai/useAiAssistant.ts': {
        marker: MARKER,
        edits: [
            {
                name: 'import',
                count: 1,
                find: L(
                    "} from '@/composables/ai/sidecar-events';",
                    "import { useAiAgentPlan } from '@/composables/ai/useAiAgentPlan';",
                ),
                replace: L(
                    "} from '@/composables/ai/sidecar-events';",
                    "import { subscribeSidecarSessionStream } from '@/composables/ai/sidecar-stream-listener';",
                    "import { useAiAgentPlan } from '@/composables/ai/useAiAgentPlan';",
                ),
            },
            {
                name: 'helper-def',
                count: 1,
                find: '  const executeSidecarAgentRequest = async (',
                replace: L(
                    '  const failSidecarAgentMessage = (messageId: string, message: string): void => {',
                    '    disposeSidecarAnswerStream(messageId);',
                    '    updateAgentExecutionMessage({',
                    '      messageId,',
                    '      content: `Agent 执行失败：${message}`,',
                    '      toolCalls: [],',
                    "      streamStatus: 'completed',",
                    '    });',
                    '    errorMessage.value = message;',
                    '  };',
                    '',
                    '  const executeSidecarAgentRequest = async (',
                ),
            },
            {
                name: 'listener-execute',
                count: 1,
                find: L(
                    '      unlistenSidecarStream = await aiService.onSidecarStream((payload) => {',
                    '        if (payload.sessionId !== sidecarSessionId) {',
                    '          return;',
                    '        }',
                    '',
                    '        liveEventBuffer.push(payload.event);',
                    '      });',
                ),
                replace: L(
                    '      unlistenSidecarStream = await subscribeSidecarSessionStream(sidecarSessionId, (event) => {',
                    '        liveEventBuffer.push(event);',
                    '      });',
                ),
            },
            {
                name: 'listener-resolve',
                count: 1,
                find: L(
                    '      unlistenSidecarStream = await aiService.onSidecarStream((payload) => {',
                    '        if (payload.sessionId !== session.sessionId) {',
                    '          return;',
                    '        }',
                    '',
                    '        liveEventBuffer.push(payload.event);',
                    '      });',
                ),
                replace: L(
                    '      unlistenSidecarStream = await subscribeSidecarSessionStream(session.sessionId, (event) => {',
                    '        liveEventBuffer.push(event);',
                    '      });',
                ),
            },
            {
                name: 'catch-execute',
                count: 1,
                find: L(
                    '    } catch (error) {',
                    '      const wasAborted = activeAbortController.value?.signal.aborted;',
                    '      disposeSidecarAnswerStream(assistantMessageId);',
                    '',
                    '      if (!wasAborted) {',
                    '        const message = toErrorMessage(error, MSG_CALL_FAILED);',
                    '        updateAgentExecutionMessage({',
                    '          messageId: assistantMessageId,',
                    '          content: `Agent 执行失败：${message}`,',
                    '          toolCalls: [],',
                    "          streamStatus: 'completed',",
                    '        });',
                    '        errorMessage.value = message;',
                    '      }',
                    '    } finally {',
                ),
                replace: L(
                    '    } catch (error) {',
                    '      if (activeAbortController.value?.signal.aborted) {',
                    '        disposeSidecarAnswerStream(assistantMessageId);',
                    '      } else {',
                    '        failSidecarAgentMessage(assistantMessageId, toErrorMessage(error, MSG_CALL_FAILED));',
                    '      }',
                    '    } finally {',
                ),
            },
            {
                name: 'catch-resolve',
                count: 1,
                find: L(
                    '    } catch (error) {',
                    "      const message = toErrorMessage(error, '处理 Agent 工具确认失败。');",
                    '      disposeSidecarAnswerStream(session.assistantMessageId);',
                    '      updateAgentExecutionMessage({',
                    '        messageId: session.assistantMessageId,',
                    '        content: `Agent 执行失败：${message}`,',
                    '        toolCalls: [],',
                    "        streamStatus: 'completed',",
                    '      });',
                    '      errorMessage.value = message;',
                    '    } finally {',
                ),
                replace: L(
                    '    } catch (error) {',
                    '      failSidecarAgentMessage(',
                    '        session.assistantMessageId,',
                    "        toErrorMessage(error, '处理 Agent 工具确认失败。'),",
                    '      );',
                    '    } finally {',
                ),
            },
        ],
    },
    'src/composables/ai/useAiAgentRun.ts': {
        marker: MARKER,
        edits: [
            {
                name: 'import',
                count: 1,
                find: L(
                    "} from '@/composables/ai/sidecar-events';",
                    "import { useSidecarChangedDocumentRefresh } from '@/composables/useSidecarChangedDocumentRefresh';",
                ),
                replace: L(
                    "} from '@/composables/ai/sidecar-events';",
                    "import { subscribeSidecarSessionStream } from '@/composables/ai/sidecar-stream-listener';",
                    "import { useSidecarChangedDocumentRefresh } from '@/composables/useSidecarChangedDocumentRefresh';",
                ),
            },
            {
                name: 'helper-def',
                count: 1,
                find: '  const executeSidecarStepLoop = async (session: ISidecarStepLoopSession): Promise<IAiAgentRun> => {',
                replace: L(
                    '  const appendStepFinalAnswerFromProjection = (',
                    '    session: ISidecarStepLoopSession,',
                    '    projection: ReturnType<typeof projectSidecarExecuteResponse>,',
                    '  ): void => {',
                    '    const finalContent = projection.assistantContent.trim();',
                    '',
                    '    if (!finalContent) {',
                    '      return;',
                    '    }',
                    '',
                    '    store.appendStepFinalAnswer(',
                    '      toStepFinalAnswer(',
                    '        session.runId,',
                    '        session.stepId,',
                    '        finalContent,',
                    '        new Date().toISOString(),',
                    '        projection.toolCalls.length,',
                    '      ),',
                    '    );',
                    '  };',
                    '',
                    '  const executeSidecarStepLoop = async (session: ISidecarStepLoopSession): Promise<IAiAgentRun> => {',
                ),
            },
            {
                name: 'listener',
                count: 2,
                find: L(
                    '    const unlistenSidecarStream = await aiService.onSidecarStream((payload) => {',
                    '      if (payload.sessionId !== sidecarSessionId) {',
                    '        return;',
                    '      }',
                    '',
                    '      liveEvents.push(payload.event);',
                    '      appendSidecarLiveToolActivities(session.runId, session.stepId, liveEvents);',
                    '    });',
                ),
                replace: L(
                    '    const unlistenSidecarStream = await subscribeSidecarSessionStream(sidecarSessionId, (event) => {',
                    '      liveEvents.push(event);',
                    '      appendSidecarLiveToolActivities(session.runId, session.stepId, liveEvents);',
                    '    });',
                ),
            },
            {
                name: 'final-answer',
                count: 2,
                find: L(
                    '    const finalContent = projection.assistantContent.trim();',
                    '    if (finalContent) {',
                    '      const createdAt = new Date().toISOString();',
                    '      store.appendStepFinalAnswer(',
                    '        toStepFinalAnswer(',
                    '          session.runId,',
                    '          session.stepId,',
                    '          finalContent,',
                    '          createdAt,',
                    '          projection.toolCalls.length,',
                    '        ),',
                    '      );',
                    '    }',
                ),
                replace: '    appendStepFinalAnswerFromProjection(session, projection);',
            },
        ],
    },
};

function countOccurrences(haystack, needle) {
    return haystack.split(needle).length - 1;
}

function transformContent(relPath, content) {
    const cfg = FILES[relPath];
    if (!cfg) throw new Error('未知文件: ' + relPath);
    if (content.includes(cfg.marker)) return { content, skipped: true, applied: [] };
    let next = content;
    const applied = [];
    cfg.edits.forEach((edit, i) => {
        const found = countOccurrences(next, edit.find);
        if (found !== edit.count) {
            throw new Error(
                relPath + ': edit#' + i + ' (' + edit.name + ') 期望命中 ' + edit.count + ' 处，实际 ' + found + ' 处',
            );
        }
        next = next.split(edit.find).join(edit.replace);
        applied.push(edit.name + ' x' + edit.count);
    });
    return { content: next, skipped: false, applied };
}

function main() {
    const writes = [];

    // 1) 新增共享文件（不覆盖已存在的不同内容）
    const newAbs = path.join(ROOT, NEW_FILE);
    let newFileAction = 'create';
    if (fs.existsSync(newAbs)) {
        const existing = fs.readFileSync(newAbs, 'utf8');
        if (existing === NEW_FILE_CONTENT) {
            newFileAction = 'skip (相同)';
        } else {
            throw new Error(NEW_FILE + ' 已存在且内容不同，已中止以免覆盖。请人工核对。');
        }
    }
    if (newFileAction === 'create') {
        writes.push({ abs: newAbs, content: NEW_FILE_CONTENT });
    }

    // 2) 内存内校验两个文件（全部通过才写盘）
    const fileResults = [];
    for (const relPath of Object.keys(FILES)) {
        const abs = path.join(ROOT, relPath);
        const content = fs.readFileSync(abs, 'utf8');
        const res = transformContent(relPath, content);
        fileResults.push({ relPath, abs, res });
        if (!res.skipped && res.content !== content) {
            writes.push({ abs, content: res.content });
        }
    }

    // 3) 统一写盘
    for (const w of writes) {
        fs.mkdirSync(path.dirname(w.abs), { recursive: true });
        fs.writeFileSync(w.abs, w.content, 'utf8');
    }

    // 4) 报告
    console.log('NEW FILE ' + NEW_FILE + ': ' + newFileAction);
    for (const f of fileResults) {
        console.log(
            (f.res.skipped ? 'SKIP ' : '✓ ') + f.relPath + (f.res.skipped ? ' (已迁移)' : ' [' + f.res.applied.join(', ') + ']'),
        );
    }
    console.log('DONE: 写盘 ' + writes.length + ' 个文件');
}

module.exports = { transformContent, FILES, NEW_FILE, NEW_FILE_CONTENT, countOccurrences };

if (require.main === module) {
    main();
}