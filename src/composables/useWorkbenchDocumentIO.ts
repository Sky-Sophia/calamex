import type { useMessage } from '@/composables/useMessage';
import { tauriService } from '@/services/tauri';
import type { useEditorStore } from '@/store/editor';
import type { IEditorDocument, IScriptFilePayload } from '@/types/editor';
import type { TSessionSnapshot, TSessionTabKind } from '@/types/session';
import { waitForDesktopRuntime } from '@/utils/desktop-runtime';
import { getFileBaseName, isImageAssetPath } from '@/utils/file-assets';
import { getPathBaseName } from '@/utils/path';
import { isWorkspaceRootAccessible } from '@/utils/workspace';

type TEditorStore = ReturnType<typeof useEditorStore>;
type TNotifier = ReturnType<typeof useMessage>;
type TWorkbenchOpenTarget = 'file' | 'image';

type TRestoredSessionTab = {
  kind: TSessionTabKind;
  imagePath?: string;
  imageName?: string;
  payload?: IScriptFilePayload;
  order: number;
};

type TRestorableSessionSnapshot = Pick<TSessionSnapshot, 'workspaceRoot' | 'activeTabPath'> & {
  openTabs: Array<Pick<TSessionSnapshot['openTabs'][number], 'path' | 'order'>>;
};

interface IUseWorkbenchDocumentIOOptions {
  editorStore: TEditorStore;
  notifier: TNotifier;
  reportError: (scene: string, error: unknown, fallbackMessage: string) => void;
  buildDefaultScriptContent: () => string;
  ensureDirtyDocumentsHandled: (
    dirtyDocuments: IEditorDocument[],
    scene: 'switch-workspace',
  ) => Promise<boolean>;
  refreshGitRepositoryStatus: (workspaceRootPath?: string | null) => Promise<void>;
}

const MAX_OPEN_TABS = 30;

const buildLogDetail = (title: string, detail: string): string => `${title}：${detail}`;
const getPathName = (path: string): string => getPathBaseName(path);

const isRestoredSessionTab = (value: TRestoredSessionTab | null): value is TRestoredSessionTab =>
  value !== null;

const resolveSessionTabKind = (
  tab: TRestorableSessionSnapshot['openTabs'][number],
): TSessionTabKind => tab.kind ?? (isImageAssetPath(tab.path) ? 'image' : 'text');

const pickRestorableSessionSnapshot = (snapshot: TSessionSnapshot): TRestorableSessionSnapshot => ({
  workspaceRoot: snapshot.workspaceRoot,
  activeTabPath: snapshot.activeTabPath,
  openTabs: snapshot.openTabs.map(({ path, order }) => ({
    path,
    order,
  })),
});

export const useWorkbenchDocumentIO = ({
  editorStore,
  notifier,
  reportError,
  buildDefaultScriptContent,
  ensureDirtyDocumentsHandled,
  refreshGitRepositoryStatus,
}: IUseWorkbenchDocumentIOOptions) => {
  const ensureCanOpenNewTab = (): boolean => {
    if (editorStore.canOpenMoreTabs) {
      return true;
    }

    notifier.warning(`最多只能同时打开 ${MAX_OPEN_TABS} 个标签页`);
    return false;
  };

  const notifyDocumentOpenResult = (
    scene: string,
    kind: TWorkbenchOpenTarget,
    name: string,
    path: string,
    reusedExisting: boolean,
  ): void => {
    const actionLabel =
      kind === 'image'
        ? reusedExisting
          ? '切换到已打开图片'
          : '已加载图片'
        : reusedExisting
          ? '切换到已打开文件'
          : '已加载文件';
    const toastMessage =
      kind === 'image'
        ? reusedExisting
          ? `已切换到 ${name}`
          : `已打开图片 ${name}`
        : reusedExisting
          ? `已切换到 ${name}`
          : `已打开 ${name}`;

    editorStore.appendLog(
      reusedExisting ? 'info' : 'success',
      scene,
      buildLogDetail(actionLabel, path),
    );
    notifier.success(toastMessage);
  };

  const openScriptPayload = (payload: IScriptFilePayload, scene: string): void => {
    const existingDocument = editorStore.findDocumentByPath(payload.path);
    if (!existingDocument && !ensureCanOpenNewTab()) {
      return;
    }

    const result = editorStore.openDocumentTab(payload);
    notifyDocumentOpenResult(scene, 'file', payload.name, payload.path, result.reusedExisting);
  };

  const loadDocumentFromPath = async (path: string, scene: string): Promise<void> => {
    if (isImageAssetPath(path)) {
      const imageName = getFileBaseName(path);
      const existingImage = editorStore.findDocumentByPath(path);
      if (!existingImage && !ensureCanOpenNewTab()) {
        return;
      }

      const result = editorStore.openImageDocument(path, imageName);
      notifyDocumentOpenResult(scene, 'image', imageName, path, result.reusedExisting);
      return;
    }

    const payload = await tauriService.loadScript(path);
    openScriptPayload(payload, scene);
  };

  const restoreWorkspaceRoot = async (workspaceRoot: string): Promise<void> => {
    const accessible = await isWorkspaceRootAccessible(
      workspaceRoot,
      tauriService.listWorkspaceEntries,
    );
    if (accessible) {
      editorStore.setWorkspaceRootPath(workspaceRoot);
      return;
    }

    editorStore.setWorkspaceRootPath(null);
    notifier.warning('上次的工作区已失效，已重置');
  };

  const restoreOpenTabs = async (
    openTabs: TRestorableSessionSnapshot['openTabs'],
  ): Promise<TRestoredSessionTab[]> => {
    const loadedTabs = await Promise.all(
      openTabs.map(async (tab) => {
        try {
          const kind = resolveSessionTabKind(tab);
          if (kind === 'image') {
            return {
              kind,
              imagePath: tab.path,
              imageName: getFileBaseName(tab.path),
              order: tab.order,
            };
          }

          const payload = await tauriService.loadScript(tab.path);
          return { kind, payload, order: tab.order };
        } catch {
          notifier.info(`文件已不可用，已从会话移除：${tab.path}`);
          return null;
        }
      }),
    );

    return loadedTabs.filter(isRestoredSessionTab).sort((left, right) => left.order - right.order);
  };

  const restoreActiveDocument = (activePath: string | null): void => {
    if (activePath) {
      const activeDocument = editorStore.documents.find((item) => item.path === activePath);
      if (activeDocument) {
        editorStore.setActiveDocument(activeDocument.id);
        return;
      }
    }

    const firstDocument = editorStore.documents[0];
    if (firstDocument) {
      editorStore.setActiveDocument(firstDocument.id);
    }
  };

  const restoreSession = async (sessionSnapshot: TSessionSnapshot): Promise<void> => {
    const runtimeReady = await waitForDesktopRuntime(120);
    if (!runtimeReady) {
      return;
    }

    const snapshot = pickRestorableSessionSnapshot(sessionSnapshot);
    if (!snapshot.workspaceRoot && snapshot.openTabs.length === 0) {
      return;
    }

    if (snapshot.workspaceRoot) {
      await restoreWorkspaceRoot(snapshot.workspaceRoot);
    }

    if (snapshot.openTabs.length === 0) {
      return;
    }

    editorStore.clearDocuments();
    const aliveTabs = await restoreOpenTabs(snapshot.openTabs);

    aliveTabs.forEach((tab) => {
      if (tab.kind === 'image' && tab.imagePath && tab.imageName) {
        editorStore.openImageDocument(tab.imagePath, tab.imageName);
        return;
      }

      if (tab.payload) {
        editorStore.openDocumentTab(tab.payload);
      }
    });

    if (aliveTabs.length === 0) {
      return;
    }

    restoreActiveDocument(snapshot.activeTabPath);
  };

  const createNewDocument = (): void => {
    if (!ensureCanOpenNewTab()) {
      return;
    }

    const nextDocument = editorStore.createDocumentTab({
      content: buildDefaultScriptContent(),
    });
    editorStore.appendLog('info', '新建脚本', `已创建新的脚本草稿：${nextDocument.name}。`);
    notifier.success('已创建新的脚本草稿');
  };

  const openDocument = async (): Promise<void> => {
    try {
      const path = await tauriService.pickOpenPath();
      if (!path) {
        return;
      }

      await loadDocumentFromPath(path, '打开脚本');
    } catch (error) {
      reportError('打开脚本失败', error, '打开脚本失败');
    }
  };

  const openFolder = async (): Promise<void> => {
    try {
      const path = await tauriService.pickOpenFolderPath();
      if (!path) {
        return;
      }

      const canSwitchWorkspace = await ensureDirtyDocumentsHandled(
        editorStore.dirtyDocuments,
        'switch-workspace',
      );
      if (!canSwitchWorkspace) {
        return;
      }

      editorStore.clearDocuments();
      editorStore.setWorkspaceRootPath(path);
      void refreshGitRepositoryStatus(path);
      editorStore.appendLog('success', '打开文件夹', buildLogDetail('资源目录', path));
      notifier.success(`已打开文件夹 ${getPathName(path)}`);
    } catch (error) {
      reportError('打开文件夹失败', error, '打开文件夹失败');
    }
  };

  const openDocumentByPath = async (path: string): Promise<void> => {
    try {
      const existingDocument = editorStore.findDocumentByPath(path);
      if (existingDocument) {
        editorStore.setActiveDocument(existingDocument.id);
        notifier.success(`已切换到 ${existingDocument.name}`);
        return;
      }

      await loadDocumentFromPath(path, '资源管理器打开文件');
    } catch (error) {
      reportError('打开资源文件失败', error, '打开资源文件失败');
    }
  };

  return {
    createNewDocument,
    restoreSession,
    openDocument,
    openFolder,
    openDocumentByPath,
  };
};
