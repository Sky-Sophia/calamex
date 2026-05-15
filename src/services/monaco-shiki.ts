import { shikiToMonaco } from '@shikijs/monaco'
import * as monaco from 'monaco-editor'
import { createHighlighter, type Highlighter } from 'shiki'

const LANGUAGES = [
    'bash', 'shell', 'json', 'jsonc', 'yaml', 'toml', 'markdown',
    'typescript', 'javascript', 'tsx', 'jsx', 'vue', 'html', 'css',
    'rust', 'python', 'sql', 'ini', 'dockerfile',
] as const

const THEMES = ['vitesse-dark', 'vitesse-light'] as const

let highlighter: Highlighter | null = null
let installPromise: Promise<void> | null = null

async function install(): Promise<void> {
    for (const lang of LANGUAGES) {
        if (!monaco.languages.getLanguages().some((l) => l.id === lang)) {
            monaco.languages.register({ id: lang })
        }
    }
    highlighter = await createHighlighter({
        themes: [...THEMES],
        langs: [...LANGUAGES],
    })
    shikiToMonaco(highlighter, monaco)
    monaco.editor.setTheme('vitesse-dark')
}

/**
 * 幂等初始化。第一次调用真正去 install,后续调用复用同一个 Promise。
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

export function setMonacoShikiTheme(theme: (typeof THEMES)[number]): void {
    monaco.editor.setTheme(theme)
}

export function getShikiHighlighter(): Highlighter | null {
    return highlighter
}