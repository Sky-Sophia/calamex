<script setup lang="ts">
import { useMessage } from '@/composables/useMessage'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

type TSshContentTab = 'explorer' | 'transfer'
type TSshPanelTab = TSshContentTab | 'connect'
type TSshAuthMode = 'key' | 'password'
type TSshFileKind = 'folder' | 'rust' | 'toml' | 'markdown' | 'lock' | 'file'
type TSshTransferDirection = 'upload' | 'download'
type TSshTransferStatus = 'uploading' | 'downloading' | 'done'
type TSshContextActionTone = 'default' | 'danger'

interface ISshPathSegment {
  id: string
  label: string
}

interface ISshFileItem {
  id: string
  name: string
  kind: TSshFileKind
  metaLabel: string
}

interface ISshTransferItem {
  id: string
  name: string
  direction: TSshTransferDirection
  sizeLabel: string
  progressLabel: string
  progress: number
  status: TSshTransferStatus
}

interface ISshContextAction {
  key: string
  label: string
  tone: TSshContextActionTone
  separatorBefore?: boolean
}

interface ISshRecentConnection {
  id: string
  name: string
  username: string
  host: string
  port: string
  lastUsedLabel: string
}

const CONTEXT_MENU_WIDTH = 172
const CONTEXT_MENU_HEIGHT = 214
const CURRENT_PATH_SEGMENT_ID = 'workspace'
const DEFAULT_SELECTED_FILE_ID = 'ssh-client'
const MANUAL_CONNECTION_ID = 'manual'

const SSH_PATH_SEGMENTS: ISshPathSegment[] = [
  { id: 'home', label: '~' },
  { id: 'projects', label: 'projects' },
  { id: CURRENT_PATH_SEGMENT_ID, label: 'sh-editor' },
]

const SSH_FILE_ITEMS: ISshFileItem[] = [
  { id: 'src', name: 'src', kind: 'folder', metaLabel: '12 项' },
  { id: 'assets', name: 'assets', kind: 'folder', metaLabel: '5 项' },
  { id: 'target', name: 'target', kind: 'folder', metaLabel: '3 项' },
  { id: 'main-rs', name: 'main.rs', kind: 'rust', metaLabel: '4.2 KB' },
  { id: DEFAULT_SELECTED_FILE_ID, name: 'ssh_client.rs', kind: 'rust', metaLabel: '8.7 KB' },
  { id: 'sidebar-rs', name: 'sidebar.rs', kind: 'rust', metaLabel: '3.1 KB' },
  { id: 'cargo-toml', name: 'Cargo.toml', kind: 'toml', metaLabel: '1.4 KB' },
  { id: 'cargo-lock', name: 'Cargo.lock', kind: 'lock', metaLabel: '42 KB' },
  { id: 'readme-md', name: 'README.md', kind: 'markdown', metaLabel: '2.0 KB' },
  { id: 'gitignore', name: '.gitignore', kind: 'file', metaLabel: '48 B' },
]

const SSH_TRANSFER_ITEMS: ISshTransferItem[] = [
  {
    id: 'upload-sidebar',
    name: 'sidebar.rs',
    direction: 'upload',
    sizeLabel: '3.1 KB',
    progressLabel: '2.2 KB / 3.1 KB',
    progress: 72,
    status: 'uploading',
  },
  {
    id: 'download-config',
    name: 'config.json',
    direction: 'download',
    sizeLabel: '12.8 KB',
    progressLabel: '5.8 KB / 12.8 KB',
    progress: 45,
    status: 'downloading',
  },
  {
    id: 'upload-main',
    name: 'main.rs',
    direction: 'upload',
    sizeLabel: '4.2 KB',
    progressLabel: '已完成',
    progress: 100,
    status: 'done',
  },
  {
    id: 'download-db',
    name: 'database.db',
    direction: 'download',
    sizeLabel: '256 KB',
    progressLabel: '已完成',
    progress: 100,
    status: 'done',
  },
]

const SSH_CONTEXT_ACTIONS: ISshContextAction[] = [
  { key: 'rename', label: '重命名', tone: 'default' },
  { key: 'copy-path', label: '复制路径', tone: 'default' },
  { key: 'download', label: '下载到本地', tone: 'default' },
  { key: 'upload', label: '上传到此处', tone: 'default' },
  { key: 'delete', label: '删除', tone: 'danger', separatorBefore: true },
]

const SSH_RECENT_CONNECTIONS: ISshRecentConnection[] = [
  {
    id: 'dev-server',
    name: '开发服务器',
    username: 'root',
    host: '192.168.1.100',
    port: '22',
    lastUsedLabel: '昨天',
  },
  {
    id: 'prod-bastion',
    name: '生产跳板机',
    username: 'deploy',
    host: '10.0.12.31',
    port: '22',
    lastUsedLabel: '3 天前',
  },
  {
    id: 'personal-vps',
    name: '个人 VPS',
    username: 'ubuntu',
    host: 'vps.example.com',
    port: '22',
    lastUsedLabel: '上周',
  },
]

const FALLBACK_SELECTED_FILE: ISshFileItem = {
  id: DEFAULT_SELECTED_FILE_ID,
  name: 'ssh_client.rs',
  kind: 'rust',
  metaLabel: '8.7 KB',
}

const message = useMessage()
const activeContentTab = ref<TSshContentTab>('explorer')
const isConnectFormVisible = ref(false)
const isConnected = ref(false)
const currentConnectionId = ref<string | null>(null)
const selectedFileId = ref(DEFAULT_SELECTED_FILE_ID)
const contextMenuRef = ref<HTMLElement | null>(null)
const contextMenu = reactive({
  open: false,
  x: 0,
  y: 0,
})
const connectionForm = reactive({
  host: '192.168.1.100',
  port: '22',
  username: 'root',
  authMode: 'key' as TSshAuthMode,
  identityPath: '~/.ssh/id_rsa',
})

const isExplorerActive = computed(() => activeContentTab.value === 'explorer')
const isTransferActive = computed(() => activeContentTab.value === 'transfer')
const isDisconnected = computed(() => !isConnected.value)
const currentConnection = computed<ISshRecentConnection>(() => {
  const matchedConnection = SSH_RECENT_CONNECTIONS.find(
    (item) => item.id === currentConnectionId.value,
  )

  if (matchedConnection) {
    return matchedConnection
  }

  return {
    id: MANUAL_CONNECTION_ID,
    name: '自定义连接',
    username: connectionForm.username,
    host: connectionForm.host,
    port: connectionForm.port,
    lastUsedLabel: '刚刚',
  }
})
const connectionStatusLabel = computed(() =>
  isConnected.value
    ? `${currentConnection.value.name} · ${currentConnection.value.host}`
    : '未连接 · 等待建立会话',
)
const selectedFile = computed<ISshFileItem>(
  () => SSH_FILE_ITEMS.find((item) => item.id === selectedFileId.value) ?? FALLBACK_SELECTED_FILE,
)

const isTabActive = (tab: TSshPanelTab): boolean => {
  if (tab === 'connect') {
    return !isConnected.value || isConnectFormVisible.value
  }

  return isConnected.value && !isConnectFormVisible.value && activeContentTab.value === tab
}

const closeContextMenu = (): void => {
  contextMenu.open = false
}

const setContentTab = (tab: TSshContentTab): void => {
  if (!isConnected.value) {
    return
  }

  activeContentTab.value = tab
  isConnectFormVisible.value = false
  closeContextMenu()
}

const openConnectForm = (): void => {
  isConnectFormVisible.value = true
  closeContextMenu()
}

const toggleConnectForm = (): void => {
  isConnectFormVisible.value = !isConnectFormVisible.value

  if (isConnected.value && !isConnectFormVisible.value) {
    activeContentTab.value = 'explorer'
  }

  closeContextMenu()
}

const handleCancelConnect = (): void => {
  isConnectFormVisible.value = false

  if (isConnected.value) {
    activeContentTab.value = 'explorer'
  }
}

const applyMockConnection = (connectionId: string | null): void => {
  currentConnectionId.value = connectionId
  isConnected.value = true
  isConnectFormVisible.value = false
  activeContentTab.value = 'explorer'
  closeContextMenu()
}

const handleConnect = (): void => {
  applyMockConnection(MANUAL_CONNECTION_ID)
  message.info(`SSH 连接预览：${connectionForm.username}@${connectionForm.host}:${connectionForm.port}`)
}

const handleImportConfig = (): void => {
  message.info('SSH 配置导入待接入')
}

const handleSelectRecentConnection = (connection: ISshRecentConnection): void => {
  connectionForm.host = connection.host
  connectionForm.port = connection.port
  connectionForm.username = connection.username
  connectionForm.authMode = 'key'
  connectionForm.identityPath = '~/.ssh/id_rsa'
  applyMockConnection(connection.id)
  message.info(`SSH 连接预览：${connection.username}@${connection.host}:${connection.port}`)
}

const handlePathSegmentClick = (segment: ISshPathSegment): void => {
  if (segment.id === CURRENT_PATH_SEGMENT_ID) {
    return
  }

  message.info(`路径跳转待接入：${segment.label}`)
}

const handleSelectFile = (fileId: string): void => {
  selectedFileId.value = fileId
  closeContextMenu()
}

const handleFileContextMenu = (event: MouseEvent, fileId: string): void => {
  selectedFileId.value = fileId

  const maxX = Math.max(12, window.innerWidth - CONTEXT_MENU_WIDTH - 12)
  const maxY = Math.max(12, window.innerHeight - CONTEXT_MENU_HEIGHT - 12)

  contextMenu.x = Math.min(event.clientX, maxX)
  contextMenu.y = Math.min(event.clientY, maxY)
  contextMenu.open = true
}

const handleContextAction = (action: ISshContextAction): void => {
  const targetLabel = selectedFile.value.name
  message.info(`${action.label}待接入：${targetLabel}`)
  closeContextMenu()
}

const handleFooterAction = (action: TSshTransferDirection): void => {
  if (!isConnected.value) {
    return
  }

  message.info(action === 'upload' ? '上传待接入' : '下载待接入')
}

const handleWindowClick = (event: MouseEvent): void => {
  if (!contextMenu.open) {
    return
  }

  const target = event.target
  if (target instanceof Node && contextMenuRef.value?.contains(target)) {
    return
  }

  closeContextMenu()
}

const handleWindowContextMenu = (event: MouseEvent): void => {
  const target = event.target
  if (!(target instanceof Element)) {
    closeContextMenu()
    return
  }

  if (!target.closest('.ssh-file-item')) {
    closeContextMenu()
  }
}

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    closeContextMenu()
  }
}

onMounted(() => {
  window.addEventListener('click', handleWindowClick)
  window.addEventListener('contextmenu', handleWindowContextMenu)
  window.addEventListener('keydown', handleWindowKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleWindowClick)
  window.removeEventListener('contextmenu', handleWindowContextMenu)
  window.removeEventListener('keydown', handleWindowKeydown)
})
</script>

<template>
  <section class="ssh-sidebar-panel" aria-label="SSH 连接侧边栏">
    <header class="ssh-sidebar-header">
      <h2>
        <svg
width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="3" />
          <path d="M7 8l4 4-4 4" />
          <line x1="13" y1="16" x2="17" y2="16" />
        </svg>
        SSH 资源管理器
      </h2>

      <div
class="ssh-connection-status" :class="{ 'ssh-connection-status--disconnected': isDisconnected }"
        aria-live="polite">
        <span class="ssh-status-dot" :class="{ 'is-offline': isDisconnected }" />
        {{ connectionStatusLabel }}
      </div>
    </header>

    <div class="ssh-tabs" :class="{ 'ssh-tabs--disconnected': isDisconnected }" role="tablist" aria-label="SSH 侧边栏分组">
      <button
type="button" class="ssh-tab" :class="{
        'ssh-tab--disconnected': isDisconnected,
        'is-active': isTabActive('explorer'),
        'is-disabled': isDisconnected,
      }" role="tab" :aria-selected="isTabActive('explorer')" :aria-disabled="isDisconnected"
        :disabled="isDisconnected" title="连接后可用" @click="setContentTab('explorer')">
        文件
      </button>
      <button
type="button" class="ssh-tab" :class="{
        'ssh-tab--disconnected': isDisconnected,
        'is-active': isTabActive('transfer'),
        'is-disabled': isDisconnected,
      }" role="tab" :aria-selected="isTabActive('transfer')" :aria-disabled="isDisconnected"
        :disabled="isDisconnected" title="连接后可用" @click="setContentTab('transfer')">
        传输
      </button>
      <button
type="button" class="ssh-tab" :class="{
        'ssh-tab--disconnected': isDisconnected,
        'is-active': isTabActive('connect'),
      }" role="tab" :aria-selected="isTabActive('connect')" @click="toggleConnectForm">
        连接
      </button>
    </div>

    <div class="ssh-panel-body" :class="isDisconnected ? 'ssh-panel-body--disconnected' : 'ssh-panel-body--connected'">
      <form
v-if="isConnectFormVisible" class="ssh-connect-form"
        :class="{ 'ssh-connect-form--disconnected': isDisconnected }" @submit.prevent="handleConnect">
        <div class="ssh-form-row">
          <label class="ssh-form-group">
            <span>主机地址</span>
            <input v-model="connectionForm.host" type="text" placeholder="192.168.1.100" autocomplete="off" />
          </label>

          <label class="ssh-form-group is-compact">
            <span>端口</span>
            <input v-model="connectionForm.port" type="text" placeholder="22" inputmode="numeric" autocomplete="off" />
          </label>
        </div>

        <label class="ssh-form-group">
          <span>用户名</span>
          <input v-model="connectionForm.username" type="text" placeholder="root" autocomplete="off" />
        </label>

        <label class="ssh-form-group">
          <span>认证方式</span>
          <select v-model="connectionForm.authMode">
            <option value="key">密钥认证</option>
            <option value="password">密码认证</option>
          </select>
        </label>

        <label class="ssh-form-group">
          <span>私钥路径</span>
          <input v-model="connectionForm.identityPath" type="text" placeholder="~/.ssh/id_rsa" autocomplete="off" />
        </label>

        <div class="ssh-form-actions">
          <button type="submit" class="ssh-button ssh-button--primary">连接</button>
          <button type="button" class="ssh-button ssh-button--ghost" @click="handleCancelConnect">取消</button>
        </div>
      </form>

      <section v-else-if="isDisconnected" class="ssh-empty-state ssh-empty-state--disconnected" aria-label="SSH 未连接状态">
        <div class="ssh-empty-illustration ssh-empty-illustration--disconnected" aria-hidden="true">
          <svg
width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 17h3m4 0h9" />
            <path d="M7 7l3 3-3 3" />
            <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
          </svg>
        </div>

        <div class="ssh-empty-copy">
          <div class="ssh-empty-title ssh-empty-title--disconnected">尚未连接到远程主机</div>
          <div class="ssh-empty-desc ssh-empty-desc--disconnected">
            连接一台 SSH 服务器后，即可在此浏览文件、上传下载以及管理远程资源。
          </div>
        </div>

        <div class="ssh-empty-actions ssh-empty-actions--disconnected">
          <button
type="button"
            class="ssh-button ssh-button--primary ssh-button--stacked ssh-button--disconnected-primary"
            @click="openConnectForm">
            <svg
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
            新建连接
          </button>

          <button
type="button" class="ssh-button ssh-button--ghost ssh-button--stacked ssh-button--disconnected-ghost"
            @click="handleImportConfig">
            <svg
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            导入配置
          </button>
        </div>

        <section class="ssh-recent-section ssh-recent-section--disconnected" aria-label="最近使用 SSH 连接">
          <div class="ssh-recent-title ssh-recent-title--disconnected">最近使用</div>

          <button
v-for="connection in SSH_RECENT_CONNECTIONS" :key="connection.id" type="button"
            class="ssh-recent-item ssh-recent-item--disconnected" @click="handleSelectRecentConnection(connection)">
            <span class="ssh-recent-icon ssh-recent-icon--disconnected" aria-hidden="true">
              <svg
width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="6" y1="8" x2="6.01" y2="8" />
              </svg>
            </span>

            <span class="ssh-recent-info">
              <span class="ssh-recent-name ssh-recent-name--disconnected">{{ connection.name }}</span>
              <span class="ssh-recent-host ssh-recent-host--disconnected">{{ connection.username }}@{{ connection.host
                }}</span>
            </span>

            <span class="ssh-recent-time ssh-recent-time--disconnected">{{ connection.lastUsedLabel }}</span>
          </button>
        </section>
      </section>

      <template v-else>
        <div v-if="isExplorerActive" class="ssh-path-bar" aria-label="远端路径">
          <template v-for="(segment, index) in SSH_PATH_SEGMENTS" :key="segment.id">
            <button
type="button" class="ssh-path-segment"
              :class="{ 'is-current': segment.id === CURRENT_PATH_SEGMENT_ID }"
              @click="handlePathSegmentClick(segment)">
              {{ segment.label }}
            </button>
            <span v-if="index < SSH_PATH_SEGMENTS.length - 1" class="ssh-path-separator">/</span>
          </template>
        </div>

        <div v-if="isExplorerActive" class="ssh-file-list" role="list" aria-label="远端文件列表">
          <button
v-for="item in SSH_FILE_ITEMS" :key="item.id" type="button" class="ssh-file-item" :class="{
            'is-folder': item.kind === 'folder',
            'is-selected': selectedFileId === item.id,
          }" :aria-label="`${item.name}，${item.metaLabel}`" @click="handleSelectFile(item.id)"
            @contextmenu.prevent="handleFileContextMenu($event, item.id)">
            <span class="ssh-file-icon" :class="`is-${item.kind}`" aria-hidden="true">
              <svg v-if="item.kind === 'folder'" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
              </svg>
              <span v-else-if="item.kind === 'rust'">⚙</span>
              <svg
v-else-if="item.kind === 'lock'" width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <svg
v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </span>

            <span class="ssh-file-name">{{ item.name }}</span>
            <span class="ssh-file-meta">{{ item.metaLabel }}</span>
          </button>
        </div>

        <div v-else-if="isTransferActive" class="ssh-transfer-panel" aria-label="传输任务列表">
          <article v-for="item in SSH_TRANSFER_ITEMS" :key="item.id" class="ssh-transfer-item">
            <div class="ssh-transfer-header">
              <div class="ssh-transfer-name">
                <span class="ssh-transfer-direction" :class="`is-${item.direction}`">
                  {{ item.direction === 'upload' ? '↑ 上传' : '↓ 下载' }}
                </span>
                {{ item.name }}
              </div>
              <span class="ssh-transfer-meta">{{ item.sizeLabel }}</span>
            </div>

            <div class="ssh-progress-bar" aria-hidden="true">
              <div class="ssh-progress-fill" :class="`is-${item.status}`" :style="{ width: `${item.progress}%` }" />
            </div>

            <div class="ssh-transfer-footer">
              <span class="ssh-transfer-meta">{{ item.progressLabel }}</span>
              <span class="ssh-transfer-meta" :class="{ 'is-success': item.status === 'done' }">
                {{ item.status === 'done' ? '✓' : `${item.progress}%` }}
              </span>
            </div>
          </article>
        </div>
      </template>
    </div>

    <footer class="ssh-sidebar-footer" :class="{ 'ssh-sidebar-footer--disconnected': isDisconnected }">
      <button
type="button" class="ssh-footer-button" :class="{
        'ssh-footer-button--disconnected': isDisconnected,
        'is-disabled': isDisconnected,
      }" :disabled="isDisconnected" title="连接后可用" @click="handleFooterAction('upload')">
        <svg
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        上传
      </button>

      <button
type="button" class="ssh-footer-button" :class="{
        'ssh-footer-button--disconnected': isDisconnected,
        'is-disabled': isDisconnected,
      }" :disabled="isDisconnected" title="连接后可用" @click="handleFooterAction('download')">
        <svg
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        下载
      </button>
    </footer>
  </section>

  <Teleport to="body">
    <div
v-if="isConnected && contextMenu.open" ref="contextMenuRef" class="ssh-context-menu" :style="{
      left: `${contextMenu.x}px`,
      top: `${contextMenu.y}px`,
    }" @click.stop>
      <template v-for="action in SSH_CONTEXT_ACTIONS" :key="action.key">
        <div v-if="action.separatorBefore" class="ssh-context-separator" />
        <button
type="button" class="ssh-context-item" :class="{ 'is-danger': action.tone === 'danger' }"
          @click="handleContextAction(action)">
          <svg v-if="action.key === 'rename'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <svg
v-else-if="action.key === 'copy-path'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg
v-else-if="action.key === 'download'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <svg
v-else-if="action.key === 'upload'" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {{ action.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ssh-sidebar-panel {
  --ssh-sidebar-bg: #0e0e10;
  --ssh-sidebar-border: rgba(255, 255, 255, 0.06);
  --ssh-sidebar-text-primary: #e8e8ed;
  --ssh-sidebar-text-secondary: #b0b0bc;
  --ssh-sidebar-text-muted: #6b6b76;
  --ssh-sidebar-text-faint: #4a4a54;
  --ssh-sidebar-text-disabled: #3a3a44;
  --ssh-sidebar-accent: #6366f1;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: var(--ssh-sidebar-bg);
  color: var(--ssh-sidebar-text-primary);
  user-select: none;
}

.ssh-sidebar-header {
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--shell-divider);
}

.ssh-sidebar-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.ssh-connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.25;
  color: var(--text-tertiary);
}

.ssh-connection-status--disconnected {
  color: var(--ssh-sidebar-text-muted);
}

.ssh-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--success);
  box-shadow: 0 0 10px color-mix(in srgb, var(--success) 48%, transparent);
  position: relative;
}

.ssh-status-dot.is-offline {
  background: #555;
  box-shadow: none;
}

.ssh-status-dot.is-offline::after {
  position: absolute;
  inset: -3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  animation: ssh-status-pulse 2s ease-in-out infinite;
  content: '';
}

@keyframes ssh-status-pulse {

  0%,
  100% {
    opacity: 0.4;
    transform: scale(1);
  }

  50% {
    opacity: 0.12;
    transform: scale(1.4);
  }
}

.ssh-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px 0;
}

.ssh-tabs--disconnected {
  padding: 8px 12px 0;
}

.ssh-panel-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.ssh-panel-body--disconnected {
  min-height: 0;
}

.ssh-panel-body--connected {
  min-height: 0;
}

.ssh-tab,
.ssh-button,
.ssh-footer-button,
.ssh-file-item,
.ssh-path-segment,
.ssh-context-item {
  appearance: none;
  border: 0;
  outline: none;
  font: inherit;
}

.ssh-tab {
  flex: 1;
  border-radius: 6px;
  padding: 6px 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.01em;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
  cursor: pointer;
}

.ssh-tab:hover {
  background: var(--surface-soft);
  color: var(--text-secondary);
}

.ssh-tab.is-active {
  background: var(--surface-soft-strong);
  color: var(--text-primary);
}

.ssh-tab--disconnected {
  color: var(--ssh-sidebar-text-muted);
}

.ssh-tab--disconnected:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--ssh-sidebar-text-secondary);
}

.ssh-tab--disconnected.is-active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--ssh-sidebar-text-primary);
}

.ssh-tab.is-disabled {
  color: color-mix(in srgb, var(--text-quaternary) 56%, transparent);
  cursor: default;
}

.ssh-tab.is-disabled:hover {
  background: transparent;
  color: color-mix(in srgb, var(--text-quaternary) 56%, transparent);
}

.ssh-tab--disconnected.is-disabled,
.ssh-tab--disconnected.is-disabled:hover {
  background: transparent;
  color: #4b4b56;
}

.ssh-empty-state {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  gap: 14px;
  text-align: center;
}

.ssh-empty-state--disconnected {
  padding: 24px 20px;
}

.ssh-empty-illustration {
  position: relative;
  display: flex;
  width: 64px;
  height: 64px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--accent-strong) 18%, transparent);
  border-radius: 14px;
  background: linear-gradient(135deg,
      color-mix(in srgb, var(--accent-strong) 10%, transparent),
      color-mix(in srgb, var(--accent-strong) 3%, transparent));
  color: var(--accent-strong);
}

.ssh-empty-illustration--disconnected {
  border: 1px solid rgba(99, 102, 241, 0.14);
  background: linear-gradient(180deg, rgba(58, 58, 112, 0.34), rgba(24, 24, 46, 0.42));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
  color: var(--ssh-sidebar-accent);
}

.ssh-empty-illustration svg {
  width: 28px;
  height: 28px;
}

.ssh-empty-illustration::before {
  position: absolute;
  inset: -1px;
  border-radius: 14px;
  background: linear-gradient(135deg,
      color-mix(in srgb, var(--accent-strong) 30%, transparent),
      transparent 60%);
  opacity: 0.28;
  filter: blur(8px);
  content: '';
  z-index: -1;
}

.ssh-empty-illustration--disconnected::before {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.3), transparent 60%);
  opacity: 0.3;
}

.ssh-empty-copy {
  display: grid;
  gap: 6px;
}

.ssh-empty-title {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.ssh-empty-title--disconnected {
  color: var(--ssh-sidebar-text-primary);
}

.ssh-empty-desc {
  max-width: 220px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.ssh-empty-desc--disconnected {
  color: var(--ssh-sidebar-text-muted);
}

.ssh-empty-actions {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.ssh-empty-actions--disconnected {
  max-width: none;
}

.ssh-button--stacked {
  width: 100%;
  padding: 7px 0;
  justify-content: center;
  gap: 6px;
}

.ssh-button--stacked svg {
  width: 13px;
  height: 13px;
}

.ssh-button--disconnected-primary {
  background: var(--ssh-sidebar-accent);
  color: #fff;
}

.ssh-button--disconnected-primary:hover {
  background: #7577f5;
}

.ssh-button--disconnected-ghost {
  background: transparent;
  color: #6b6b76;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ssh-button--disconnected-ghost:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #b0b0bc;
}

.ssh-recent-section {
  width: 100%;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed color-mix(in srgb, var(--shell-divider) 80%, transparent);
}

.ssh-recent-section--disconnected {
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
}

.ssh-recent-title {
  margin-bottom: 8px;
  text-align: left;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--text-quaternary) 68%, transparent);
}

.ssh-recent-title--disconnected {
  color: var(--ssh-sidebar-text-faint);
}

.ssh-recent-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  background: transparent;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease;
}

.ssh-recent-item:hover {
  background: color-mix(in srgb, var(--surface-soft) 96%, transparent);
}

.ssh-recent-item--disconnected:hover {
  background: rgba(255, 255, 255, 0.04);
}

.ssh-recent-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 92%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-soft) 92%, transparent);
  color: var(--text-tertiary);
}

.ssh-recent-icon--disconnected {
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: var(--ssh-sidebar-text-muted);
}

.ssh-recent-icon svg {
  width: 12px;
  height: 12px;
}

.ssh-recent-info {
  display: grid;
  min-width: 0;
  flex: 1;
}

.ssh-recent-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: color-mix(in srgb, var(--text-primary) 90%, transparent);
}

.ssh-recent-name--disconnected {
  color: #efeff7;
}

.ssh-recent-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--text-quaternary) 72%, transparent);
}

.ssh-recent-host--disconnected {
  color: #4a4a54;
}

.ssh-recent-time {
  flex-shrink: 0;
  font-size: 10px;
  color: color-mix(in srgb, var(--text-quaternary) 58%, transparent);
}

.ssh-recent-time--disconnected {
  color: #3a3a44;
}

.ssh-connect-form {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--shell-divider);
}

.ssh-connect-form--disconnected {
  padding: 16px 12px 12px;
  border-bottom: 0;
}

.ssh-form-row {
  display: flex;
  gap: 6px;
}

.ssh-form-group {
  display: grid;
  flex: 1;
  gap: 4px;
}

.ssh-form-group.is-compact {
  flex: 0 0 70px;
}

.ssh-form-group span {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.ssh-form-group input,
.ssh-form-group select {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-soft) 100%, transparent);
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 12px;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.ssh-form-group input::placeholder {
  color: color-mix(in srgb, var(--text-quaternary) 82%, transparent);
}

.ssh-form-group input:focus,
.ssh-form-group select:focus {
  border-color: color-mix(in srgb, var(--accent-strong) 72%, transparent);
  background: color-mix(in srgb, var(--surface-soft-strong) 100%, transparent);
}

.ssh-form-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.ssh-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  padding: 9px 14px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.ssh-button svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  display: block;
}

.ssh-button--primary {
  flex: 1;
  background: var(--accent-strong);
  color: #fff;
}

.ssh-button--primary:hover {
  background: color-mix(in srgb, var(--accent-strong) 88%, white);
}

.ssh-button--ghost {
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  background: transparent;
  color: var(--text-tertiary);
}

.ssh-button--ghost:hover {
  background: var(--surface-soft);
  color: var(--text-secondary);
}

.ssh-path-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--shell-divider);
  font-size: 11px;
  color: var(--text-tertiary);
}

.ssh-path-segment {
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: pointer;
  transition: color 0.15s ease;
}

.ssh-path-segment:hover {
  color: var(--text-secondary);
}

.ssh-path-segment.is-current {
  color: var(--text-primary);
  font-weight: 500;
  cursor: default;
}

.ssh-path-separator {
  opacity: 0.32;
}

.ssh-file-list,
.ssh-transfer-panel {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.ssh-file-list {
  padding: 4px 0;
}

.ssh-file-list::-webkit-scrollbar,
.ssh-transfer-panel::-webkit-scrollbar {
  width: 4px;
}

.ssh-file-list::-webkit-scrollbar-thumb,
.ssh-transfer-panel::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--shell-divider) 100%, transparent);
}

.ssh-file-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.ssh-file-item:hover {
  background: var(--surface-soft);
}

.ssh-file-item.is-selected {
  background: color-mix(in srgb, var(--accent-strong) 14%, transparent);
}

.ssh-file-icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 13px;
}

.ssh-file-icon.is-folder {
  color: var(--accent-strong);
}

.ssh-file-icon.is-rust {
  color: #e57c52;
}

.ssh-file-icon.is-toml {
  color: var(--success);
}

.ssh-file-icon.is-markdown {
  color: #60a5fa;
}

.ssh-file-icon.is-lock,
.ssh-file-icon.is-file {
  color: var(--text-tertiary);
}

.ssh-file-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: color-mix(in srgb, var(--text-primary) 88%, var(--text-secondary));
  font-size: 12.5px;
}

.ssh-file-item.is-folder .ssh-file-name {
  font-weight: 500;
  color: var(--text-primary);
}

.ssh-file-meta,
.ssh-transfer-meta {
  flex-shrink: 0;
  color: var(--text-quaternary);
  font-variant-numeric: tabular-nums;
}

.ssh-file-meta {
  font-size: 10.5px;
}

.ssh-transfer-panel {
  padding: 8px 12px;
}

.ssh-transfer-item {
  margin-bottom: 6px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 92%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 92%, transparent);
  padding: 10px;
}

.ssh-transfer-header,
.ssh-transfer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ssh-transfer-header {
  margin-bottom: 6px;
}

.ssh-transfer-footer {
  margin-top: 4px;
}

.ssh-transfer-name {
  display: flex;
  align-items: center;
  gap: 6px;
  color: color-mix(in srgb, var(--text-primary) 88%, var(--text-secondary));
  font-size: 12px;
  font-weight: 500;
}

.ssh-transfer-direction {
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
}

.ssh-transfer-direction.is-upload {
  background: color-mix(in srgb, var(--accent-strong) 18%, transparent);
  color: color-mix(in srgb, var(--accent-strong) 82%, white);
}

.ssh-transfer-direction.is-download {
  background: color-mix(in srgb, var(--success) 18%, transparent);
  color: color-mix(in srgb, var(--success) 86%, white);
}

.ssh-transfer-meta {
  font-size: 10.5px;
}

.ssh-transfer-meta.is-success {
  color: var(--success);
}

.ssh-progress-bar {
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--shell-divider) 88%, transparent);
}

.ssh-progress-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}

.ssh-progress-fill.is-uploading {
  background: linear-gradient(90deg, var(--accent-strong), color-mix(in srgb, var(--accent-strong) 72%, white));
}

.ssh-progress-fill.is-downloading {
  background: linear-gradient(90deg, #059669, var(--success));
}

.ssh-progress-fill.is-done {
  background: var(--success);
}

.ssh-sidebar-footer {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--shell-divider);
}

.ssh-sidebar-footer--disconnected {
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ssh-footer-button {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 88%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface-soft) 100%, transparent);
  padding: 7px 0;
  color: var(--text-secondary);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.ssh-footer-button:hover {
  background: var(--surface-soft-strong);
  color: var(--text-primary);
}

.ssh-footer-button--disconnected {
  color: #b0b0bc;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ssh-footer-button:disabled,
.ssh-footer-button.is-disabled,
.ssh-footer-button:disabled:hover,
.ssh-footer-button.is-disabled:hover {
  color: #3a3a44;
  background: rgba(255, 255, 255, 0.04);
  cursor: default;
  opacity: 0.6;
}

.ssh-footer-button svg,
.ssh-context-item svg {
  width: 14px;
  height: 14px;
}

.ssh-context-menu {
  position: fixed;
  z-index: 120;
  min-width: 160px;
  border: 1px solid color-mix(in srgb, var(--shell-divider) 100%, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg) 94%, var(--sidebar-bg));
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.ssh-context-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border-radius: 5px;
  background: transparent;
  padding: 6px 10px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.1s ease,
    color 0.1s ease;
}

.ssh-context-item:hover {
  background: color-mix(in srgb, var(--accent-strong) 14%, transparent);
  color: var(--text-primary);
}

.ssh-context-item.is-danger:hover {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.ssh-context-item svg {
  opacity: 0.62;
}

.ssh-context-separator {
  height: 1px;
  margin: 4px 0;
  background: color-mix(in srgb, var(--shell-divider) 92%, transparent);
}
</style>
