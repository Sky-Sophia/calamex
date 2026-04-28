import { APP_DIALOG_EVENT } from '@/types/dialog';
import type { IGitRepositoryStatusPayload } from '@/types/git';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceControlPanel from './SourceControlPanel.vue';

const tauriServiceMock = vi.hoisted(() => ({
  getGitRepositoryStatus: vi.fn(),
  initGitRepository: vi.fn(),
  getGitFileBaseline: vi.fn(),
  stageGitPaths: vi.fn(),
  unstageGitPaths: vi.fn(),
  discardGitPaths: vi.fn(),
  commitGitIndex: vi.fn(),
}));

vi.mock('@/services/tauri', () => ({
  tauriService: tauriServiceMock,
}));

vi.mock('@/utils/clipboard', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

const createStatus = (
  overrides: Partial<IGitRepositoryStatusPayload> = {},
): IGitRepositoryStatusPayload => ({
  available: true,
  message: null,
  repositoryRootPath: 'D:/repo',
  repositoryName: 'repo',
  gitDirPath: 'D:/repo/.git',
  headBranchName: 'main',
  headShortName: 'main',
  headShortOid: 'abc1234',
  isDetached: false,
  isClean: false,
  ahead: 0,
  behind: 0,
  stagedCount: 0,
  unstagedCount: 1,
  untrackedCount: 1,
  conflictedCount: 0,
  files: [
    {
      path: 'D:/repo/src/app.sh',
      relativePath: 'src/app.sh',
      fileName: 'app.sh',
      previousPath: null,
      previousRelativePath: null,
      indexStatus: null,
      worktreeStatus: 'modified',
      isConflicted: false,
      isUntracked: false,
    },
    {
      path: 'D:/repo/src/new.sh',
      relativePath: 'src/new.sh',
      fileName: 'new.sh',
      previousPath: null,
      previousRelativePath: null,
      indexStatus: null,
      worktreeStatus: 'untracked',
      isConflicted: false,
      isUntracked: true,
    },
  ],
  lastCommit: {
    id: 'abc123456789',
    shortId: 'abc1234',
    summary: 'feat: 初始化项目',
    authorName: 'test',
    authoredAt: '2026-04-26T00:00:00.000Z',
  },
  ...overrides,
});

const cleanStatus = createStatus({
  isClean: true,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  files: [],
});

const unavailableStatus = createStatus({
  available: false,
  message: '当前工作区未检测到 Git 仓库。',
  repositoryRootPath: null,
  repositoryName: null,
  gitDirPath: null,
  headBranchName: null,
  headShortName: null,
  headShortOid: null,
  isClean: true,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictedCount: 0,
  files: [],
  lastCommit: null,
});

const mountPanel = async (status = createStatus()) => {
  tauriServiceMock.getGitRepositoryStatus.mockResolvedValue(status);
  const wrapper = mount(SourceControlPanel, {
    props: {
      isDesktopRuntime: true,
      workspaceRootPath: 'D:/repo',
      activePath: null,
    },
  });
  await flushPromises();
  return wrapper;
};

describe('SourceControlPanel', () => {
  const confirmDialog = (event: WindowEventMap[typeof APP_DIALOG_EVENT]): void => {
    event.detail.onAction('confirm');
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    tauriServiceMock.stageGitPaths.mockResolvedValue(cleanStatus);
    tauriServiceMock.unstageGitPaths.mockResolvedValue(cleanStatus);
    tauriServiceMock.discardGitPaths.mockResolvedValue(cleanStatus);
    tauriServiceMock.commitGitIndex.mockResolvedValue({
      status: cleanStatus,
      commit: cleanStatus.lastCommit,
    });
    window.addEventListener(APP_DIALOG_EVENT, confirmDialog);
  });

  afterEach(() => {
    window.removeEventListener(APP_DIALOG_EVENT, confirmDialog);
  });

  it('未初始化时点击初始化按钮会调用 init_git_repository 并进入仓库视图', async () => {
    const wrapper = await mountPanel(unavailableStatus);
    tauriServiceMock.initGitRepository.mockResolvedValueOnce(cleanStatus);
    tauriServiceMock.getGitRepositoryStatus.mockResolvedValueOnce(cleanStatus);

    const initButton = wrapper.find('.source-control-setup-btn-primary');
    expect(initButton.text()).toBe('初始化 Git 仓库');

    await initButton.trigger('click');
    await flushPromises();

    expect(tauriServiceMock.initGitRepository).toHaveBeenCalledWith('D:/repo');
    expect(tauriServiceMock.getGitRepositoryStatus).toHaveBeenLastCalledWith('D:/repo');
    expect(wrapper.find('.source-control-repo-name').text()).toBe('repo');
  });

  it('初始化后仍未得到当前工作区仓库时停留在引导页并显示错误', async () => {
    const wrapper = await mountPanel(unavailableStatus);
    tauriServiceMock.initGitRepository.mockResolvedValueOnce(createStatus({
      repositoryRootPath: 'D:/parent',
      repositoryName: 'parent',
      gitDirPath: 'D:/parent/.git',
    }));

    await wrapper.find('.source-control-setup-btn-primary').trigger('click');
    await flushPromises();

    expect(wrapper.find('.source-control-repo-name').exists()).toBe(false);
    expect(wrapper.find('.source-control-setup-error').text()).toContain('Git 初始化目标不一致');
  });

  it('批量暂存会调用真实 Git store/IPC 路径', async () => {
    const wrapper = await mountPanel();

    const stageAllButton = wrapper
      .findAll('.source-control-toolbar-btn')
      .find((button) => button.text() === '全部暂存');
    expect(stageAllButton).toBeDefined();

    await stageAllButton?.trigger('click');
    await flushPromises();

    expect(tauriServiceMock.stageGitPaths).toHaveBeenCalledWith({
      repositoryRootPath: 'D:/repo',
      paths: ['D:/repo/src/app.sh', 'D:/repo/src/new.sh'],
    });
  });

  it('单文件放弃更改会二次确认并调用 discard_git_paths', async () => {
    const wrapper = await mountPanel();

    await wrapper.findAll('.source-control-icon-btn')[0]?.trigger('click');
    await flushPromises();

    expect(tauriServiceMock.discardGitPaths).toHaveBeenCalledWith({
      repositoryRootPath: 'D:/repo',
      paths: ['D:/repo/src/app.sh'],
    });
  });

  it('提交时允许任意非空提交说明并直接提交', async () => {
    const stagedStatus = createStatus({
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 0,
      files: [
        {
          path: 'D:/repo/src/app.sh',
          relativePath: 'src/app.sh',
          fileName: 'app.sh',
          previousPath: null,
          previousRelativePath: null,
          indexStatus: 'modified',
          worktreeStatus: null,
          isConflicted: false,
          isUntracked: false,
        },
      ],
    });
    const wrapper = await mountPanel(stagedStatus);

    await wrapper.find('.source-control-commit-input').setValue('随便写点提交说明。');
    await wrapper.find('.source-control-btn-primary').trigger('click');
    await flushPromises();

    expect(tauriServiceMock.commitGitIndex).toHaveBeenCalledWith({
      repositoryRootPath: 'D:/repo',
      message: '随便写点提交说明。',
    });
  });
});
