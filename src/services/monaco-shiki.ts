import { shikiToMonaco } from '@shikijs/monaco'
import * as monaco from 'monaco-editor'
import { createHighlighter, type Highlighter } from 'shiki'

const LANGUAGES = [
    'bash', 'shell', 'json', 'jsonc', 'yaml', 'toml', 'markdown',
    'typescript', 'javascript', 'tsx', 'jsx', 'vue', 'html', 'css',
    'rust', 'python', 'sql', 'ini', 'dockerfile',
] as const

const THEMES = ['vitesse-dark', 'vitesse-light'] as const

type TShikiTheme = (typeof THEMES)[number]

const DEFAULT_THEME: TShikiTheme = 'vitesse-dark'

let highlighter: Highlighter | null = null
let installPromise: Promise<void> | null = null

/**
 * 用户在 init 完成前调用 setMonacoShikiTheme 时记下,init 完成后立即 apply。
 * null 表示"用 DEFAULT_THEME"。
 */
let pendingTheme: TShikiTheme | null = null

async function install(): Promise<void> {
    // R4:一次性构造已注册语言集合,避免 LANGUAGES.length × O(allLanguages) 扫描。
    const registered = new Set(monaco.languages.getLanguages().map((l) => l.id))
    for (const lang of LANGUAGES) {
        if (!registered.has(lang)) {
            monaco.languages.register({ id: lang })
        }
    }

    // R1:局部变量持有,成功才提升到全局。失败路径在 catch 里 dispose,
    // 避免 wasm 实例 / 已加载 grammar 资源 leak。
    let nextHighlighter: Highlighter | null = null
    try {
        nextHighlighter = await createHighlighter({
            themes: [...THEMES],
            langs: [...LANGUAGES],
        })
        shikiToMonaco(nextHighlighter, monaco)
        // R3:init 完成时应用调用方在等待期间提交的 pending theme;否则用默认。
        monaco.editor.setTheme(pendingTheme ?? DEFAULT_THEME)
        pendingTheme = null

        // 防御:理论上 highlighter 此时一定为 null,但若旧实例残留(极端重试
        // 路径),先 dispose 再换新,确保不 leak。
        if (highlighter && highlighter !== nextHighlighter) {
            try {
                highlighter.dispose()
            } catch (error) {
                console.warn('[monaco-shiki] dispose stale highlighter failed', error)
            }
        }
        highlighter = nextHighlighter
    } catch (error) {
        if (nextHighlighter) {
            try {
                nextHighlighter.dispose()
            } catch (disposeError) {
                console.warn('[monaco-shiki] dispose nextHighlighter after install failure', disposeError)
            }
        }
        throw error
    }
}

/**
 * 幂等初始化。第一次调用真正去 install,后续调用复用同一个 Promise。
 * 失败时清空 installPromise,允许再次 ensureMonacoShikiReady 触发重试。
 *
 * - bootstrap 阶段:`void ensureMonacoShikiReady()` 触发预热
 * - 创建 editor 前:`await ensureMonacoShikiReady()` 确保就绪
 */
export function ensureMonacoShikiReady(): Promise<void> {
    if (!installPromise) {
        installPromise = install().catch((error) => {
            installPromise = null // 失败允许重试
            throw error
        })
    }
    return installPromise
}

/**
 * 切换 shiki 注册的 theme。
 *
 * **可在 ensureMonacoShikiReady 完成前安全调用**:此时仅记录意图,init 完成
 * 时自动 apply。若 init 已完成,立即 apply。
 *
 * 解决了直接 `monaco.editor.setTheme('vitesse-dark')` 在 init 前会静默 fall
 * back 到 monaco 内置 theme 的问题 (R2)。
 */
export function setMonacoShikiTheme(theme: TShikiTheme): void {
    if (!highlighter) {
        // shikiToMonaco 还没把 theme 注册到 monaco,先记下意图。
        pendingTheme = theme
        return
    }
    monaco.editor.setTheme(theme)
}

/**
 * 返回当前 shiki highlighter,未 init 或 init 失败时返回 null。
 *
 * 通常在 `await ensureMonacoShikiReady()` 之后调用,此时返回值保证非 null。
 */
export function getShikiHighlighter(): Highlighter | null {
    return highlighter
}