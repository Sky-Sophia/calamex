<template>
  <aside class="source-control-sidebar" aria-label="源代码管理">
    <template v-if="!isDesktopRuntime">
      <div class="source-control-empty-shell">
        <section class="source-control-empty-card">
          <p class="source-control-empty-title">源代码管理仅在桌面端可用</p>
          <p class="source-control-empty-text">
            浏览器预览模式下不会调用本地 Git 仓库，请在 Tauri 桌面端查看真实版本控制状态。
          </p>
        </section>
      </div>
    </template>

    <template v-else-if="!workspaceRootPath">
      <div class="source-control-empty-shell">
        <section class="source-control-empty-card">
          <p class="source-control-empty-title">尚未打开工作区</p>
          <p class="source-control-empty-text">
            先打开一个本地文件夹，再在这里查看分支、变更列表和提交入口。
          </p>
        </section>
      </div>
    </template>

    <template v-else-if="!hasRepository">
      <div class="source-control-empty-shell source-control-setup-shell">
        <section class="source-control-setup-panel" aria-label="源代码管理未初始化引导">
          <header class="source-control-setup-project-header">
            <span class="source-control-setup-project-name">{{ workspaceLabel }}</span>
            <svg class="source-control-setup-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </header>

          <div class="source-control-setup-search-bar" aria-disabled="true">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" />
              <line x1="14" y1="14" x2="11" y2="11" />
            </svg>
            <span class="source-control-setup-search-placeholder">搜索变更、分支......</span>

          </div>

          <div class="source-control-setup-empty-state">
            <svg class="source-control-setup-empty-icon" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M14 14 L14 34" />
              <path d="M14 22 Q14 28 20 28 L28 28 Q34 28 34 22 L34 17" />
              <circle cx="14" cy="11" r="3.25" class="is-solid" />
              <circle cx="14" cy="37" r="3.25" class="is-solid" />
              <circle cx="34" cy="14" r="3.5" class="is-accent-ring" />
              <circle cx="34" cy="14" r="1.25" class="is-accent-dot" />
            </svg>

            <p class="source-control-setup-empty-title">此项目未启用版本控制</p>
            <p class="source-control-setup-empty-desc">
              初始化 Git 仓库后可追踪脚本变更、查看 diff、回滚历史。
            </p>

            <p v-if="sourceControlActionError" class="source-control-setup-error">
              {{ sourceControlActionError }}
            </p>

            <div class="source-control-setup-actions">
              <button
                type="button"
                class="source-control-setup-btn source-control-setup-btn-primary"
                :disabled="isBusy || isLoading"
                :aria-busy="pendingAction === 'init-repository'"
                @click="handleInitRepository">
                {{ initRepositoryButtonLabel }}
              </button>

              <button
                type="button"
                class="source-control-setup-btn source-control-setup-btn-secondary"
                :disabled="isBusy || isLoading"
                @click="handleOpenCloneGuide">
                从远程克隆...
              </button>
            </div>

            <div class="source-control-setup-divider"></div>

            <button type="button" class="source-control-setup-footnote" @click="handleOpenGitGuide">
              <span>首次使用?查看 Git 入门指南</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3h7v7" />
                <path d="M13 3L5 11" />
                <path d="M11 10v3H3V5h3" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </template>

    <template v-else>
      <header class="source-control-repo">
        <div class="source-control-repo-copy">
          <p class="source-control-repo-name">{{ status.repositoryName ?? 'Git 仓库' }}</p>
        </div>

        <span class="source-control-repo-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </header>

      <div class="source-control-search">
        <label class="source-control-search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input v-model="searchQuery" type="text" placeholder="搜索变更、分支……" />

        </label>
      </div>

      <div class="source-control-toolbar" aria-label="Git 快捷操作">
        <button
          type="button"
          class="source-control-toolbar-icon"
          :disabled="isBusy"
          title="刷新 Git 状态"
          aria-label="刷新 Git 状态" @click="handleRefresh">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5" />
            <path d="M4 17v-5h5" />
            <path d="M6.8 9a6 6 0 0 1 9.9-2.2L20 10" />
            <path d="M17.2 15a6 6 0 0 1-9.9 2.2L4 14" />
          </svg>
        </button>

        <button type="button" class="source-control-toolbar-btn" :disabled="!canStageAll" @click="handleStageAll">
          全部暂存
        </button>

        <button type="button" class="source-control-toolbar-btn" :disabled="!canUnstageAll" @click="handleUnstageAll">
          全部取消
        </button>

        <button
          type="button"
          class="source-control-toolbar-btn is-danger"
          :disabled="!canDiscardAll"
          @click="handleDiscardAll">
          放弃未暂存
        </button>
      </div>

      <div class="source-control-branch">
        <svg class="source-control-branch-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="3" r="2" />
          <circle cx="6" cy="21" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M6 5v14" />
          <path d="M18 10V8a4 4 0 0 0-4-4h-2" />
        </svg>

        <div class="source-control-branch-copy">
          <p class="source-control-branch-name">{{ branchLabel }}</p>
        </div>

        <div class="source-control-branch-sync">
          <span v-if="status.behind > 0">↓ {{ status.behind }}</span>
          <span v-if="status.ahead > 0">↑ {{ status.ahead }}</span>
          <span v-if="status.ahead === 0 && status.behind === 0">{{ workspaceStateLabel }}</span>
        </div>
      </div>

      <nav class="source-control-nav" aria-label="源代码管理导航">
        <button
          v-for="item in navItems" :key="item.key" type="button" class="source-control-nav-item"
          :class="{ 'is-active': item.active, 'is-inactive': !item.active }"
          :aria-pressed="item.active" @click="selectNavItem(item.key)">
          <svg v-if="item.key === 'changes'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5-5 5 5" />
            <path d="M12 5v12" />
          </svg>
          <svg v-else-if="item.key === 'history'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 3v6h6" />
            <path d="M12 7v5l3 3" />
          </svg>
          <svg v-else-if="item.key === 'branches'" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="4" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path d="M8 6h4a4 4 0 0 1 4 4v6" />
            <path d="M16 6v2" />
          </svg>
          <svg v-else-if="item.key === 'pull-requests'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8a6 6 0 0 1-6 6 6 6 0 0 1-6-6" />
            <path d="M6 16a6 6 0 0 0 12 0" />
          </svg>
          <svg v-else-if="item.key === 'stash'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M7 4h10v6H7z" />
            <path d="M7 13h10v7H7z" />
          </svg>

          <span class="source-control-nav-label">{{ item.label }}</span>
          <span class="source-control-nav-count">{{ item.count }}</span>
        </button>
      </nav>

      <div class="source-control-scroll">
        <template v-if="activeTab === 'changes'">
          <section v-if="!hasVisibleChanges" class="source-control-empty-card source-control-empty-card-inline">
            <p class="source-control-empty-title">{{ emptyChangesTitle }}</p>
            <p class="source-control-empty-text">{{ emptyChangesText }}</p>
          </section>

          <section
            v-for="section in filteredSections" :key="section.key" class="source-control-section"
            :class="{ 'is-collapsed': collapsedSections[section.key] }">
            <button type="button" class="source-control-section-header" @click="toggleSectionCollapse(section.key)">
              <svg class="source-control-section-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span>{{ section.title }}</span>
              <span class="source-control-section-count">{{ section.entries.length }}</span>
            </button>

            <div class="source-control-file-list">
              <article
                v-for="entry in section.entries" :key="section.key + ':' + entry.path" class="source-control-file"
                :class="{ 'is-active': isActivePath(entry.path) }"
                @contextmenu.prevent.stop="handleEntryContextMenu($event, section.key, entry)">
                <button type="button" class="source-control-file-main" @click="handleOpenFile(entry.path)">
                  <span class="source-control-file-tag" :class="'is-' + resolveEntryTagTone(section.key, entry)">
                    {{ resolveEntryTag(section.key, entry) }}
                  </span>

                  <span class="source-control-file-path">
                    <span class="source-control-file-name">{{ resolveEntryDisplayName(entry) }}</span>
                    <span class="source-control-file-dir">{{ resolveEntryDirectory(entry) }}</span>
                  </span>
                </button>

                <div v-if="resolveEntryActions(section.key, entry).length > 0" class="source-control-file-actions">
                  <button
                    v-for="action in resolveEntryActions(section.key, entry)"
                    :key="section.key + ':' + entry.path + ':' + action.key" type="button" class="source-control-icon-btn"
                    :disabled="isBusy" :aria-label="action.title" :title="action.title"
                    @click.stop="handleEntryAction(action.key, section.key, entry)">
                    <svg v-if="action.icon === 'plus'" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                    <svg v-else-if="action.icon === 'minus'" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14H7L5 6" />
                    </svg>
                  </button>
                </div>
              </article>
            </div>
          </section>
        </template>

        <section v-else-if="activeTab === 'history'" class="source-control-info-panel">
          <p class="source-control-info-eyebrow">Latest commit</p>
          <template v-if="status.lastCommit">
            <p class="source-control-info-title">{{ status.lastCommit.summary }}</p>
            <p class="source-control-info-text">
              {{ status.lastCommit.shortId }} · {{ status.lastCommit.authorName }} ·
              {{ formatCommitTime(status.lastCommit.authoredAt) }}
            </p>
          </template>
          <p v-else class="source-control-info-text">当前仓库还没有提交记录。</p>
          <p class="source-control-info-note">完整提交历史分页尚未开放，当前仅展示 HEAD 摘要，避免伪造历史列表。</p>
        </section>

        <section v-else-if="activeTab === 'branches'" class="source-control-info-panel">
          <p class="source-control-info-eyebrow">Branch</p>
          <p class="source-control-info-title">{{ branchLabel }}</p>
          <p class="source-control-info-text">
            Ahead {{ status.ahead }} · Behind {{ status.behind }} ·
            {{ status.isDetached ? 'Detached HEAD' : '本地分支' }}
          </p>
          <p class="source-control-info-note">切换/新建分支需要工作区脏状态保护，后端命令未开放前不提供空按钮。</p>
        </section>

        <section v-else-if="activeTab === 'pull-requests'" class="source-control-info-panel">
          <p class="source-control-info-eyebrow">Pull requests</p>
          <p class="source-control-info-title">未连接远程评审服务</p>
          <p class="source-control-info-text">本地 Git 状态可用；PR 需要远程平台授权与 API，当前不会展示假数据。</p>
        </section>

        <section v-else class="source-control-info-panel">
          <p class="source-control-info-eyebrow">Stash</p>
          <p class="source-control-info-title">贮藏命令尚未开放</p>
          <p class="source-control-info-text">为避免误丢改动，stash save/apply/drop 会在 Rust 命令与测试补齐后启用。</p>
        </section>
      </div>

      <footer v-if="activeTab === 'changes'" class="source-control-commit">
        <textarea
          v-model="commitMessage" class="source-control-commit-input" rows="3"
          placeholder="feat(scope): 简短说明（Ctrl+Enter 提交）"
          :disabled="isBusy" @keydown.ctrl.enter.prevent="handleCommit" @keydown.meta.enter.prevent="handleCommit" />

        <p class="source-control-commit-hint" :class="{ 'is-warning': commitValidationMessage }">
          {{ commitValidationMessage ?? '建议使用 Conventional Commit，例如 feat(terminal): 修复提示符' }}
        </p>

        <div class="source-control-commit-actions">
          <button
            type="button" class="source-control-btn source-control-btn-primary" :disabled="!canCommit"
            @click="handleCommit">
            {{ commitButtonLabel }}
          </button>

          <button
            type="button" class="source-control-btn source-control-btn-icon" :disabled="isBusy" aria-label="更多 Git 操作"
            title="更多 Git 操作" @click="handleMoreActions">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </footer>

      <div class="source-control-statusbar">
        <span class="source-control-status-dot" :class="`is-${statusDotTone}`"></span>
        <span>{{ statusbarText }}</span>
      </div>

      <LinearContextMenu
        :open="scmMenuState.open"
        :x="scmMenuState.x"
        :y="scmMenuState.y"
        :groups="scmMenuGroups"
        theme="dark"
        submenu-direction="right"
        @select="handleContextMenuSelect"
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import LinearContextMenu from '@/components/common/LinearContextMenu.vue';
import type {
  ILinearContextMenuGroup,
  ILinearContextMenuItem,
} from '@/components/common/linear-context-menu.types';
import { useDialog } from '@/composables/useDialog';
import { useMessage } from '@/composables/useMessage';
import { useGitStore } from '@/store/git';
import type {
  IGitFileStatusPayload,
  IGitRepositoryStatusPayload,
  TGitChangeKind,
} from '@/types/git';
import { openExternalUrl } from '@/utils/browser';
import { writeClipboardText } from '@/utils/clipboard';
import { toErrorMessage } from '@/utils/error';
import {
  areFileSystemPathsEqual,
  getPathBaseName,
  getPathDirectory,
} from '@/utils/path';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

const GIT_GETTING_STARTED_URL = 'https://git-scm.com/book/zh/v2';
const GIT_CLONE_GUIDE_URL =
  'https://git-scm.com/book/zh/v2/Git-%E5%9F%BA%E7%A1%80-%E8%8E%B7%E5%8F%96-Git-%E4%BB%93%E5%BA%93';
const SOURCE_CONTROL_MENU_WIDTH = 240;
const SOURCE_CONTROL_MENU_HEIGHT = 320;
const SOURCE_CONTROL_MENU_VIEWPORT_PADDING = 12;
const SOURCE_CONTROL_MENU_ROOT_SELECTOR = '.linear-context-menu-root';
const COMMIT_MESSAGE_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;
const COMMIT_MESSAGE_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_.-]+\))?!?: .+$/u;
const COMMIT_SUBJECT_MAX_LENGTH = 50;

type TGitSectionKey = 'conflicts' | 'staged' | 'changes' | 'untracked';
type TGitNavKey = 'changes' | 'history' | 'branches' | 'pull-requests' | 'stash';
type TGitEntryActionKey = 'stage' | 'unstage' | 'discard';
type TStatusTone = 'success' | 'warning' | 'danger' | 'loading';
type TSourceControlMenuAction =
  | 'refresh'
  | 'stage-all'
  | 'unstage-all'
  | 'discard-all'
  | 'commit'
  | 'open-file'
  | 'copy-path'
  | 'stage-entry'
  | 'unstage-entry'
  | 'discard-entry';

interface IGitSection {
  key: TGitSectionKey;
  title: string;
  entries: IGitFileStatusPayload[];
}

interface IGitEntryAction {
  key: TGitEntryActionKey;
  title: string;
  icon: 'plus' | 'minus' | 'trash';
}

interface IGitNavItem {
  key: TGitNavKey;
  label: string;
  count: number;
  active: boolean;
}

interface ISourceControlMenuItem extends ILinearContextMenuItem {
  action: TSourceControlMenuAction;
  sectionKey?: TGitSectionKey;
  entry?: IGitFileStatusPayload;
}

type TSourceControlMenuGroup = ILinearContextMenuGroup<ISourceControlMenuItem>;

interface ISourceControlMenuState {
  open: boolean;
  x: number;
  y: number;
}

const props = defineProps<{
  isDesktopRuntime: boolean;
  workspaceRootPath: string | null;
  activePath: string | null;
}>();

const emit = defineEmits<{
  'open-file': [path: string];
}>();

const gitStore = useGitStore();
const message = useMessage();
const dialog = useDialog();
const commitMessage = ref('');
const searchQuery = ref('');
const activeTab = ref<TGitNavKey>('changes');
const pendingAction = ref<string | null>(null);
const lastSyncedAt = ref<number | null>(null);
const sourceControlActionError = ref<string | null>(null);
const scmMenuState = reactive<ISourceControlMenuState>({
  open: false,
  x: 0,
  y: 0,
});
const scmMenuGroups = ref<TSourceControlMenuGroup[]>([]);
const collapsedSections = reactive<Record<TGitSectionKey, boolean>>({
  conflicts: false,
  staged: false,
  changes: false,
  untracked: false,
});

const status = computed(() => gitStore.status);
const isLoading = computed(() => gitStore.isLoading);
const hasRepository = computed(
  () => status.value.available && Boolean(status.value.repositoryRootPath),
);
const isBusy = computed(() => pendingAction.value !== null);
const totalChangeCount = computed(
  () =>
    status.value.stagedCount +
    status.value.unstagedCount +
    status.value.untrackedCount +
    status.value.conflictedCount,
);
const workspaceLabel = computed(() => {
  const workspaceRootPath = props.workspaceRootPath;
  if (!workspaceRootPath) {
    return '当前项目';
  }

  return getPathBaseName(workspaceRootPath) || workspaceRootPath;
});
const initRepositoryButtonLabel = '初始化 Git 仓库';

const resetSectionCollapse = (): void => {
  collapsedSections.conflicts = false;
  collapsedSections.staged = false;
  collapsedSections.changes = false;
  collapsedSections.untracked = false;
};

const markStatusSynced = (): void => {
  lastSyncedAt.value = Date.now();
};

const runWithPending = async (key: string, task: () => Promise<void>): Promise<boolean> => {
  if (pendingAction.value) {
    return false;
  }

  pendingAction.value = key;

  try {
    await task();
    return true;
  } finally {
    pendingAction.value = null;
  }
};

const clampMenuPosition = (clientX: number, clientY: number): { x: number; y: number } => {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY };
  }

  return {
    x: Math.min(
      clientX,
      Math.max(
        SOURCE_CONTROL_MENU_VIEWPORT_PADDING,
        window.innerWidth - SOURCE_CONTROL_MENU_WIDTH - SOURCE_CONTROL_MENU_VIEWPORT_PADDING,
      ),
    ),
    y: Math.min(
      clientY,
      Math.max(
        SOURCE_CONTROL_MENU_VIEWPORT_PADDING,
        window.innerHeight - SOURCE_CONTROL_MENU_HEIGHT - SOURCE_CONTROL_MENU_VIEWPORT_PADDING,
      ),
    ),
  };
};

const closeSourceControlMenu = (): void => {
  scmMenuState.open = false;
  scmMenuGroups.value = [];
};

const openSourceControlMenu = (
  point: { x: number; y: number },
  groups: TSourceControlMenuGroup[],
): void => {
  const nextPoint = clampMenuPosition(point.x, point.y);
  scmMenuState.x = nextPoint.x;
  scmMenuState.y = nextPoint.y;
  scmMenuGroups.value = groups;
  scmMenuState.open = groups.some((group) => group.items.length > 0);
};

const syncRepositoryStatus = async (
  workspaceRootPath: string,
  options?: {
    showSuccessMessage?: boolean;
    showErrorMessage?: boolean;
  },
): Promise<void> => {
  try {
    const didRun = await runWithPending('refresh', async () => {
      await gitStore.refreshRepositoryStatus(workspaceRootPath);
    });

    if (!didRun) {
      return;
    }

    markStatusSynced();

    if (options?.showSuccessMessage) {
      message.success('Git 状态已刷新');
    }
  } catch (error) {
    if (options?.showErrorMessage) {
      message.error(toErrorMessage(error, '刷新 Git 状态失败'));
    }
  }
};

const assertWorkspaceRepositoryReady = (
  payload: IGitRepositoryStatusPayload,
  workspaceRootPath: string,
): void => {
  if (!payload.available || !payload.repositoryRootPath) {
    throw new Error(payload.message ?? 'Git 初始化后仍未检测到仓库。');
  }

  if (!areFileSystemPathsEqual(payload.repositoryRootPath, workspaceRootPath)) {
    throw new Error(
      `Git 仓库根目录与当前工作区不一致：当前工作区 ${workspaceRootPath}，检测到 ${payload.repositoryRootPath}。`,
    );
  }
};

const conflictedEntries = computed(() => status.value.files.filter((entry) => entry.isConflicted));
const stagedEntries = computed(() =>
  status.value.files.filter((entry) => entry.indexStatus !== null && !entry.isConflicted),
);
const changedEntries = computed(() =>
  status.value.files.filter(
    (entry) =>
      entry.worktreeStatus !== null && entry.worktreeStatus !== 'untracked' && !entry.isConflicted,
  ),
);
const untrackedEntries = computed(() => status.value.files.filter((entry) => entry.isUntracked));
const stageableEntries = computed(() => [...changedEntries.value, ...untrackedEntries.value]);
const discardableEntries = computed(() => [...changedEntries.value, ...untrackedEntries.value]);
const stagedPaths = computed(() => stagedEntries.value.map((entry) => entry.path));
const canStageAll = computed(() => stageableEntries.value.length > 0 && !isBusy.value);
const canUnstageAll = computed(() => stagedPaths.value.length > 0 && !isBusy.value);
const canDiscardAll = computed(() => discardableEntries.value.length > 0 && !isBusy.value);

const sections = computed<IGitSection[]>(() => {
  const nextSections: IGitSection[] = [];

  if (conflictedEntries.value.length > 0) {
    nextSections.push({
      key: 'conflicts',
      title: '冲突',
      entries: conflictedEntries.value,
    });
  }

  if (stagedEntries.value.length > 0) {
    nextSections.push({
      key: 'staged',
      title: '已暂存',
      entries: stagedEntries.value,
    });
  }

  if (changedEntries.value.length > 0) {
    nextSections.push({
      key: 'changes',
      title: '变更',
      entries: changedEntries.value,
    });
  }

  if (untrackedEntries.value.length > 0) {
    nextSections.push({
      key: 'untracked',
      title: '未跟踪',
      entries: untrackedEntries.value,
    });
  }

  return nextSections;
});

const filteredSections = computed<IGitSection[]>(() => {
  const keyword = searchQuery.value.trim().toLowerCase();
  if (!keyword) {
    return sections.value;
  }

  return sections.value
    .map((section) => {
      const matchesSection = section.title.toLowerCase().includes(keyword);
      const entries = matchesSection
        ? section.entries
        : section.entries.filter((entry) => {
          const haystack = [
            entry.fileName,
            entry.relativePath,
            entry.previousRelativePath ?? '',
            entry.indexStatus ?? '',
            entry.worktreeStatus ?? '',
          ]
            .join(' ')
            .toLowerCase();

          return haystack.includes(keyword);
        });

      return {
        ...section,
        entries,
      };
    })
    .filter((section) => section.entries.length > 0);
});

const validateCommitMessage = (messageValue: string): string | null => {
  const trimmedMessage = messageValue.trim();
  if (!trimmedMessage) {
    return null;
  }

  if (!COMMIT_MESSAGE_PATTERN.test(trimmedMessage)) {
    return `提交格式需为 ${COMMIT_MESSAGE_TYPES.join('|')}(scope): 说明`;
  }

  const subject = trimmedMessage.split(': ', 2)[1] ?? '';
  if (Array.from(subject).length > COMMIT_SUBJECT_MAX_LENGTH) {
    return `提交说明需不超过 ${COMMIT_SUBJECT_MAX_LENGTH} 个字符`;
  }

  if (/[。.]$/u.test(subject)) {
    return '提交说明结尾不要加句号';
  }

  return null;
};

const hasVisibleChanges = computed(() => filteredSections.value.some((section) => section.entries.length > 0));
const commitValidationMessage = computed(() => validateCommitMessage(commitMessage.value));
const canCommit = computed(
  () =>
    status.value.stagedCount > 0 &&
    commitMessage.value.trim().length > 0 &&
    commitValidationMessage.value === null &&
    !isBusy.value,
);

const branchLabel = computed(() => {
  if (status.value.isDetached) {
    return `detached @ ${status.value.headShortOid ?? 'HEAD'}`;
  }

  return status.value.headShortName ?? status.value.headBranchName ?? '未知分支';
});

const workspaceStateLabel = computed(() => {
  if (status.value.conflictedCount > 0) {
    return '存在冲突';
  }

  if (status.value.isClean) {
    return '工作区干净';
  }

  return `${totalChangeCount.value} 项变更`;
});

const navItems = computed<IGitNavItem[]>(() => [
  {
    key: 'changes',
    label: '变更',
    count: totalChangeCount.value,
    active: activeTab.value === 'changes',
  },
  {
    key: 'history',
    label: '历史',
    count: status.value.lastCommit ? 1 : 0,
    active: activeTab.value === 'history',
  },
  {
    key: 'branches',
    label: '分支',
    count: status.value.headBranchName ? 1 : 0,
    active: activeTab.value === 'branches',
  },
  {
    key: 'pull-requests',
    label: '拉取请求',
    count: 0,
    active: activeTab.value === 'pull-requests',
  },
  {
    key: 'stash',
    label: '贮藏',
    count: 0,
    active: activeTab.value === 'stash',
  },
]);

const emptyChangesTitle = computed(() =>
  searchQuery.value.trim() ? '没有匹配的变更' : '当前没有可显示的变更',
);

const emptyChangesText = computed(() =>
  searchQuery.value.trim()
    ? '试试搜索文件名、目录、状态，或者清空搜索关键字。'
    : '工作区已经和 HEAD 保持一致。保存新的文件改动后，这里会显示最新变更。',
);

const commitButtonLabel = computed(() =>
  pendingAction.value === 'commit' ? '提交中...' : '提交更改',
);

const statusDotTone = computed<TStatusTone>(() => {
  if (isLoading.value) {
    return 'loading';
  }

  if (status.value.conflictedCount > 0) {
    return 'danger';
  }

  if (totalChangeCount.value > 0) {
    return 'warning';
  }

  return 'success';
});

const formatRelativeTime = (timestamp: number): string => {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  if (elapsedMs < 30_000) {
    return '刚刚';
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
};

const formatCommitTime = (value: string): string => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return formatRelativeTime(timestamp);
};

const statusbarText = computed(() => {
  if (isLoading.value) {
    return '正在同步 Git 状态…';
  }

  if (lastSyncedAt.value === null) {
    return workspaceStateLabel.value;
  }

  return `已同步 · ${formatRelativeTime(lastSyncedAt.value)}`;
});

const resolveEntryKind = (
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): TGitChangeKind => {
  switch (sectionKey) {
    case 'staged':
      return entry.indexStatus ?? 'modified';
    case 'changes':
      return entry.worktreeStatus ?? 'modified';
    case 'untracked':
      return 'untracked';
    default:
      return 'conflicted';
  }
};

const resolveEntryTag = (sectionKey: TGitSectionKey, entry: IGitFileStatusPayload): string => {
  switch (resolveEntryKind(sectionKey, entry)) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'typechange':
      return 'T';
    case 'untracked':
      return 'U';
    case 'conflicted':
      return '!';
    default:
      return 'M';
  }
};

const resolveEntryTagTone = (sectionKey: TGitSectionKey, entry: IGitFileStatusPayload): string => {
  switch (resolveEntryKind(sectionKey, entry)) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'typechange':
      return 'typechange';
    case 'untracked':
      return 'untracked';
    case 'conflicted':
      return 'conflicted';
    default:
      return 'modified';
  }
};

const resolveEntryDisplayName = (entry: IGitFileStatusPayload): string => {
  if (entry.fileName) {
    return entry.fileName;
  }

  return getPathBaseName(entry.relativePath) || entry.relativePath;
};

const resolveEntryDirectory = (entry: IGitFileStatusPayload): string => {
  if (entry.previousRelativePath) {
    return `${entry.previousRelativePath} → ${entry.relativePath}`;
  }

  return getPathDirectory(entry.relativePath);
};

const resolveEntryActionTitle = (
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): string => {
  if (sectionKey === 'staged') {
    return `取消暂存 ${entry.fileName}`;
  }

  return `暂存 ${entry.fileName}`;
};

const resolveEntryActions = (
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): IGitEntryAction[] => {
  if (sectionKey === 'conflicts') {
    return [];
  }

  if (sectionKey === 'staged') {
    return [
      {
        key: 'unstage',
        title: resolveEntryActionTitle(sectionKey, entry),
        icon: 'minus',
      },
    ];
  }

  return [
    {
      key: 'discard',
      title: `放弃更改 ${entry.fileName}`,
      icon: 'trash',
    },
    {
      key: 'stage',
      title: resolveEntryActionTitle(sectionKey, entry),
      icon: 'plus',
    },
  ];
};

const isActivePath = (path: string): boolean => areFileSystemPathsEqual(path, props.activePath);

const toggleSectionCollapse = (key: TGitSectionKey): void => {
  collapsedSections[key] = !collapsedSections[key];
};

const selectNavItem = (key: TGitNavKey): void => {
  activeTab.value = key;
  closeSourceControlMenu();
};

const collectPaths = (entries: IGitFileStatusPayload[]): string[] => entries.map((entry) => entry.path);

const confirmDangerAction = async (options: {
  title: string;
  description: string;
  confirmText: string;
}): Promise<boolean> => {
  const action = await dialog.confirm({
    ...options,
    cancelText: '取消',
    variant: 'danger',
  });

  return action === 'confirm';
};

const handleRefresh = async (): Promise<void> => {
  if (!props.workspaceRootPath) {
    return;
  }

  sourceControlActionError.value = null;
  await syncRepositoryStatus(props.workspaceRootPath, {
    showSuccessMessage: true,
    showErrorMessage: true,
  });
};

const handleStageAll = async (): Promise<void> => {
  const paths = collectPaths(stageableEntries.value);
  if (paths.length === 0) {
    message.info('没有可暂存的变更。');
    return;
  }

  try {
    await runWithPending('stage-all', async () => {
      await gitStore.stagePaths(paths);
    });
    markStatusSynced();
    message.success(`已暂存 ${paths.length} 项变更`);
  } catch (error) {
    message.error(toErrorMessage(error, '暂存全部变更失败'));
  }
};

const handleUnstageAll = async (): Promise<void> => {
  const paths = stagedPaths.value;
  if (paths.length === 0) {
    message.info('没有已暂存的变更。');
    return;
  }

  try {
    await runWithPending('unstage-all', async () => {
      await gitStore.unstagePaths(paths);
    });
    markStatusSynced();
    message.success(`已取消暂存 ${paths.length} 项变更`);
  } catch (error) {
    message.error(toErrorMessage(error, '取消暂存全部变更失败'));
  }
};

const handleDiscardAll = async (): Promise<void> => {
  const paths = collectPaths(discardableEntries.value);
  if (paths.length === 0) {
    message.info('没有可放弃的未暂存更改。');
    return;
  }

  const confirmed = await confirmDangerAction({
    title: '放弃所有未暂存更改？',
    description: `将丢弃 ${paths.length} 项工作区更改；未跟踪文件会被删除。此操作无法撤销。`,
    confirmText: '放弃更改',
  });
  if (!confirmed) {
    return;
  }

  try {
    await runWithPending('discard-all', async () => {
      await gitStore.discardPaths(paths);
    });
    markStatusSynced();
    message.success(`已放弃 ${paths.length} 项未暂存更改`);
  } catch (error) {
    message.error(toErrorMessage(error, '放弃未暂存更改失败'));
  }
};

const handleInitRepository = async (): Promise<void> => {
  const workspaceRootPath = props.workspaceRootPath;
  if (!workspaceRootPath) {
    return;
  }

  sourceControlActionError.value = null;

  try {
    const didRun = await runWithPending('init-repository', async () => {
      const initializedStatus = await gitStore.initRepository(workspaceRootPath);
      assertWorkspaceRepositoryReady(initializedStatus, workspaceRootPath);

      const refreshedStatus = await gitStore.refreshRepositoryStatus(workspaceRootPath);
      assertWorkspaceRepositoryReady(refreshedStatus, workspaceRootPath);
    });

    if (!didRun) {
      return;
    }

    markStatusSynced();
    message.success('Git 仓库已初始化');
  } catch (error) {
    const errorMessage = toErrorMessage(error, '初始化 Git 仓库失败');
    sourceControlActionError.value = errorMessage;
    message.error(errorMessage);
  }
};

const handleOpenCloneGuide = (): void => {
  openExternalUrl(GIT_CLONE_GUIDE_URL);
};

const handleOpenGitGuide = (): void => {
  openExternalUrl(GIT_GETTING_STARTED_URL);
};

const handleOpenFile = (path: string): void => {
  emit('open-file', path);
};

const handleCommit = async (): Promise<void> => {
  const nextCommitMessage = commitMessage.value.trim();
  if (!nextCommitMessage) {
    message.warning('请先输入提交说明。');
    return;
  }

  const validationMessage = validateCommitMessage(nextCommitMessage);
  if (validationMessage) {
    message.warning(validationMessage);
    return;
  }

  if (status.value.stagedCount === 0) {
    message.warning('请先暂存至少一项变更。');
    return;
  }

  const action = await dialog.confirm({
    title: '创建 Git 提交？',
    description: `将提交 ${status.value.stagedCount} 项已暂存变更。\n\n${nextCommitMessage}`,
    confirmText: '提交',
    cancelText: '取消',
    variant: 'default',
  });
  if (action !== 'confirm') {
    return;
  }

  try {
    await runWithPending('commit', async () => {
      const result = await gitStore.commitIndex(nextCommitMessage);
      commitMessage.value = '';
      markStatusSynced();
      message.success(`已创建提交 ${result.commit.shortId}`);
    });
  } catch (error) {
    message.error(toErrorMessage(error, '创建 Git 提交失败'));
  }
};

const handleDiscardEntry = async (entry: IGitFileStatusPayload): Promise<void> => {
  const confirmed = await confirmDangerAction({
    title: entry.isUntracked ? '删除未跟踪文件？' : '放弃此文件的未暂存更改？',
    description: entry.isUntracked
      ? `将删除未跟踪文件 ${entry.relativePath}。此操作无法撤销。`
      : `将把 ${entry.relativePath} 的工作区内容恢复到索引/HEAD。此操作无法撤销。`,
    confirmText: entry.isUntracked ? '删除文件' : '放弃更改',
  });
  if (!confirmed) {
    return;
  }

  try {
    await runWithPending(`discard:${entry.path}`, async () => {
      await gitStore.discardPaths([entry.path]);
    });
    markStatusSynced();
    message.success(`已放弃更改 ${entry.fileName}`);
  } catch (error) {
    message.error(toErrorMessage(error, `放弃更改 ${entry.fileName} 失败`));
  }
};

const handleEntryAction = async (
  actionKey: TGitEntryActionKey,
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): Promise<void> => {
  if (actionKey === 'discard') {
    await handleDiscardEntry(entry);
    return;
  }

  await handleSectionAction(sectionKey, entry);
};

const handleSectionAction = async (
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): Promise<void> => {
  if (sectionKey === 'conflicts') {
    return;
  }

  try {
    if (sectionKey === 'staged') {
      await runWithPending(`unstage:${entry.path}`, async () => {
        await gitStore.unstagePaths([entry.path]);
      });
      markStatusSynced();
      message.success(`已取消暂存 ${entry.fileName}`);
      return;
    }

    await runWithPending(`stage:${entry.path}`, async () => {
      await gitStore.stagePaths([entry.path]);
    });
    markStatusSynced();
    message.success(`已暂存 ${entry.fileName}`);
  } catch (error) {
    message.error(toErrorMessage(error, 'Git 变更操作失败'));
  }
};

const createMenuItem = (
  item: Omit<ISourceControlMenuItem, 'children'> & {
    children?: ISourceControlMenuItem[];
  },
): ISourceControlMenuItem => item;

const buildRepositoryMenuGroups = (): TSourceControlMenuGroup[] => [
  {
    key: 'repository',
    title: 'Repository',
    items: [
      createMenuItem({
        key: 'refresh',
        label: '刷新状态',
        icon: 'refresh',
        shortcut: ['Ctrl', 'R'],
        action: 'refresh',
        disabled: isBusy.value,
      }),
    ],
  },
  {
    key: 'changes',
    title: 'Changes',
    items: [
      createMenuItem({
        key: 'stage-all',
        label: '全部暂存',
        icon: 'plus',
        action: 'stage-all',
        disabled: !canStageAll.value,
      }),
      createMenuItem({
        key: 'unstage-all',
        label: '全部取消暂存',
        icon: 'minus',
        action: 'unstage-all',
        disabled: !canUnstageAll.value,
      }),
      createMenuItem({
        key: 'discard-all',
        label: '放弃所有未暂存更改',
        icon: 'trash',
        action: 'discard-all',
        disabled: !canDiscardAll.value,
      }),
    ],
  },
  {
    key: 'commit',
    title: 'Commit',
    items: [
      createMenuItem({
        key: 'commit',
        label: '提交已暂存更改',
        icon: 'commit',
        shortcut: ['Ctrl', 'Enter'],
        action: 'commit',
        disabled: !canCommit.value,
      }),
    ],
  },
];

const buildEntryMenuGroups = (
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): TSourceControlMenuGroup[] => {
  const changeItems: ISourceControlMenuItem[] = [];

  if (sectionKey === 'staged') {
    changeItems.push(
      createMenuItem({
        key: 'unstage-entry',
        label: '取消暂存',
        icon: 'minus',
        action: 'unstage-entry',
        sectionKey,
        entry,
        disabled: isBusy.value,
      }),
    );
  } else if (sectionKey !== 'conflicts') {
    changeItems.push(
      createMenuItem({
        key: 'stage-entry',
        label: '暂存更改',
        icon: 'plus',
        action: 'stage-entry',
        sectionKey,
        entry,
        disabled: isBusy.value,
      }),
      createMenuItem({
        key: 'discard-entry',
        label: entry.isUntracked ? '删除未跟踪文件' : '放弃更改',
        icon: 'trash',
        action: 'discard-entry',
        sectionKey,
        entry,
        disabled: isBusy.value,
      }),
    );
  }

  return [
    {
      key: 'file',
      title: 'File',
      items: [
        createMenuItem({
          key: 'open-file',
          label: '打开文件',
          icon: 'goto',
          action: 'open-file',
          sectionKey,
          entry,
        }),
        createMenuItem({
          key: 'copy-path',
          label: '复制路径',
          icon: 'copy',
          action: 'copy-path',
          sectionKey,
          entry,
        }),
      ],
    },
    ...(changeItems.length > 0
      ? [
        {
          key: 'change',
          title: 'Change',
          items: changeItems,
        },
      ]
      : []),
  ];
};

const handleMoreActions = (event: MouseEvent): void => {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const rect = target?.getBoundingClientRect();
  openSourceControlMenu(
    {
      x: rect ? rect.right - SOURCE_CONTROL_MENU_WIDTH : event.clientX,
      y: rect ? rect.bottom + 6 : event.clientY,
    },
    buildRepositoryMenuGroups(),
  );
};

const handleEntryContextMenu = (
  event: MouseEvent,
  sectionKey: TGitSectionKey,
  entry: IGitFileStatusPayload,
): void => {
  openSourceControlMenu(
    {
      x: event.clientX,
      y: event.clientY,
    },
    buildEntryMenuGroups(sectionKey, entry),
  );
};

const handleContextMenuSelect = async (item: ILinearContextMenuItem): Promise<void> => {
  const actionItem = item as ISourceControlMenuItem;
  closeSourceControlMenu();

  switch (actionItem.action) {
    case 'refresh':
      await handleRefresh();
      return;
    case 'stage-all':
      await handleStageAll();
      return;
    case 'unstage-all':
      await handleUnstageAll();
      return;
    case 'discard-all':
      await handleDiscardAll();
      return;
    case 'commit':
      await handleCommit();
      return;
    case 'open-file':
      if (actionItem.entry) {
        handleOpenFile(actionItem.entry.path);
      }
      return;
    case 'copy-path':
      if (actionItem.entry) {
        await writeClipboardText(actionItem.entry.path);
        message.success('已复制文件路径');
      }
      return;
    case 'stage-entry':
      if (actionItem.entry && actionItem.sectionKey) {
        await handleSectionAction(actionItem.sectionKey, actionItem.entry);
      }
      return;
    case 'unstage-entry':
      if (actionItem.entry) {
        await handleSectionAction('staged', actionItem.entry);
      }
      return;
    case 'discard-entry':
      if (actionItem.entry) {
        await handleDiscardEntry(actionItem.entry);
      }
      return;
    default:
      return;
  }
};

const isTargetInsideSourceControlMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(SOURCE_CONTROL_MENU_ROOT_SELECTOR) !== null;

const handleWindowPointerDown = (event: PointerEvent): void => {
  if (!scmMenuState.open || isTargetInsideSourceControlMenu(event.target)) {
    return;
  }

  closeSourceControlMenu();
};

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (scmMenuState.open && event.key === 'Escape') {
    closeSourceControlMenu();
  }
};

const handleWindowResize = (): void => {
  if (scmMenuState.open) {
    closeSourceControlMenu();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', handleWindowPointerDown, true);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('blur', handleWindowResize);
}

onBeforeUnmount(() => {
  if (typeof window === 'undefined') {
    return;
  }

  window.removeEventListener('pointerdown', handleWindowPointerDown, true);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', handleWindowResize);
  window.removeEventListener('blur', handleWindowResize);
});

watch(
  () => props.workspaceRootPath,
  () => {
    commitMessage.value = '';
    searchQuery.value = '';
    activeTab.value = 'changes';
    lastSyncedAt.value = null;
    sourceControlActionError.value = null;
    closeSourceControlMenu();
    resetSectionCollapse();
  },
);

watch(
  () => [props.isDesktopRuntime, props.workspaceRootPath],
  ([ready, workspaceRootPath]) => {
    if (!ready || !workspaceRootPath) {
      gitStore.reset();
      lastSyncedAt.value = null;
      sourceControlActionError.value = null;
      return;
    }

    void syncRepositoryStatus(workspaceRootPath);
  },
  { immediate: true },
);
</script>
