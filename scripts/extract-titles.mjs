import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/composables/ai/useAiAssistant.ts';
let src = readFileSync(FILE, 'utf8');

if (src.includes('useAiAssistant.conversation-titles')) {
    console.log('[skip] 已接线，无需重复执行');
    process.exit(0);
}

const edits = [
    // 1) 新增 import（接在 shellcheck import 之后）
    [
        `import { runShellCheckForAppliedPatch } from './useAiAssistant.shellcheck';\n`,
        `import { runShellCheckForAppliedPatch } from './useAiAssistant.shellcheck';\nimport { useAiConversationTitles } from './useAiAssistant.conversation-titles';\n`,
    ],
    // 2) 删除模块级 CONVERSATION_TITLE_RETRY_DELAYS_MS 常量
    [
        `\nconst CONVERSATION_TITLE_RETRY_DELAYS_MS = [1500, 3000, 5000, 9000, 16000, 30000, 60000] as const;`,
        ``,
    ],
    // 3) 删除 3 个标题 Map，并在 displayMessages 后插入子 composable 接线
    [
        `  const displayMessages = shallowRef<IAiChatMessage[]>(unref(conversationStore.activeMessages));\n  const pendingTitleThreadIds = new Set<string>();\n  const pendingTitleRetryTimers = new Map<string, ReturnType<typeof window.setTimeout>>();\n  const titleRetryAttemptByThreadId = new Map<string, number>();\n`,
        `  const displayMessages = shallowRef<IAiChatMessage[]>(unref(conversationStore.activeMessages));\n\n  const { maybeGenerateConversationTitle } = useAiConversationTitles({ conversationStore });\n`,
    ],
    // 4) onScopeDispose 只保留 clearAttachedFiles
    [
        `    onScopeDispose(() => {\n      clearAttachedFiles();\n      pendingTitleRetryTimers.forEach((timerId) => {\n        window.clearTimeout(timerId);\n      });\n      pendingTitleRetryTimers.clear();\n      titleRetryAttemptByThreadId.clear();\n    });`,
        `    onScopeDispose(() => {\n      clearAttachedFiles();\n    });`,
    ],
    // 5) 删除 clearConversationTitleRetryTimer
    [
        `  const clearConversationTitleRetryTimer = (threadId: string): void => {\n    const timerId = pendingTitleRetryTimers.get(threadId);\n\n    if (timerId === undefined || typeof window === 'undefined') {\n      pendingTitleRetryTimers.delete(threadId);\n      return;\n    }\n\n    window.clearTimeout(timerId);\n    pendingTitleRetryTimers.delete(threadId);\n  };\n\n`,
        ``,
    ],
    // 6) 删除 maybeGenerateConversationTitle（整块搬走）
    [
        `  const maybeGenerateConversationTitle = async (threadId: string | null): Promise<void> => {\n    if (!threadId || pendingTitleThreadIds.has(threadId)) {\n      return;\n    }\n\n    const titleStatus = conversationStore.getThreadTitleStatus(threadId);\n    const retryAttempt = titleRetryAttemptByThreadId.get(threadId) ?? 0;\n    const canRetryFailedTitle =\n      retryAttempt > 0 && retryAttempt <= CONVERSATION_TITLE_RETRY_DELAYS_MS.length;\n\n    if (titleStatus !== 'temporary' && !canRetryFailedTitle) {\n      return;\n    }\n\n    const firstRound = conversationStore.getFirstRoundForTitle(threadId);\n\n    if (!firstRound) {\n      return;\n    }\n\n    pendingTitleThreadIds.add(threadId);\n    clearConversationTitleRetryTimer(threadId);\n    conversationStore.markThreadTitleGenerating(threadId);\n\n    try {\n      const payload = await aiService.generateConversationTitle(firstRound);\n      conversationStore.completeThreadTitleGeneration(threadId, payload.title);\n      clearConversationTitleRetryTimer(threadId);\n      titleRetryAttemptByThreadId.delete(threadId);\n    } catch (error) {\n      conversationStore.failThreadTitleGeneration(threadId);\n      const nextRetryAttempt = (titleRetryAttemptByThreadId.get(threadId) ?? 0) + 1;\n      titleRetryAttemptByThreadId.set(threadId, nextRetryAttempt);\n      const retryDelay = CONVERSATION_TITLE_RETRY_DELAYS_MS[nextRetryAttempt - 1];\n      const hasScope = typeof window !== 'undefined';\n\n      if (hasScope && retryDelay !== undefined) {\n        const retryTimer = window.setTimeout(() => {\n          pendingTitleRetryTimers.delete(threadId);\n          void maybeGenerateConversationTitle(threadId);\n        }, retryDelay);\n        pendingTitleRetryTimers.set(threadId, retryTimer);\n      } else if (retryDelay === undefined) {\n        titleRetryAttemptByThreadId.delete(threadId);\n      }\n\n      logger.warn({\n        event: 'ai.conversation_title.failed',\n        err: error,\n        threadId,\n        retryDelay,\n        retryAttempt: nextRetryAttempt,\n      });\n    } finally {\n      pendingTitleThreadIds.delete(threadId);\n    }\n  };\n\n`,
        ``,
    ],
];

for (const [from, to] of edits) {
    if (!src.includes(from)) {
        console.error('[FAIL] 未找到锚点，已中止（文件未改动）:\n' + from.slice(0, 80) + '…');
        process.exit(1);
    }
    src = src.replace(from, to);
}

writeFileSync(FILE, src, 'utf8');
console.log('[ok] 已接线 useAiConversationTitles');