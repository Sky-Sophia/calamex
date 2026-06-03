import { readFileSync, writeFileSync } from 'node:fs';

const MAIN = 'src/composables/ai/useAiAssistant.ts';
const NEW = 'src/composables/ai/useAiAssistant.stream-pipeline.ts';

function fail(msg) {
    console.error('[FAIL] ' + msg + '（未写入任何文件）');
    process.exit(1);
}

const newFileLines = [
    "import type { Ref } from 'vue';",
    "import type { useAiStream } from '@/composables/ai/useAiStream';",
    "import type { IAiChatMessage, IAiChatStreamEventPayload } from '@/types/ai';",
    "import { hasStreamTokenSnapshot, mergeStreamTokenSnapshot } from './useAiAssistant.stream';",
    "",
    "const MSG_STREAM_ERROR = 'AI 响应出错';",
    "",
    "export interface IStreamPipeline {",
    "  readonly handleEvent: (event: IAiChatStreamEventPayload) => void;",
    "  readonly startAssistantStream: (streamId: string, assistantMessageId: string) => void;",
    "  readonly flushBufferedText: () => void;",
    "}",
    "",
    "export interface IStreamPipelineDeps {",
    "  aiStream: ReturnType<typeof useAiStream>;",
    "  activeStreamId: Ref<string | null>;",
    "  errorMessage: Ref<string>;",
    "  syncActiveAssistantMessage: () => void;",
    "  clearAttachedFiles: (options?: { revokePreviews?: boolean }) => void;",
    "}",
    "",
    "export const createStreamPipeline = (",
    "  deps: IStreamPipelineDeps,",
    "  assistantMessage: IAiChatMessage,",
    "  settle: () => void,",
    "): IStreamPipeline => {",
    "  const {",
    "    aiStream,",
    "    activeStreamId,",
    "    errorMessage,",
    "    syncActiveAssistantMessage,",
    "    clearAttachedFiles,",
    "  } = deps;",
    "  let isStreamClosed = false;",
    "  let hasStartedStream = false;",
    "",
    "  const flushBufferedText = (): void => {",
    "    aiStream.flushNow();",
    "    syncActiveAssistantMessage();",
    "  };",
    "",
    "  const startAssistantStream = (streamId: string, assistantMessageId: string): void => {",
    "    if (hasStartedStream) {",
    "      return;",
    "    }",
    "",
    "    hasStartedStream = true;",
    "    activeStreamId.value = streamId;",
    "    assistantMessage.id = assistantMessageId;",
    "",
    "    aiStream.start({ messageId: assistantMessageId });",
    "    syncActiveAssistantMessage();",
    "  };",
    "",
    "  const applyStreamTokenSnapshot = (event: IAiChatStreamEventPayload): void => {",
    "    if (!hasStreamTokenSnapshot(event)) {",
    "      return;",
    "    }",
    "",
    "    assistantMessage.stream = mergeStreamTokenSnapshot(assistantMessage.stream, event);",
    "    syncActiveAssistantMessage();",
    "  };",
    "",
    "  const handleEvent = (event: IAiChatStreamEventPayload): void => {",
    "    if (!activeStreamId.value && event.kind === 'start') {",
    "      startAssistantStream(event.streamId, event.assistantMessageId);",
    "      applyStreamTokenSnapshot(event);",
    "      return;",
    "    }",
    "",
    "    if (event.streamId !== activeStreamId.value) {",
    "      return;",
    "    }",
    "",
    "    if (isStreamClosed) {",
    "      return;",
    "    }",
    "",
    "    applyStreamTokenSnapshot(event);",
    "",
    "    if (event.kind === 'delta') {",
    "      if (event.delta) {",
    "        aiStream.append(event.delta);",
    "      }",
    "",
    "      return;",
    "    }",
    "",
    "    isStreamClosed = true;",
    "",
    "    if (event.kind === 'done') {",
    "      aiStream.complete();",
    "      syncActiveAssistantMessage();",
    "      clearAttachedFiles({ revokePreviews: false });",
    "      settle();",
    "      return;",
    "    }",
    "",
    "    if (event.kind === 'cancelled') {",
    "      aiStream.stop();",
    "      syncActiveAssistantMessage();",
    "      errorMessage.value = '';",
    "      settle();",
    "      return;",
    "    }",
    "",
    "    if (event.kind === 'error') {",
    "      aiStream.stop();",
    "      syncActiveAssistantMessage();",
    "      errorMessage.value = event.message ?? MSG_STREAM_ERROR;",
    "      settle();",
    "    }",
    "  };",
    "",
    "  return {",
    "    handleEvent,",
    "    startAssistantStream,",
    "    flushBufferedText,",
    "  };",
    "};",
];

let mainSrc = readFileSync(MAIN, 'utf8');
const EOL = mainSrc.includes('\r\n') ? '\r\n' : '\n';

function tryReplace(src, oldLines, newLines, tag) {
    for (const eol of ['\r\n', '\n']) {
        const o = oldLines.join(eol);
        if (src.includes(o)) return src.replace(o, newLines.join(eol));
    }
    fail(tag + ' 锚点未命中');
}
function mustRemove(src, line, tag) {
    for (const t of [line + '\r\n', line + '\n']) {
        if (src.includes(t)) return src.replace(t, '');
    }
    if (src.includes(line)) return src.replace(line, '');
    fail(tag + ' 待删除行未命中: ' + line.slice(0, 40));
}
function lineStart(src, idx) {
    if (idx <= 0) return 0;
    const nl = src.lastIndexOf('\n', idx - 1);
    return nl === -1 ? 0 : nl + 1;
}

let skipped = false;

if (mainSrc.includes('./useAiAssistant.stream-pipeline')) {
    skipped = true;
} else {
    // A: 新增 import（挂在 stream 导入块之后）
    mainSrc = tryReplace(
        mainSrc,
        ["} from './useAiAssistant.stream';"],
        [
            "} from './useAiAssistant.stream';",
            "import { createStreamPipeline } from './useAiAssistant.stream-pipeline';",
        ],
        'A',
    );
    // B/C/D/E: 净删不再使用的 import 与常量
    mainSrc = mustRemove(mainSrc, '  hasStreamTokenSnapshot,', 'B');
    mainSrc = mustRemove(mainSrc, '  mergeStreamTokenSnapshot,', 'C');
    mainSrc = mustRemove(mainSrc, '  IAiChatStreamEventPayload,', 'D');
    mainSrc = mustRemove(mainSrc, "const MSG_STREAM_ERROR = 'AI 响应出错';", 'E');
    // G: 调用处改为传 deps
    mainSrc = tryReplace(
        mainSrc,
        ['    const pipeline = createStreamPipeline(assistantMessage, settle);'],
        [
            '    const pipeline = createStreamPipeline(',
            '      {',
            '        aiStream,',
            '        activeStreamId,',
            '        errorMessage,',
            '        syncActiveAssistantMessage,',
            '        clearAttachedFiles,',
            '      },',
            '      assistantMessage,',
            '      settle,',
            '    );',
        ],
        'G',
    );
    // F: 删 IStreamPipeline 接口 + createStreamPipeline 定义（保留区段头给 executeAiRequest）
    const ifaceIdx = mainSrc.indexOf('  interface IStreamPipeline {');
    if (ifaceIdx < 0) fail('F: 未找到 IStreamPipeline 接口');
    const execIdx = mainSrc.indexOf('  const executeAiRequest = async (');
    if (execIdx < 0) fail('F: 未找到 executeAiRequest');
    if (ifaceIdx >= execIdx) fail('F: 区段边界异常');
    const delStart = lineStart(mainSrc, ifaceIdx);
    const delEnd = lineStart(mainSrc, execIdx);
    mainSrc = mainSrc.slice(0, delStart) + mainSrc.slice(delEnd);
}

writeFileSync(NEW, newFileLines.join(EOL) + EOL, 'utf8');
console.log('[ok] 已写入 ' + NEW + '（' + (newFileLines.length + 1) + ' 行）');

if (skipped) {
    console.log('[skip] 主文件已接线 createStreamPipeline，无需改动');
} else {
    writeFileSync(MAIN, mainSrc, 'utf8');
    console.log('[done] 主文件已接线，当前 ' + mainSrc.split('\n').length + ' 行');
}