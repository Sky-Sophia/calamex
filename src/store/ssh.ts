import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, ref } from 'vue'

import type {
  ISshConnectionForm,
  ISshFileItem,
  ISshRecentConnection,
  ISshTransferItem,
  TSshAuthMode,
  TSshContentTab,
} from '@/types/ssh'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_SSH_CONNECTIONS = 8
const DEFAULT_SSH_PORT = '22'

/** 相对时间标签的刷新间隔。30s 足够覆盖 "刚刚" / "n 分钟前" 的过渡。 */
const RELATIVE_TIME_TICK_MS = 30_000

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const hasWindow = (): boolean => typeof window !== 'undefined'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

const formatRelativeLastUsed = (timestamp: string | null): string => {
  if (!timestamp) return 'SSH config'

  const parsedTime = Date.parse(timestamp)
  if (Number.isNaN(parsedTime)) return '最近'

  const elapsedMs = Date.now() - parsedTime
  if (elapsedMs < 60_000) return '刚刚'

  const elapsedMinutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} 小时前`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 30) return `${elapsedDays} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(parsedTime))
}

const normalizeProfileKey = (
  profile: Pick<ISshRecentConnection, 'host' | 'port' | 'username'>,
): string =>
  `${profile.username.trim()}@${profile.host.trim()}:${profile.port.trim() || DEFAULT_SSH_PORT}`

const createManualConnectionId = (
  profile: Pick<ISshRecentConnection, 'host' | 'port' | 'username'>,
): string =>
  `manual-${normalizeProfileKey(profile).replace(/[^a-zA-Z0-9._:-]/g, '-')}`

const isValidRecentConnection = (value: unknown): value is ISshRecentConnection => {
  if (!isPlainObject(value)) return false
  const v = value as Partial<ISshRecentConnection>
  return (
    typeof v.id === 'string'
    && typeof v.name === 'string'
    && typeof v.host === 'string'
    && typeof v.port === 'string'
    && typeof v.username === 'string'
    && (v.authMode === 'password' || v.authMode === 'key')
    && typeof v.identityPath === 'string'
    && (typeof v.lastUsedAt === 'string' || v.lastUsedAt === null)
  )
}

const createEmptyConnectionForm = (): ISshConnectionForm => ({
  host: '',
  port: DEFAULT_SSH_PORT,
  username: '',
  authMode: 'password',
  identityPath: '',
  password: '',
})

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSshStore = defineStore('ssh', () => {
  const activeContentTab = ref<TSshContentTab>('explorer')
  const isConnectFormVisible = ref(false)
  const isConnected = ref(false)
  const currentConnectionId = ref<string | null>(null)
  const selectedFileId = ref('')
  const recentConnections = ref<ISshRecentConnection[]>([])
  const sshFileItems = ref<ISshFileItem[]>([])
  const transferItems = ref<ISshTransferItem[]>([])
  const currentRemotePath = ref('.')
  const connectionForm = reactive<ISshConnectionForm>(createEmptyConnectionForm())

  const nowTick = ref(0)
  if (hasWindow()) {
    const intervalHandle = window.setInterval(() => {
      nowTick.value += 1
    }, RELATIVE_TIME_TICK_MS)
    onScopeDispose(() => {
      window.clearInterval(intervalHandle)
    })
  }

  const normalizedRecentConnections = computed<ISshRecentConnection[]>(() => {
    void nowTick.value
    return recentConnections.value.map((connection) => ({
      ...connection,
      lastUsedLabel: formatRelativeLastUsed(connection.lastUsedAt),
    }))
  })

  const clearRemoteSnapshot = (): void => {
    currentRemotePath.value = '.'
    sshFileItems.value = []
    selectedFileId.value = ''
  }

  const applyConnectionState = (connectionId: string | null): void => {
    currentConnectionId.value = connectionId
    isConnected.value = true
    isConnectFormVisible.value = false
    activeContentTab.value = 'explorer'
  }

  const applyPasswordTerminalState = (connectionId: string | null): void => {
    applyConnectionState(connectionId)
    clearRemoteSnapshot()
  }

  const clearConnectionState = (): void => {
    isConnected.value = false
    currentConnectionId.value = null
    isConnectFormVisible.value = false
    activeContentTab.value = 'explorer'
    clearRemoteSnapshot()
  }

  const setConnectionFormFromProfile = (connection: ISshRecentConnection): void => {
    connectionForm.host = connection.host
    connectionForm.port = connection.port
    connectionForm.username = connection.username
    connectionForm.authMode = connection.authMode
    connectionForm.identityPath = connection.identityPath
    connectionForm.password = ''
  }

  const replacePassword = (value: string): void => {
    connectionForm.password = value
  }

  const setAuthMode = (authMode: TSshAuthMode): void => {
    connectionForm.authMode = authMode
  }

  const setRecentConnections = (connections: ISshRecentConnection[]): void => {
    const seen = new Set<string>()
    recentConnections.value = connections
      .filter((connection) => {
        const key = normalizeProfileKey(connection)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_RECENT_SSH_CONNECTIONS)
  }

  const rememberCurrentConnection = (connectionId?: string): string => {
    const port = connectionForm.port.trim() || DEFAULT_SSH_PORT
    const host = connectionForm.host.trim()
    const username = connectionForm.username.trim()
    const lastUsedAt = new Date().toISOString()

    const resolvedId = connectionId
      ?? createManualConnectionId({ host, port, username })

    const profile: ISshRecentConnection = {
      id: resolvedId,
      name: host,
      username,
      host,
      port,
      authMode: connectionForm.authMode,
      identityPath:
        connectionForm.authMode === 'key'
          ? connectionForm.identityPath.trim()
          : '',
      lastUsedLabel: formatRelativeLastUsed(lastUsedAt),
      lastUsedAt,
    }

    const profileKey = normalizeProfileKey(profile)
    recentConnections.value = [
      profile,
      ...recentConnections.value.filter(
        (connection) => normalizeProfileKey(connection) !== profileKey,
      ),
    ].slice(0, MAX_RECENT_SSH_CONNECTIONS)

    return profile.id
  }

  const reset = (): void => {
    activeContentTab.value = 'explorer'
    isConnectFormVisible.value = false
    isConnected.value = false
    currentConnectionId.value = null
    selectedFileId.value = ''
    recentConnections.value = []
    sshFileItems.value = []
    transferItems.value = []
    currentRemotePath.value = '.'
    Object.assign(connectionForm, createEmptyConnectionForm())
  }

  return {
    activeContentTab,
    isConnectFormVisible,
    isConnected,
    currentConnectionId,
    selectedFileId,
    recentConnections,
    sshFileItems,
    transferItems,
    currentRemotePath,
    connectionForm,
    normalizedRecentConnections,
    applyConnectionState,
    applyPasswordTerminalState,
    clearConnectionState,
    clearRemoteSnapshot,
    setConnectionFormFromProfile,
    setRecentConnections,
    rememberCurrentConnection,
    replacePassword,
    setAuthMode,
    reset,
  }
}, {
  persist: {
    key: 'shell-ide.ssh',
    pick: ['recentConnections'],
    afterHydrate(ctx) {
      const store = ctx.store as unknown as {
        recentConnections: ISshRecentConnection[]
      }
      const raw: unknown = store.recentConnections
      const list = Array.isArray(raw) ? raw : []
      store.recentConnections = list
        .filter(isValidRecentConnection)
        .slice(0, MAX_RECENT_SSH_CONNECTIONS)
    },
  },
})