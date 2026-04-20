import { listShellCommandLabels } from './services/shell-command-catalog';
import { initAppTooltipSystem } from './utils/app-tooltip';
import { registerRuntimeDiagnostics, setRuntimeError } from './utils/runtime-diagnostics';

registerRuntimeDiagnostics();
queueMicrotask(() => {
  void listShellCommandLabels();
});

// ---------------------------------------------------------------------------
// 全局类型声明
// ---------------------------------------------------------------------------

interface TauriBootstrapInternals {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface BootstrapSplashState {
  /** 启动开始的高精度时间戳 (performance.now)。 */
  startedAt: number;
  /** 当前已显示的字符数，用于 bootstrap 与 Vue splash 连续接力。 */
  visibleCharacters: number;
  /** 当前进度 0-100。 */
  progress: number;
  /** 是否已交接到主应用。 */
  handoff?: boolean;
}

declare global {
  interface Window {
    __SH_SPLASH_BOOTSTRAP_STATE__?: BootstrapSplashState;
    __TAURI_INTERNALS__?: TauriBootstrapInternals;
  }
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const BOOTSTRAP_SPLASH_HOST_ID = 'bootstrap-splash-host';
const BOOTSTRAP_SPLASH_STYLE_ID = 'bootstrap-splash-style';
const BOOTSTRAP_SPLASH_INITIAL_PROGRESS = 8; // 避免进度条长时间停在 0
const BOOTSTRAP_ERROR_DETAIL_MAX_LENGTH = 8 * 1024; // 防止超长 stack 撑爆 DOM

const MESSAGES = {
  loadingStatus: '正在初始化资源，请稍候...',
  errorTitle: '[error] 应用入口加载失败',
  errorMessagePrefix: '[message] ',
  errorStatus: '启动失败，请查看错误日志。',
  copyButton: '复制错误信息',
  copyButtonDone: '已复制 ✓',
  vueErrorLabel: 'Vue 组件渲染错误',
  bootstrapErrorLabel: '应用入口加载失败',
} as const;

// ---------------------------------------------------------------------------
// 共享样式（只注入一次）
// ---------------------------------------------------------------------------

const SPLASH_STYLE = `
#bootstrap-splash,#bootstrap-splash *{box-sizing:border-box}
#bootstrap-splash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:0;background:transparent;color:#d1d5db;font-family:Inter,'JetBrains Mono',Consolas,monospace}
#bootstrap-splash::before{position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,rgba(94,106,210,.16),transparent 42%),radial-gradient(circle at 50% 54%,rgba(255,255,255,.05),transparent 38%);content:'';pointer-events:none}
#bootstrap-splash .editor{position:relative;z-index:1;width:min(780px,100vw);height:min(520px,100vh);min-height:0;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;border:1px solid #23262b;border-radius:10px;background:#15171a;box-shadow:0 24px 72px rgba(0,0,0,.36),0 1px 0 rgba(255,255,255,.04) inset;transform:translateZ(0);backface-visibility:hidden}
#bootstrap-splash .editor.error{border-color:rgba(255,107,122,.34);box-shadow:0 24px 72px rgba(0,0,0,.36),0 1px 0 rgba(255,255,255,.04) inset,0 0 0 1px rgba(255,107,122,.08)}
#bootstrap-splash .top{display:flex;align-items:center;gap:8px;padding:14px 20px;border-bottom:1px solid #23262b;background:#111215}
#bootstrap-splash .dot{width:10px;height:10px;border-radius:999px}
#bootstrap-splash .red{background:#da5555}
#bootstrap-splash .yellow{background:#e6b349}
#bootstrap-splash .green{background:#49c085}
#bootstrap-splash .title{display:flex;align-items:center;gap:8px;margin-left:16px;color:#a1a8b3;font-size:13px;font-weight:400}
#bootstrap-splash .code{flex:1;padding:32px;background:#15171a;font-size:15px;line-height:1.9}
#bootstrap-splash .log{flex:1;overflow:hidden;padding:26px 32px 18px;background:#15171a;color:#d1d5db;font-size:13px;line-height:1.8;display:flex;flex-direction:column}
#bootstrap-splash .log-line{margin-bottom:10px;color:#c4c9d4;white-space:pre-wrap;word-break:break-word}
#bootstrap-splash .log-line-error{color:#ff9aa5}
#bootstrap-splash .log-divider{height:1px;margin:14px 0 16px;background:rgba(255,255,255,.08)}
#bootstrap-splash .log-pre{margin:0;flex:1;overflow:auto;color:#9aa3b5;font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
#bootstrap-splash .log-actions{display:flex;justify-content:flex-end;margin-top:10px}
#bootstrap-splash .copy-btn{padding:4px 10px;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:transparent;color:#c4c9d4;font:inherit;font-size:11px;cursor:pointer;transition:background .15s}
#bootstrap-splash .copy-btn:hover{background:rgba(255,255,255,.06)}
#bootstrap-splash .copy-btn:focus-visible{outline:2px solid #5e6ad2;outline-offset:2px}
#bootstrap-splash .line{min-height:28.5px;margin-bottom:10px;white-space:pre}
#bootstrap-splash .keyword{color:#b39ddb}
#bootstrap-splash .func{color:#81c7e8}
#bootstrap-splash .str{color:#ffd180}
#bootstrap-splash .comment{color:#5c6370}
#bootstrap-splash .var{color:#ffab91}
#bootstrap-splash .cursor{display:inline-block;width:2px;height:1.3em;margin:0 2px;border-radius:1px;background:#fff;vertical-align:text-bottom;animation:bootstrapCaret 1s step-end infinite}
#bootstrap-splash .progress-wrap{padding:0 32px 28px}
#bootstrap-splash .progress-bar{width:100%;height:5px;overflow:hidden;border-radius:6px;background:#23262b}
#bootstrap-splash .progress-bar.error-bar{background:#2b1d21}
#bootstrap-splash .progress{height:100%;border-radius:6px;background:#5e6ad2;transform-origin:left center;transform:scaleX(var(--bootstrap-progress-scale,.08));transition:transform 220ms cubic-bezier(0.22,1,0.36,1);will-change:transform}
#bootstrap-splash .progress.error-progress{width:100%;background:linear-gradient(90deg,#ff7b88,#ff8e6b)}
#bootstrap-splash .status{display:flex;align-items:center;justify-content:center;gap:8px;padding-bottom:20px;color:#6e7681;font-size:12px}
#bootstrap-splash .status.error-status{color:#c2c9d6}
#bootstrap-splash .spinner{width:13px;height:13px;border:2px solid rgba(94,106,210,.24);border-top-color:#5e6ad2;border-radius:999px;animation:bootstrapSpin 1s linear infinite}
#bootstrap-splash .error-indicator{display:inline-flex;width:15px;height:15px;align-items:center;justify-content:center;border-radius:999px;background:rgba(255,107,122,.18);color:#ff9aa5;font-size:11px;font-weight:700}
@keyframes bootstrapCaret{50%{opacity:0}}
@keyframes bootstrapSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){
  #bootstrap-splash .cursor{animation:none}
  #bootstrap-splash .spinner{animation:none;border-top-color:rgba(94,106,210,.6)}
}
`.trim();

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

const enableSplashWindowMode = (): void => {
  document.documentElement.classList.add('splash-window-mode');
  document.body?.classList.add('splash-window-mode');
};

const resolveBootstrapSplashHost = (): HTMLDivElement | null =>
  document.querySelector<HTMLDivElement>(`#${BOOTSTRAP_SPLASH_HOST_ID}`);

const ensureBootstrapSplashStyle = (): void => {
  if (document.getElementById(BOOTSTRAP_SPLASH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BOOTSTRAP_SPLASH_STYLE_ID;
  style.textContent = SPLASH_STYLE;
  document.head.appendChild(style);
};

const ensureBootstrapSplashState = (): BootstrapSplashState => {
  const current = window.__SH_SPLASH_BOOTSTRAP_STATE__;
  if (current) {
    if (!current.startedAt) current.startedAt = performance.now();
    current.visibleCharacters = Number.isFinite(current.visibleCharacters)
      ? Math.max(0, Number(current.visibleCharacters))
      : 0;
    current.progress = Math.max(
      BOOTSTRAP_SPLASH_INITIAL_PROGRESS,
      Math.min(100, Number(current.progress ?? BOOTSTRAP_SPLASH_INITIAL_PROGRESS)),
    );
    return current;
  }
  const next: BootstrapSplashState = {
    startedAt: performance.now(),
    visibleCharacters: 0,
    progress: BOOTSTRAP_SPLASH_INITIAL_PROGRESS,
  };
  window.__SH_SPLASH_BOOTSTRAP_STATE__ = next;
  return next;
};

let startupWindowShown = false;
const showStartupWindow = (): void => {
  if (startupWindowShown) return;
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') return;
  startupWindowShown = true;
  invoke('show_startup_window').catch(() => {
    // 浏览器预览模式没有 Tauri 命令，忽略即可。
  });
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
};

const truncateDetail = (detail: string): string =>
  detail.length > BOOTSTRAP_ERROR_DETAIL_MAX_LENGTH
    ? `${detail.slice(0, BOOTSTRAP_ERROR_DETAIL_MAX_LENGTH)}\n... (truncated)`
    : detail;

const resolveErrorParts = (error: unknown): { message: string; detail: string } => {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown error',
      detail: truncateDetail(error.stack ?? error.message ?? String(error)),
    };
  }
  const text = typeof error === 'string' ? error : safeStringify(error);
  return { message: text, detail: truncateDetail(text) };
};

const ensureSplashHost = (): HTMLDivElement => {
  let host = resolveBootstrapSplashHost();
  if (!host) {
    host = document.createElement('div');
    host.id = BOOTSTRAP_SPLASH_HOST_ID;
    document.body.appendChild(host);
  }
  return host;
};

// ---------------------------------------------------------------------------
// DOM 构造：loading / error
// ---------------------------------------------------------------------------

const createTopBar = (): HTMLElement => {
  const top = document.createElement('div');
  top.className = 'top';
  top.innerHTML =
    '<span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>' +
    '<div class="title">&lt;/&gt; system-loader.js</div>';
  return top;
};

const buildLoadingSection = (): HTMLElement => {
  const section = document.createElement('section');
  section.id = 'bootstrap-splash';

  const editor = document.createElement('div');
  editor.className = 'editor';
  editor.setAttribute('role', 'status');
  editor.setAttribute('aria-live', 'polite');

  editor.appendChild(createTopBar());

  const code = document.createElement('div');
  code.className = 'code';
  code.innerHTML = `
    <div class="line"><span class="keyword">import</span> { System } <span class="keyword">from</span> <span class="str">'@core/system'</span>;<span class="cursor"></span></div>
    <div class="line"><span class="keyword">const</span> <span class="var">engine</span> = <span class="keyword">new</span> <span class="func">CoreEngine</span>();</div>
    <div class="line"><span class="comment">// Initializing core modules and rendering</span></div>
    <div class="line"><span class="keyword">await</span> <span class="var">engine</span>.<span class="func">startup</span>();</div>
  `;
  editor.appendChild(code);

  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-wrap';
  progressWrap.style.setProperty(
    '--bootstrap-progress-scale',
    String(BOOTSTRAP_SPLASH_INITIAL_PROGRESS / 100),
  );
  progressWrap.innerHTML = `
    <div class="progress-bar" role="progressbar"
         aria-valuenow="${BOOTSTRAP_SPLASH_INITIAL_PROGRESS}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress"></div>
    </div>
  `;
  editor.appendChild(progressWrap);

  const status = document.createElement('div');
  status.className = 'status';
  status.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
  const statusText = document.createElement('span');
  statusText.textContent = MESSAGES.loadingStatus;
  status.appendChild(statusText);
  editor.appendChild(status);

  section.appendChild(editor);
  return section;
};

const buildErrorSection = (error: unknown): HTMLElement => {
  const { message, detail } = resolveErrorParts(error);

  const section = document.createElement('section');
  section.id = 'bootstrap-splash';

  const editor = document.createElement('div');
  editor.className = 'editor error';
  editor.setAttribute('role', 'alert');
  editor.setAttribute('aria-live', 'assertive');

  editor.appendChild(createTopBar());

  const log = document.createElement('div');
  log.className = 'log';

  const errLine = document.createElement('div');
  errLine.className = 'log-line log-line-error';
  errLine.textContent = MESSAGES.errorTitle;
  log.appendChild(errLine);

  const msgLine = document.createElement('div');
  msgLine.className = 'log-line';
  msgLine.textContent = MESSAGES.errorMessagePrefix + message;
  log.appendChild(msgLine);

  const divider = document.createElement('div');
  divider.className = 'log-divider';
  log.appendChild(divider);

  const pre = document.createElement('pre');
  pre.className = 'log-pre';
  pre.textContent = detail;
  log.appendChild(pre);

  const actions = document.createElement('div');
  actions.className = 'log-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = MESSAGES.copyButton;
  copyBtn.addEventListener('click', () => {
    const payload = `${message}\n\n${detail}`;
    const done = () => {
      copyBtn.textContent = MESSAGES.copyButtonDone;
      window.setTimeout(() => (copyBtn.textContent = MESSAGES.copyButton), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(payload).then(done).catch(done);
    } else {
      done();
    }
  });
  actions.appendChild(copyBtn);
  log.appendChild(actions);

  editor.appendChild(log);

  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-wrap';
  progressWrap.innerHTML = `
    <div class="progress-bar error-bar" role="progressbar"
         aria-valuenow="100" aria-valuemin="0" aria-valuemax="100">
      <div class="progress error-progress"></div>
    </div>
  `;
  editor.appendChild(progressWrap);

  const status = document.createElement('div');
  status.className = 'status error-status';
  const indicator = document.createElement('span');
  indicator.className = 'error-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.textContent = '!';
  const statusText = document.createElement('span');
  statusText.textContent = MESSAGES.errorStatus;
  status.appendChild(indicator);
  status.appendChild(statusText);
  editor.appendChild(status);

  section.appendChild(editor);
  return section;
};

// ---------------------------------------------------------------------------
// 渲染入口
// ---------------------------------------------------------------------------

const renderBootstrapLoading = (): void => {
  enableSplashWindowMode();
  showStartupWindow();
  ensureBootstrapSplashState();
  if (!document.body) return;
  if (resolveBootstrapSplashHost()) return;
  ensureBootstrapSplashStyle();
  const host = ensureSplashHost();
  host.replaceChildren(buildLoadingSection());
};

const renderFatalBootstrapError = (error: unknown): void => {
  enableSplashWindowMode();
  showStartupWindow();
  ensureBootstrapSplashState();
  if (!document.body) return;
  ensureBootstrapSplashStyle();
  const host = ensureSplashHost();
  host.replaceChildren(buildErrorSection(error));
};

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const bootstrap = async (): Promise<void> => {
  try {
    renderBootstrapLoading();

    // 先把样式加载好，避免 App 挂载瞬间出现 FOUC。
    await import('./styles.css');

    const [{ createApp }, { createPinia }, { default: App }] = await Promise.all([
      import('vue'),
      import('pinia'),
      import('./App.vue'),
    ]);

    const app = createApp(App);
    app.use(createPinia());

    // TODO: 全局注册 Shadcn Vue 组件，如有需要可在此处添加

    app.config.errorHandler = (error) => {
      setRuntimeError(MESSAGES.vueErrorLabel, error);
    };

    app.mount('#app');
    initAppTooltipSystem();

    const state = ensureBootstrapSplashState();
    state.handoff = true;
  } catch (error) {
    console.error(MESSAGES.bootstrapErrorLabel, error);
    setRuntimeError(MESSAGES.bootstrapErrorLabel, error);
    renderFatalBootstrapError(error);
  }
};

void bootstrap();