/**
 * useCopilotContext — exposes editor state to the AI agent via CopilotKit's
 * `useCopilotReadable`. Replaces manual context building in useAiAssistant.
 * Each readable degrades to no-op when CopilotKitProvider is absent.
 *
 * ⚠️ @copilotkit/vue 的 useCopilotReadable 对 `options.value` 直接 JSON.stringify,
 * **不** unref。因此不能直接传 computed(会把 ComputedRefImpl 交给库、撞环报
 * "Converting circular structure to JSON"),也不能传裸 getter(stringify(fn)=undefined,
 * 无数据且丢响应)。正确做法:用 reactive() 包裹 options,让 Vue 在 `.value`
 * 访问时自动解包 computed —— 既得纯对象可序列化,watch 又能追踪依赖保持响应。
 */
import { useCopilotReadable } from '@copilotkit/vue';
import { computed, type Ref, reactive } from 'vue';
import type {
  IActiveRunSummary,
  IAnalyzeScriptPayload,
  IEditorDocument,
  IEditorSelectionSummary,
} from '@/types/editor';
import type { IGitRepositoryStatusPayload } from '@/types/git';

export const CONTEXT_LIMITS = {
  documentChars: 8_000,
  selectionChars: 4_000,
  gitFiles: 30,
} as const;

const safeSlice = (str: string, max: number): string => {
  if (str.length <= max) return str;
  let end = max;
  if ((str.charCodeAt(end - 1) & 0xfc00) === 0xd800) end -= 1;
  return str.slice(0, end);
};

const fmt = {
  documentDesc: '当前编辑器中打开的文件内容及元信息',
  selectionDesc: '用户在编辑器中选中的文本（如有）',
  gitDesc: '当前工作区 Git 仓库变更状态',
  activeRunDesc: '当前正在运行的脚本信息（如有）',
  workspaceDesc: '当前工作区根目录路径',
  unsaved: '(未保存)',
  noSel: '无选中文本',
  noGit: '无变更',
  gitUnavail: '当前工作区不是 Git 仓库',
  noRun: '无运行中的脚本',
  noWs: '(未打开工作区)',
  truncSuffix: (n: number) => `\n\n[内容已截断，总长 ${n} 字符]`,
};

const safeReadable = (desc: string, getValue: () => unknown): void => {
  try {
    // reactive() 使 Vue 在访问 .value 时自动解包 computed → 库拿到纯值可序列化,
    // 同时库内 watch(() => options.value) 仍追踪 computed 依赖,保持响应更新。
    useCopilotReadable(reactive({ description: desc, value: computed(getValue) }));
  } catch {
    /* no-op */
  }
};

export interface IUseCopilotContextOptions {
  document: Ref<IEditorDocument>;
  activeRun: Ref<IActiveRunSummary | null>;
  analysis: Ref<IAnalyzeScriptPayload>;
  selection: Ref<IEditorSelectionSummary | null>;
  gitStatus: Ref<IGitRepositoryStatusPayload>;
  workspaceRootPath: Ref<string | null>;
}

export const useCopilotContext = (options: IUseCopilotContextOptions): void => {
  safeReadable(fmt.documentDesc, () => {
    const doc = options.document.value;
    const content = doc.content ?? '';
    return {
      path: doc.path ?? fmt.unsaved,
      name: doc.name,
      lineCount: doc.lineCount,
      isDirty: doc.isDirty,
      content:
        content.length > CONTEXT_LIMITS.documentChars
          ? safeSlice(content, CONTEXT_LIMITS.documentChars) + fmt.truncSuffix(content.length)
          : content,
    };
  });

  safeReadable(fmt.selectionDesc, () => {
    const sel = options.selection.value;
    return sel?.text
      ? {
          selectedText: safeSlice(sel.text, CONTEXT_LIMITS.selectionChars),
          startLine: sel.startLine,
          endLine: sel.endLine,
        }
      : fmt.noSel;
  });

  safeReadable(fmt.gitDesc, () => {
    const git = options.gitStatus.value;
    if (!git.available) return fmt.gitUnavail;
    if (git.isClean) return fmt.noGit;
    return {
      stagedCount: git.stagedCount,
      unstagedCount: git.unstagedCount,
      untrackedCount: git.untrackedCount,
      conflictedCount: git.conflictedCount,
      files: git.files
        .slice(0, CONTEXT_LIMITS.gitFiles)
        .map(
          (f: {
            path: string;
            indexStatus: unknown;
            worktreeStatus: unknown;
            isUntracked: boolean;
          }) => ({
            path: f.path,
            index: f.indexStatus,
            worktree: f.worktreeStatus,
            untracked: f.isUntracked,
          }),
        ),
    };
  });

  safeReadable(fmt.activeRunDesc, () => {
    const run = options.activeRun.value;
    return run
      ? { documentName: run.documentName, executor: run.executorLabel, runId: run.runId }
      : fmt.noRun;
  });

  safeReadable(fmt.workspaceDesc, () => options.workspaceRootPath.value ?? fmt.noWs);
};
