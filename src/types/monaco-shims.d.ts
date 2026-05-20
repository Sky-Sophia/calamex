/**
 * monaco-editor 的内部 ESM 子路径不发布 .d.ts(只发布 .js),
 * 这里集中声明以消掉 ts(7016)。
 *
 * 设计取舍:
 * 1. 仅声明"存在",不声明"内部形状"——所有从中具名 import 的符号(如 Range、
 *    Selection、EditorOption 等)在本地视角是 any,但 src/utils/monaco.ts 末尾会
 *    把它们打包进 monaco facade 并 `as unknown as typeof MonacoApi`,统一收口
 *    回完整公共类型。也就是说:any 仅泄漏在 monaco.ts 文件内部,不外溢。
 * 2. 路径全部使用精确字面量(不使用 'monaco-editor/esm/*' 通配),拼错时 TS 仍能
 *    报"找不到模块",防止笔误偷渡进运行时。
 * 3. 'monaco-editor' 顶层包不在这里 shim——它有原生 .d.ts(types 字段指向
 *    editor.api.d.ts),被 shim 反而会把整个公共 API 降级成 any。
 *
 * ⚠️ 升级 monaco-editor 大版本时务必同步检查:
 *    1. 下列子路径在新版本中是否仍然存在(否则运行时 import 会 404,但 TS 不报错);
 *    2. 顶层 'monaco-editor' 的 types 入口是否仍可用(决定 src/utils/monaco.ts
 *       里 MonacoApi.editor.* 的类型是否继续有效);
 *    3. 跑一次集成测试或手动打开编辑器页面,确保模块图能正常加载。
 *
 * 备选方案:把 tsconfig.json 的 "moduleResolution" 切到 "bundler"(TS ≥5)能让
 * 部分子路径走 monaco-editor 自身 exports map 解析,届时本文件可以裁短;
 * 但 ?worker 后缀仍然要靠下方的 worker 声明或 "vite/client" 类型。
 */

// ── 副作用导入(无具名符号,any 不会外泄)───────────────────────────────────
declare module 'monaco-editor/esm/nls.messages.zh-cn.js';
declare module 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard';
declare module 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment';
declare module 'monaco-editor/esm/vs/editor/contrib/find/browser/findController';
declare module 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestMemory.js';
declare module 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess';
declare module 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess';

// ── 具名导入(本地视角是 any,由 monaco.ts 的 facade cast 收口)───────────────
declare module 'monaco-editor/esm/vs/basic-languages/shell/shell.js';
declare module 'monaco-editor/esm/vs/basic-languages/python/python.js';
declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';
declare module 'monaco-editor/esm/vs/basic-languages/ruby/ruby.js';
declare module 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js';
declare module 'monaco-editor/esm/vs/basic-languages/java/java.js';
declare module 'monaco-editor/esm/vs/basic-languages/rust/rust.js';
declare module 'monaco-editor/esm/vs/basic-languages/go/go.js';
declare module 'monaco-editor/esm/vs/basic-languages/css/css.js';
declare module 'monaco-editor/esm/vs/basic-languages/less/less.js';
declare module 'monaco-editor/esm/vs/basic-languages/scss/scss.js';
declare module 'monaco-editor/esm/vs/basic-languages/html/html.js';
declare module 'monaco-editor/esm/vs/basic-languages/xml/xml.js';
declare module 'monaco-editor/esm/vs/basic-languages/yaml/yaml.js';
declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js';
declare module 'monaco-editor/esm/vs/basic-languages/sql/sql.js';
declare module 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.js';
declare module 'monaco-editor/esm/vs/basic-languages/powershell/powershell.js';
declare module 'monaco-editor/esm/vs/basic-languages/ini/ini.js';
declare module 'monaco-editor/esm/vs/editor/common/core/range.js';
declare module 'monaco-editor/esm/vs/editor/common/core/selection.js';
declare module 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js';
declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneEditor.js';
declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneLanguages.js';
declare module 'monaco-editor/esm/vs/editor/editor.api.js' {
    export * from 'monaco-editor';
}

// ── Vite ?worker 后缀:返回一个 Worker 构造器 ───────────────────────────────
// 如果你的 tsconfig.json 已经在 compilerOptions.types 里 reference 了
// "vite/client",这一段可以删掉(vite/client 自带通配 ?worker 声明)。
declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
    export default class EditorWorker extends Worker {
        constructor();
    }
}
