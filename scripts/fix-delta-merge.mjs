import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/composables/ai/useAiAssistant.stream.ts';

const oldLines = [
  '/**',
  ' * 把同一 phase 的两个 message_delta 合并成一个「累计文本」事件。',
  ' *',
  ' * 后端(Node sidecar)按「增量片段」下发 message_delta(与 plain-chat 的',
  ' * append 语义一致,源码注释明确写道 "emit only the incremental text; the',
  ' * frontend accumulates it")。因此缓冲区必须把同一 phase 的增量拼接成完整文本,',
  ' * 而不是用最新片段覆盖旧片段。',
  ' *',
  ' * 否则下游 updateSidecarAnswerStreamContent 会把 finalMessageEvent.text 当成',
  ' * 「累计完整文本」做前缀 diff:新片段不以上一片段为前缀 → 反复 reset+append,',
  ' * 表现为「逐段替换、上一段消失」,并在 done 收到完整文本时整段弹出。',
  ' */',
  'const mergeMessageDeltaText = (',
  "  existing: Extract<TAgentUiEvent, { type: 'message_delta' }>,",
  "  incoming: Extract<TAgentUiEvent, { type: 'message_delta' }>,",
  "): Extract<TAgentUiEvent, { type: 'message_delta' }> => ({",
  '  ...incoming,',
  "  text: `${existing.text ?? ''}${incoming.text ?? ''}`,",
  '});',
];

const newLines = [
  '// message_delta 下发的是「累计完整文本」快照而非增量片段；下游用前缀 diff 揭示，',
  '// 故合并时取最新一条完整文本，不拼接（拼接会重复，如 AB+ABC=ABABC）。',
  'const mergeMessageDeltaText = (',
  "  _existing: Extract<TAgentUiEvent, { type: 'message_delta' }>,",
  "  incoming: Extract<TAgentUiEvent, { type: 'message_delta' }>,",
  "): Extract<TAgentUiEvent, { type: 'message_delta' }> => ({",
  '  ...incoming,',
  '});',
];

let src = readFileSync(FILE, 'utf8');
const orig = src;

// 幂等：主改动（对 \r\n 和 \n 两种换行都试）
if (!src.includes("text: `${existing.text ?? ''}${incoming.text")) {
  console.log('[skip] mergeMessageDeltaText 已是「取最新」语义，跳过主改动');
} else {
  let replaced = false;
  for (const eol of ['\r\n', '\n']) {
    const oldBlock = oldLines.join(eol);
    if (src.includes(oldBlock)) {
      src = src.replace(oldBlock, newLines.join(eol));
      replaced = true;
      console.log(`[ok] mergeMessageDeltaText 改为取最新累计文本（EOL=${eol === '\r\n' ? 'CRLF' : 'LF'}，-11 行）`);
      break;
    }
  }
  if (!replaced) {
    console.error('[FAIL] 两种换行都未匹配到 mergeMessageDeltaText 整块锚点，已中止（未改动）');
    process.exit(1);
  }
}

// 顺带修正两处会误导的行内注释（单行，换行无关；找不到就跳过）
const commentFixes = [
  {
    from: '      // 增量累加,而非覆盖:保证保留的 events 中该 phase 的 message_delta 始终是完整文本。',
    to: '      // 取最新累计快照,而非拼接:保证保留的 events 中该 phase 的 message_delta 始终是完整文本。',
  },
  {
    from: '      // 同一帧内合并多个增量时同样累加文本,避免丢字。',
    to: '      // 同一帧内多条 message_delta 同样取最新累计文本,避免重复。',
  },
];

for (const { from, to } of commentFixes) {
  if (src.includes(from)) {
    src = src.replace(from, to);
  } else if (!src.includes(to)) {
    console.warn('[warn] 行内注释锚点未命中，已跳过：' + from.trim().slice(0, 24) + '…');
  }
}

if (src === orig) {
  console.log('[noop] 文件无变化');
} else {
  writeFileSync(FILE, src, 'utf8');
  console.log(`[done] 已写入 ${FILE}（当前 ${src.split('\n').length} 行）`);
}