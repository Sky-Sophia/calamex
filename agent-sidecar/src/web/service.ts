import { createHash } from 'node:crypto'

import { createMastraMcpClientBundle } from '../tools/mcp.js'

import {
  aiWebFetchInputSchema,
  aiWebFetchPayloadSchema,
  aiWebSearchInputSchema,
  aiWebSearchPayloadSchema,
  type TAiWebFetchInput,
  type TAiWebFetchPayload,
  type TAiWebSearchInput,
  type TAiWebSearchPayload,
} from './types.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const MAX_WEB_SEARCH_RESULTS = 8
const MIN_TAVILY_SEARCH_RESULTS = 5
const WEB_TEXT_REF_PREFIX = 'web-text:'
const WEB_EXCERPT_CHARS = 600
const WEB_TEXT_REF_MAX_ENTRIES = 256

const TAVILY_FIELD = {
  title: 'Title: ',
  url: 'URL: ',
  content: 'Content: ',
  rawContent: 'Raw Content: ',
} as const

const TAVILY_FIELD_PREFIXES = Object.values(TAVILY_FIELD)

// 显式白名单：归类为 "official"
const OFFICIAL_DOMAINS = new Set<string>([
  'w3.org',
  'python.org',
  'mozilla.org',
  'developer.mozilla.org',
  'openai.com',
  'anthropic.com',
  'vercel.com',
  'vercel.app',
  'tauri.app',
  'rust-lang.org',
  'nodejs.org',
  'typescriptlang.org',
])

// 显式白名单：归类为 "forum"
const FORUM_DOMAINS = new Set<string>([
  'stackoverflow.com',
  'stackexchange.com',
  'reddit.com',
  'news.ycombinator.com',
])

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type TMcpTextBlock = {
  type?: string
  text?: string
}

type TMcpToolResult = {
  content?: TMcpTextBlock[]
  error?: boolean
  message?: string
}

type TExecutableTool = {
  execute: (args: unknown) => Promise<unknown>
}

type TTavilyToolName = 'tavily-mcp_tavily-search' | 'tavily-mcp_tavily-extract'

type TMcpBundle = Awaited<ReturnType<typeof createMastraMcpClientBundle>>

// ---------------------------------------------------------------------------
// Ref 存储（FIFO 上限，避免无界内存）
// ---------------------------------------------------------------------------

const webTextRefStore = new Map<string, string>()

const setWebTextRef = (refId: string, text: string): void => {
  if (webTextRefStore.has(refId)) {
    webTextRefStore.delete(refId)
  }
  webTextRefStore.set(refId, text)
  while (webTextRefStore.size > WEB_TEXT_REF_MAX_ENTRIES) {
    const oldestKey = webTextRefStore.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    webTextRefStore.delete(oldestKey)
  }
}

export const webTextRefs = {
  load(refId: string): string | null {
    return webTextRefStore.get(refId) ?? null
  },
  evict(refId: string): boolean {
    return webTextRefStore.delete(refId)
  },
  clear(): void {
    webTextRefStore.clear()
  },
  get size(): number {
    return webTextRefStore.size
  },
}

// ---------------------------------------------------------------------------
// MCP 工具与错误处理
// ---------------------------------------------------------------------------

const createError = (message: string): Error => new Error(message)

const isExecutableTool = (value: unknown): value is TExecutableTool => {
  const record = value as TExecutableTool | null
  return typeof record?.execute === 'function'
}

// 精确匹配 Mastra 在 runtimeContext 缺失时抛出的几种 stack，避免误吞业务错误
const CONTEXT_SIGNATURE_PATTERNS: readonly RegExp[] = [
  /Cannot read propert(?:y|ies) of undefined \(reading ['"](?:context|runtimeContext)['"]\)/iu,
  /undefined is not an object \(evaluating ['"][^'"]*\.(?:context|runtimeContext)['"]\)/iu,
  /['"]runtimeContext['"] is not defined/iu,
]

const isContextSignatureError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }
  return CONTEXT_SIGNATURE_PATTERNS.some((pattern) => pattern.test(error.message))
}

const readMcpText = (value: unknown): string => {
  const record = value as TMcpToolResult | null
  const content = record?.content
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((item) => (item?.type === 'text' ? item.text ?? '' : ''))
    .join('\n')
    .trim()
}

const ensureMcpSuccess = (value: unknown, fallbackMessage: string): string => {
  const record = value as TMcpToolResult | null
  if (record?.error) {
    throw createError(record.message?.trim() || fallbackMessage)
  }
  const text = readMcpText(value)
  if (!text) {
    throw createError(fallbackMessage)
  }
  return text
}

// ---------------------------------------------------------------------------
// 共享 MCP bundle（懒加载 + 进程退出时统一关闭）
// ---------------------------------------------------------------------------

let sharedBundlePromise: Promise<TMcpBundle> | null = null
let shutdownHookRegistered = false

const registerShutdownHook = (): void => {
  if (shutdownHookRegistered || typeof process === 'undefined') {
    return
  }
  shutdownHookRegistered = true
  const dispose = (): void => {
    const pending = sharedBundlePromise
    sharedBundlePromise = null
    if (!pending) {
      return
    }
    void pending.then(
      (bundle) => bundle.disconnectAll().catch(() => undefined),
      () => undefined,
    )
  }
  process.once('beforeExit', dispose)
  process.once('SIGINT', dispose)
  process.once('SIGTERM', dispose)
}

const getSharedBundle = async (): Promise<TMcpBundle> => {
  if (!sharedBundlePromise) {
    registerShutdownHook()
    sharedBundlePromise = createMastraMcpClientBundle({ serverNames: ['tavily-mcp'] }).catch(
      (error) => {
        sharedBundlePromise = null
        throw error
      },
    )
  }
  return sharedBundlePromise
}

const executeTavilyTool = async (
  toolName: TTavilyToolName,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const bundle = await getSharedBundle()
  const tool = bundle.tools[toolName]
  if (!isExecutableTool(tool)) {
    throw createError(`未找到官方 Tavily MCP 工具：${toolName}`)
  }
  try {
    return await tool.execute(args)
  } catch (error) {
    if (isContextSignatureError(error)) {
      return await tool.execute({ context: args, runtimeContext: undefined })
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

const clipChars = (value: string, maxChars: number): string => {
  if (maxChars <= 0) {
    return ''
  }
  const chars = Array.from(value)
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join('')}…`
    : value
}

// O(n) 字节裁剪：encode 一次，回退到非 UTF-8 续字节边界
const clipToByteLimit = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) {
    return ''
  }
  const encoder = new TextEncoder()
  const bytes = encoder.encode(value)
  if (bytes.byteLength <= maxBytes) {
    return value
  }
  let end = Math.min(maxBytes, bytes.byteLength)
  while (end > 0) {
    const byte = bytes[end] ?? 0
    if ((byte & 0b1100_0000) !== 0b1000_0000) {
      break
    }
    end -= 1
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, end))
}

const normalizeExcerptText = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

// 内容寻址：相同 (url, text) 始终得到相同 refId，天然幂等去重
const buildTextRef = (url: string, text: string): string => {
  const hash = createHash('sha256')
    .update(url)
    .update('\0')
    .update(text)
    .digest('hex')
    .slice(0, 16)
  return `${WEB_TEXT_REF_PREFIX}${hash}`
}

// ---------------------------------------------------------------------------
// URL / 来源分类
// ---------------------------------------------------------------------------

type TParsedUrl = {
  host: string
  path: string
}

const safeParseUrl = (rawUrl: string): TParsedUrl | null => {
  try {
    const parsed = new URL(rawUrl)
    return {
      host: parsed.hostname.toLowerCase(),
      path: parsed.pathname.toLowerCase(),
    }
  } catch {
    return null
  }
}

const matchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

const isOfficialHost = (host: string): boolean => {
  for (const domain of OFFICIAL_DOMAINS) {
    if (matchesDomain(host, domain)) {
      return true
    }
  }
  return host.endsWith('.gov') || host.endsWith('.edu')
}

const isDocsHost = (host: string, path: string): boolean =>
  host.startsWith('docs.')
  || host.startsWith('developer.')
  || host.includes('.docs.')
  || path.startsWith('/docs')
  || path.startsWith('/doc/')

const isGithubHost = (host: string): boolean =>
  matchesDomain(host, 'github.com')
  || host.endsWith('.github.io')

const isForumHost = (host: string): boolean => {
  for (const domain of FORUM_DOMAINS) {
    if (matchesDomain(host, domain)) {
      return true
    }
  }
  return host.startsWith('forum.')
    || host.startsWith('discourse.')
    || matchesDomain(host, 'discourse.org')
}

const isBlogHost = (host: string, path: string): boolean =>
  host.startsWith('blog.')
  || host.endsWith('.blog')
  || path.startsWith('/blog')

// 优先级：official > docs > github > forum > blog > unknown
const classifySourceType = (
  rawUrl: string,
): TAiWebSearchPayload['results'][number]['sourceType'] => {
  const parsed = safeParseUrl(rawUrl)
  if (!parsed) {
    return 'unknown'
  }
  const { host, path } = parsed
  if (isOfficialHost(host)) {
    return 'official'
  }
  if (isDocsHost(host, path)) {
    return 'docs'
  }
  if (isGithubHost(host)) {
    return 'github'
  }
  if (isForumHost(host)) {
    return 'forum'
  }
  if (isBlogHost(host, path)) {
    return 'blog'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Tavily 文本解析
// ---------------------------------------------------------------------------

const isFieldPrefixLine = (line: string): boolean =>
  TAVILY_FIELD_PREFIXES.some((prefix) => line.startsWith(prefix))

type TSearchAccumulator = {
  title?: string
  url?: string
  content?: string[]
}

const flushSearchAcc = (
  acc: TSearchAccumulator,
  results: TAiWebSearchPayload['results'],
): void => {
  if (!acc.url) {
    return
  }
  const urlTrimmed = acc.url.trim()
  const titleTrimmed = acc.title?.trim()
  const contentTrimmed = acc.content?.join('\n').trim() ?? ''
  results.push({
    title: clipChars(titleTrimmed || urlTrimmed, 120),
    url: urlTrimmed,
    snippet: clipChars(contentTrimmed, 300),
    sourceType: classifySourceType(urlTrimmed),
    fetchedAt: new Date().toISOString(),
  })
}

const parseSearchText = (
  text: string,
  input: TAiWebSearchInput,
): TAiWebSearchPayload => {
  const lines = text.split(/\r?\n/gu)
  const results: TAiWebSearchPayload['results'] = []
  let current: TSearchAccumulator = {}
  let activeField: 'content' | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed.startsWith(TAVILY_FIELD.title)) {
      if (current.url) {
        flushSearchAcc(current, results)
      }
      current = { title: trimmed.slice(TAVILY_FIELD.title.length) }
      activeField = null
      continue
    }
    if (trimmed.startsWith(TAVILY_FIELD.url)) {
      current.url = trimmed.slice(TAVILY_FIELD.url.length)
      activeField = null
      continue
    }
    if (trimmed.startsWith(TAVILY_FIELD.content)) {
      current.content = [trimmed.slice(TAVILY_FIELD.content.length)]
      activeField = 'content'
      continue
    }

    if (activeField === 'content' && trimmed && !isFieldPrefixLine(trimmed)) {
      current.content?.push(trimmed)
      continue
    }
    if (!trimmed) {
      activeField = null
    }
  }
  flushSearchAcc(current, results)

  return aiWebSearchPayloadSchema.parse({
    results: results.slice(0, input.maxResults),
  })
}

const parseExtractText = (
  text: string,
  input: TAiWebFetchInput,
): { title: string; rawContent: string } => {
  const lines = text.split(/\r?\n/gu)
  let title = ''
  let rawContent = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (!title && line.startsWith(TAVILY_FIELD.title)) {
      title = line.slice(TAVILY_FIELD.title.length).trim()
      continue
    }
    if (line.startsWith(TAVILY_FIELD.rawContent)) {
      rawContent = [
        line.slice(TAVILY_FIELD.rawContent.length),
        ...lines.slice(index + 1),
      ]
        .join('\n')
        .trim()
      break
    }
  }

  // Fallback：未匹配到 Raw Content: 前缀时，把整段文本视作正文
  if (!rawContent) {
    const stripped = lines
      .filter((line) => !line.trim().startsWith(TAVILY_FIELD.title))
      .join('\n')
      .trim()
    if (stripped) {
      rawContent = stripped
    }
  }

  if (!rawContent) {
    throw createError('官方 tavily-extract 未返回正文内容。')
  }

  return {
    title: title || input.url,
    rawContent,
  }
}

// ---------------------------------------------------------------------------
// 参数构造
// ---------------------------------------------------------------------------

const toRecencyDays = (recency: TAiWebSearchInput['recency']): number | undefined => {
  switch (recency) {
    case 'day':
      return 1
    case 'week':
      return 7
    case 'month':
      return 30
    case 'year':
      return 365
    default:
      return undefined
  }
}

const buildSearchArgs = (input: TAiWebSearchInput): Record<string, unknown> => {
  const days = toRecencyDays(input.recency)
  return {
    query: input.query.trim(),
    topic: input.intent === 'release-notes' ? 'news' : 'general',
    max_results: Math.max(
      MIN_TAVILY_SEARCH_RESULTS,
      Math.min(MAX_WEB_SEARCH_RESULTS, input.maxResults),
    ),
    include_favicon: true,
    include_raw_content: false,
    ...(days ? { days } : {}),
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export const searchWeb = async (rawInput: unknown): Promise<TAiWebSearchPayload> => {
  const input = aiWebSearchInputSchema.parse(rawInput)
  const result = await executeTavilyTool('tavily-mcp_tavily-search', buildSearchArgs(input))
  const text = ensureMcpSuccess(result, '官方 tavily-search 未返回搜索结果。')
  return parseSearchText(text, input)
}

export const fetchWeb = async (rawInput: unknown): Promise<TAiWebFetchPayload> => {
  const input = aiWebFetchInputSchema.parse(rawInput)
  const trimmedUrl = input.url.trim()
  const result = await executeTavilyTool('tavily-mcp_tavily-extract', {
    urls: [trimmedUrl],
    extract_depth: 'basic',
    format: 'markdown',
    include_images: false,
    include_favicon: true,
    query: input.reason.trim(),
  })
  const text = ensureMcpSuccess(result, '官方 tavily-extract 未返回网页内容。')
  const extracted = parseExtractText(text, input)
  const clipped = clipToByteLimit(extracted.rawContent, input.maxBytes)
  const textRef = buildTextRef(trimmedUrl, clipped)
  setWebTextRef(textRef, clipped)

  return aiWebFetchPayloadSchema.parse({
    source: {
      url: trimmedUrl,
      title: extracted.title,
      textRef,
      excerpt: clipChars(normalizeExcerptText(clipped), WEB_EXCERPT_CHARS),
      bytes: new TextEncoder().encode(clipped).byteLength,
      fetchedAt: new Date().toISOString(),
      truncated: clipped !== extracted.rawContent,
    },
  })
}