项目编码与架构规范（含TypeScript、Vite规范）
文件编码：UTF-8 无 BOM；换行：LF；缩进：2 空格；引号：单引号。
本文件是团队"单一事实来源（SSoT）"。任何偏离条款必须在 PR 描述中写明理由，并获得 Code Owner 明确批准后方可合入。
面向中文协作环境，术语以中文为主、英文为辅，避免口语化表述。
第 0 章　版本锁定（Source of Truth）
0.1 约束目的
统一全员依赖版本，杜绝"本地能跑、CI 不过"以及隐式升级带来的破坏性变更，确保类型定义、构建行为、Lint 规则在所有开发机、CI、发布机上完全一致。
0.2 版本基线
桌面框架：Tauri 2.x，主版本锁定，次要与补丁版本跟随官方稳定线。
前端框架：Vue 3.5.x，全量使用 Composition API 与 <script setup>。
语言：TypeScript 6.0.2（项目内部对齐版本）。
构建工具：Vite 8.0.8（项目内部对齐版本）。
UI 样式：Tailwind CSS 4.2.2，采用 CSS-first 配置方式。
组件库：Shadcn Vue，底层基座为 reka-ui，随 CLI 最新稳定版本生成。
状态管理：Pinia 2.2 及以上，统一配合 pinia-plugin-persistedstate。
路由：Vue Router 4.4 及以上。严禁使用与 Vue 3 不匹配的 3.x 或不存在的 5.x。
代码规范：ESLint 10.2.0、@eslint/js 10.0.1、eslint-plugin-vue 10.8.0、vue-eslint-parser 10.4.0、typescript-eslint 8 及以上。
类型体系：vue-tsc 3.2.6、@types/node 25.6.0、@vue/tsconfig 0.9.1。
工具库：monaco-editor 0.55.1。
全局变量：globals 17.5.0。
包管理器：pnpm 9 及以上，在 package.json 的 packageManager 字段硬锁。
运行时：Node 20 LTS 及以上，通过 engines.node 字段约束。
0.3 升级策略
任何依赖的主版本升级必须走 RFC 流程：提交变更说明、影响面评估、回滚方案。
次要与补丁版本升级由 Renovate 或 Dependabot 自动提 PR，必须人工审查变更日志后合入。
升级后必须本地全量跑 typecheck、lint、test、build 四件套，任一失败禁止合入。
禁止使用 latest、next、beta 等浮动版本号；必须使用精确版本或 ^x.y 受控范围。
0.4 锁定文件
必须提交 pnpm-lock.yaml，严禁 .npmrc 或 CI 中出现 --no-frozen-lockfile。
CI 安装依赖必须使用 pnpm install --frozen-lockfile。
禁止手工编辑 lock 文件；如需修复必须通过 pnpm install 重新生成。
第 1 章　架构设计原则
1.1 分层架构
项目采用三层架构，依赖方向严格单向、自上而下，禁止任何形式的回环或跨层穿透。
UI 层（Vue 单文件组件 + Shadcn Vue）
仅负责渲染、交互事件分发、视图状态展示。
禁止写业务逻辑、禁止直接发起网络请求、禁止直接调用 Tauri IPC。
UI 样式必须引用全局主题变量，禁止在组件内声明主题相关 CSS 变量。
业务逻辑层（TypeScript + composables + store + services）
负责业务规则、数据转换、校验、接口与 IPC 封装。
主题切换、系统主题监听、持久化等副作用必须集中在 composables 与 store，禁止散落于组件。
本层是 UI 与系统层之间的唯一桥梁。
系统层（Tauri Rust）
负责文件系统、系统调用、权限控制、敏感凭证存储。
对外仅暴露最小命令集；所有命令的入参与出参必须类型化，并在前端侧做运行时校验。
1.2 依赖方向约束
UI 层可依赖业务层；禁止业务层反向依赖 UI 组件。
业务层可调用系统层（通过 services 封装）；禁止系统层调用业务层。
同层之间禁止任意互相依赖，必须经由明确的桥接层（composable、store、service）中转。
禁止组件直接 import 其他模块 store 的内部 ref 或内部方法，统一通过 store 暴露的公开 API。
1.3 模块化原则
模块必须满足单一职责，一个模块解决一类问题。
模块对外只暴露稳定契约（类型 + 函数签名），内部实现可自由演进。
跨模块协作只允许以下三种方式：
composables：共享带响应式状态的逻辑；
store：共享全局状态；
services：共享 I/O（HTTP、IPC、本地存储代理）。
禁止"工具函数即模块"的反模式：不能把一堆无关函数塞进 utils 当模块用。
1.4 推荐目录结构（强约束）
src/assets/css/：全局样式与主题，内含 shadcn-theme.css（主题唯一入口）与 tailwind.css（Tailwind 入口）。
src/components/ui/：Shadcn 基础组件存放目录，由 CLI 生成，禁止修改内部主题样式。
src/components/business/：基于 ui 二次封装的业务组件。
src/views/：路由级页面。
src/layouts/：布局组件。
src/composables/：逻辑复用层，主题相关逻辑集中于 useTheme.ts。
src/services/：HTTP、IPC、通知等 I/O 统一封装。
src/store/：Pinia store，按业务域拆分。
src/router/：路由配置，必须启用懒加载。
src/types/：类型集中管理，主题类型定义位于 shadcn-theme.ts，IPC 类型由工具自动生成。
src/constants/：常量定义，命名 UPPER_SNAKE_CASE。
src/hooks/：与框架无关的副作用封装。
src/utils/：纯函数工具，禁止产生副作用。
1.5 架构红线
禁止在 UI 层写任何业务判断（如权限判断、流程分支、数据计算）。
禁止跳过业务层直接从组件调用 Tauri invoke 或 fetch。
禁止把全局状态挂到 window、globalThis 或模块顶层可变变量上。
禁止循环依赖；CI 必须启用 dpdm 或等效工具做循环依赖检测。
禁止目录结构随意发散；新增顶层目录必须在本文件中同步登记。
第 2 章　Vue 3 规范
2.1 组件规范
语法与格式
所有单文件组件必须使用 <script setup lang="ts">；禁止 Options API，禁止无 lang="ts" 的 script 块。
单文件组件结构顺序统一为：<script setup> → <template> → <style>，便于代码审查与工具处理。
每个 .vue 文件只承载一个组件；拆分子组件时以职责为界，不以行数为界，但单文件超过 300 行需评估拆分。
命名规范
组件文件名使用 PascalCase，如 UserCard.vue、ThemeSwitcher.vue。
组件注册名与文件名一致；模板中使用时保持 PascalCase 或 kebab-case 二选一，全局统一 PascalCase。
禁止使用 Index.vue 作为业务组件文件名；目录入口组件必须使用有语义的名字。
Props 与 Emits
defineProps 与 defineEmits 必须使用类型化的泛型方式声明，禁止运行时数组或对象声明。
Props 的类型必须集中定义在 types/ 或组件同目录的 types.ts 中，禁止匿名内联大型类型。
Props 必须标注可选性与默认值；默认值通过 withDefaults 声明。
Emits 事件名使用 kebab-case，事件 payload 必须类型化，不允许 any。
模板规范
模板中禁止写复杂逻辑：禁止多层三元、禁止超过两个条件的行内表达式、禁止在模板中做数据转换。
复杂表达式必须提取到 computed 或 composable。
v-for 必须提供稳定 key，禁止使用数组索引作为 key（除非列表完全不可变）。
v-if 与 v-for 禁止写在同一元素上；必要时使用外层 <template> 包裹。
所有交互元素必须具备可访问性属性（aria-*、role、键盘事件），Shadcn 组件自带的行为不得被覆盖。
样式规范
组件内 <style> 必须使用 scoped 或 CSS Modules，严禁无作用域全局样式。
禁止在组件内声明任何 Shadcn 主题相关 CSS 变量（如 --primary、--radius 等）。
禁止使用 !important；如确需覆盖，必须修改全局主题配置。
优先使用 Tailwind utility class；仅在无法用 utility 表达的场景下使用 <style scoped>。
UI 与逻辑分离
组件不得包含超过 20 行的纯逻辑块；超过必须抽离到 composable。
组件不得直接发起网络请求、IPC 调用或读写持久化存储，必须经由 services 或 store。
组件不得直接操作 DOM；确需操作时必须通过 ref 并封装成 composable。
2.2 composables 规范
定位
composables 是业务逻辑层的核心载体，负责把带响应式状态的逻辑从组件中剥离，供多处复用。
面向副作用与有状态逻辑；无状态的纯函数应归入 utils/。
命名
文件与函数均以 use 开头，采用 camelCase，如 useTheme.ts、useUserForm.ts。
一个文件对外只导出一个主 composable；辅助函数保持私有或独立文件。
结构约束
composable 的返回值必须是对象，字段命名语义化；禁止返回数组让调用方按位置解构。
返回的响应式状态必须明确只读或可写语义：对外暴露只读数据使用 readonly 或 computed 封装。
内部注册的副作用（事件监听、定时器、媒体查询等）必须在 onScopeDispose 中清理，防止内存泄漏。
禁止 composable 直接读写 localStorage / sessionStorage；持久化交由 store 配合持久化插件完成。
禁止在 composable 内部隐式共享模块级可变状态；如确需共享，必须以 store 形式显式存在。
复用与边界
组件内禁止重复实现同一类逻辑；重复出现两次以上必须抽离为 composable。
composable 不得依赖具体业务组件；只允许依赖类型、其他 composable、store、service。
主题切换、系统主题监听、权限判断、表单校验等横切逻辑，必须以 composable 统一提供，禁止各页面自行实现。
错误处理
composable 不得向外抛出未处理异常；必须以返回值（如 { error, data, status }）或统一错误对象的形式对外暴露。
与 services 交互时，错误归一化交由 services 层完成，composable 只消费已归一化的错误。
2.3 生命周期与响应式
优先使用 ref / computed / watchEffect；仅在确有必要时使用 reactive，避免深层响应开销。
禁止在模板中直接使用会产生副作用的表达式。
watch 必须显式声明依赖数组或目标，禁止依赖"魔法自动追踪"写出难以维护的代码。
对大规模只读数据使用 shallowRef 或 markRaw，避免不必要的响应式代价。
组件卸载时产生的副作用必须通过 onBeforeUnmount / onScopeDispose 主动释放。
2.4 组件测试约束
每个业务组件必须配套 Vitest + @vue/test-utils 单测，覆盖核心交互路径。
组件测试禁止依赖真实网络或真实 IPC；必须通过 services 层的 mock 接口注入。
视觉回归（如需要）统一使用 Playwright 的截图对比方案，不在组件测试中混用。
2.5 Vue 层红线
禁止 Options API、禁止 mixin、禁止 Vue 2 风格的全局事件总线。
禁止在组件中直接 import Pinia store 的内部模块路径；只允许通过 useXxxStore() 暴露的公共 API。
禁止在组件中硬编码主题色值、圆角、阴影、间距等设计令牌。
禁止使用 provide / inject 替代 store 做跨层状态共享，除非是纯组件树内部的配置注入。
禁止在 <script setup> 顶层写异步 await 而不配合 Suspense，造成渲染不确定性。
第 3 章　TypeScript 规范
3.1 严格模式配置
- tsconfig.json 必须启用以下选项，缺一不可：
    - strict：开启全套严格检查。
    - noImplicitAny：禁止隐式 any。
    - strictNullChecks：强制空值检查。
    - noUncheckedIndexedAccess：索引访问结果必须视为可能 undefined。
    - noImplicitOverride：覆写父类方法必须显式 override。
    - exactOptionalPropertyTypes：可选属性的 undefined 语义必须精确。
    - verbatimModuleSyntax：导入语义与输出保持一致，类型导入必须使用 import type。
    - noFallthroughCasesInSwitch：禁止 switch 语句穿透。
    - noUnusedLocals 与 noUnusedParameters：禁止未使用声明。
- 项目 tsconfig 必须继承 @vue/tsconfig；业务工程分别提供 tsconfig.app.json、tsconfig.node.json，入口 tsconfig.json 仅做 references。
- 类型检查统一使用 vue-tsc --noEmit，禁止以 tsc 单独跑 Vue 项目。
3.2 any 与 unknown
- 禁止 any。在极端场景（与第三方无类型库对接、历史遗留代码渐进迁移）确需使用时，必须同时满足：
    - 在该行前追加注释说明原因与后续清理计划；
    - 使用 // eslint-disable-next-line @typescript-eslint/no-explicit-any 显式关闭规则；
    - 在 docs/tech-debt.md 登记，设定清理截止日期。
- 对来源不可信的数据（如后端响应、IPC 返回值、JSON.parse 结果），必须以 unknown 接收，并通过运行时校验（Zod 或等效方案）收窄后再使用。
- 禁止使用 as any、as unknown as T 的双重断言绕过类型系统；必要的类型收窄必须通过类型守卫（is 谓词）实现。
3.3 类型定义位置
- 跨模块共享的类型集中于 src/types/，按领域拆分文件：api.ts、ipc.ts、shadcn-theme.ts、user.ts 等。
- 仅单个模块内部使用的类型可与实现文件同目录，文件名以 types.ts 或 xxx.types.ts 命名。
- 环境变量类型统一声明在 src/types/env.d.ts 中，扩展 ImportMetaEnv 与 ImportMeta 接口。
- IPC 类型由 tauri-specta 或等效工具自动生成，生成文件路径固定为 src/types/ipc.generated.ts，禁止手工修改。
3.4 命名规范
- 接口使用前缀 I：IUser、ILoginParams、IShadcnTheme。
- 类型别名使用前缀 T：TResponse、TOption、TThemeMode。
- 枚举使用前缀 E：EUserRole、EStatus、EAppErrorCode。
- 泛型参数统一使用单字母并区分语义：T（通用）、K（键）、V（值）、R（返回）、P（参数）。
- 布尔类型变量命名以 is、has、should、can 开头，禁止使用双重否定命名。
3.5 枚举与联合字面量
- 优先使用 as const 对象加联合字面量类型，避免 TypeScript enum 在运行时产生额外代码。
- 必须保持运行时行为时（如后端约定的数字枚举），允许使用 const enum，但必须在 tsconfig 中启用 preserveConstEnums 并在文档中登记。
- 禁止混用数字枚举与字符串枚举；同一枚举内部值的类型必须一致。
3.6 公共契约类型化
- 所有 API 响应、Props、Emits、Store State、Service 参数、IPC 命令入出参必须显式类型化，禁止依赖类型推断作为对外契约。
- 函数导出签名必须显式声明返回值类型，便于审查与防止意外变更。
- 内部局部函数可依赖类型推断，但返回值跨越模块边界时必须显式标注。
3.7 主题相关类型约束
- Shadcn Vue 主题变量必须提供 TypeScript 类型定义，路径固定为 src/types/shadcn-theme.ts。
- 类型字段必须与 shadcn-theme.css 中的 CSS 变量一一对应；新增或删除变量必须同步修改类型定义，否则 CI 必须失败。
- 主题模式类型固定为 TThemeMode = 'light' | 'dark' | 'system'；禁止业务代码自行扩展字面量。
- 主题方法签名接口 IThemeMethods 必须统一，禁止不同页面各自定义相似但不一致的 API。
3.8 类型守卫与运行时校验
- 对外部输入（网络、IPC、文件、URL 参数）必须使用 Zod 或等效库定义 schema，并以 schema.parse / safeParse 做运行时校验。
- Zod schema 与 TypeScript 类型必须通过 z.infer 保持单源；禁止手工维护两份定义。
- 自定义类型守卫函数必须以 isXxx 命名，返回类型为 value is T，禁止返回普通 boolean。
3.9 空值与可选
- 可选字段使用 ?:，默认值在消费侧统一处理；禁止将 null、undefined、空字符串混用表达"无值"。
- 表达"无值"的统一约定：
    - DTO 与 API 层使用 null；
    - 组件 Props 与内部状态使用 undefined；
    - 持久化层按领域语义决定，需在类型注释中写明。
- 禁止使用非空断言 !；确需使用必须配合类型守卫或先行校验，且在 PR 中说明。
3.10 工具类型与复杂类型
- 优先使用内置工具类型：Partial、Required、Readonly、Pick、Omit、Record、ReturnType、Parameters、Awaited。
- 自定义工具类型统一放在 src/types/utility.ts，必须配套 JSDoc 注释说明用途与示例。
- 深层类型（递归、条件、模板字面量）必须伴随注释说明意图；禁止写无法被他人理解的"类型炫技"。
- 类型文件内禁止出现运行时代码（函数实现、常量导出除外）。
3.11 类型红线
- 禁止 any、禁止 @ts-ignore（必要时使用 @ts-expect-error 并附注释）。
- 禁止 Function 作为类型；使用具体函数签名。
- 禁止 Object 或 {} 作为类型；使用 Record<string, unknown> 或具体接口。
- 禁止在业务代码中使用 namespace；模块化组织一律使用 ES Module。
- 禁止修改第三方库的类型定义文件；如需扩展，必须通过模块声明合并（declare module）在 types/ 下显式声明。
第 4 章　Vite 规范
4.1 配置文件
- 构建配置唯一入口为 vite.config.ts，禁止新增其他名称的构建配置文件。
- 配置文件必须使用 TypeScript 类型化，导出 defineConfig 返回值，禁止导出裸对象。
- 环境相关逻辑通过 defineConfig(({ mode, command }) => ...) 函数形态实现；禁止在配置中直接读 process.env 以外的值。
- 复杂配置必须按职责拆分到 vite/ 目录（如 vite/plugins.ts、vite/alias.ts），由主配置聚合，避免单文件臃肿。
4.2 路径别名
- 必须配置 @ 指向 src，并在 tsconfig.json 的 paths 中保持一致，确保编辑器与构建器解析一致。
- 别名只允许以下约定，禁止随意扩展：
    - @ 指向 src；
    - @types 指向 src/types（可选）；
    - @assets 指向 src/assets（可选）。
- 禁止使用相对路径穿越两层以上（如 ../../../）；超过两层相对路径必须改用别名。
4.3 环境变量
- 环境变量文件分为 .env、.env.development、.env.production、.env.local，.env.local 必须加入 .gitignore。
- 暴露到客户端的变量必须以 VITE_ 开头，其余变量仅供构建脚本或 Node 侧使用。
- 所有 VITE_ 变量必须在 src/types/env.d.ts 中登记类型，未登记的变量禁止使用。
- 变量使用方式：
    - 禁止直接读取 .env 文件内容；
    - 禁止在运行时拼接变量名动态访问；
    - 统一通过 import.meta.env.VITE_XXX 访问。
- 敏感信息（密钥、令牌、内部地址）严禁写入任何 VITE_ 变量，严禁进入前端产物。
4.4 插件规范
- 必装插件清单：
    - @vitejs/plugin-vue：Vue 3 单文件组件支持。
    - unplugin-auto-import：自动导入 Vue API、Pinia、composables。
    - unplugin-vue-components：Shadcn Vue 组件按需自动注册。
    - vite-plugin-vue-devtools：仅开发环境启用。
- 可选插件需在技术评审后加入，禁止随意扩展插件链路。
- 自动导入插件必须同时生成类型声明文件（auto-imports.d.ts、components.d.ts），并纳入版本控制，方便类型检查与 Code Review。
- 插件顺序不得随意调整；涉及顺序敏感的插件（如 Vue、Inspect）必须配套注释说明原因。
4.5 构建规范
- build.target 统一设置为 es2022，与 TypeScript 编译目标对齐。
- build.sourcemap：
    - 开发环境：true；
    - 预发环境：'hidden'，产物不暴露但保留供错误追踪；
    - 生产环境：依据是否集成 Sentry 决定，未集成则 false。
- build.cssCodeSplit 默认启用；禁止为"偷懒"而关闭。
- build.chunkSizeWarningLimit 默认保留；出现警告必须分析并拆包，禁止以放宽阈值的方式消除告警。
- 必须启用依赖预优化（optimizeDeps）；对大体积依赖（如 monaco-editor）显式配置 include / exclude。
- 构建产物路径统一为 dist，Tauri 读取该目录；禁止修改输出目录名。
4.6 开发服务器
- 端口、代理等必须通过环境变量控制，禁止硬编码。
- 开发服务器必须启用 HMR；与 Tauri 联调时通过 tauri.conf.json 的 build.devUrl 指向 Vite dev server，禁止以文件加载方式调试。
- 跨域代理统一在 server.proxy 配置，禁止在业务代码中绕过代理发请求。
4.7 资源处理
- 图片优先使用 WebP 或 AVIF；SVG 必须走组件化（通过 unplugin-icons 或显式导入），禁止在模板中嵌入大段 SVG 源码。
- 静态资源统一放置于 src/assets/ 下按类型分目录（css、images、fonts、icons）。
- public/ 目录仅存放需要保持原路径、原文件名的资源（如 favicon、manifest），禁止把业务图片放入 public/。
- 禁止通过硬编码路径引用 public/ 资源，必须使用 import.meta.env.BASE_URL 拼接或通过 new URL(..., import.meta.url) 解析。
4.8 代码分割
- 路由级页面必须通过动态 import() 实现懒加载。
- 首屏以外的重组件（monaco-editor、图表库、富文本）必须以动态 import() 延迟加载，并配合 Suspense 或加载态处理。
- 手动分包通过 build.rollupOptions.output.manualChunks 配置，分包策略按领域划分，禁止按字母或随机分包。
- 公共依赖（Vue、Vue Router、Pinia）必须合并为单一 vendor-core chunk，避免重复加载。
4.9 构建性能
- 必须启用依赖预构建与构建缓存，CI 中的缓存路径必须持久化。
- 禁止在 vite.config.ts 中执行同步 I/O 密集操作（读取大文件、遍历目录）；必要时改用 Vite 插件钩子异步完成。
- 引入新依赖时必须评估其对首屏体积的影响，超过 50KB（gzip）的依赖必须走动态加载。
4.10 Vite 红线
- 禁止硬编码 API 地址、端口、密钥、系统路径。
- 禁止直接读取 .env 文件；禁止绕过 import.meta.env。
- 禁止在客户端暴露非 VITE_ 前缀变量。
- 禁止随意添加插件或更改插件顺序；任何变更必须经 Code Review。
- 禁止关闭 cssCodeSplit、禁止无理由提高 chunkSizeWarningLimit。
- 禁止产物目录外写入文件；禁止在构建阶段产生不可复现的输出（带时间戳的文件名、随机 hash 以外的额外随机内容）。
继续输出**第 5 章 Tailwind CSS 4 规范**与**第 6 章 Shadcn Vue 规范（含全局主题配置核心章节）**。

---

## 第 5 章　Tailwind CSS 4.2.2 规范

### 5.1 配置方式（CSS-first）

- Tailwind 4 采用 **CSS-first** 配置，主配置写在 CSS 中，通过 `@theme` 声明设计令牌。
- 禁止继续沿用 Tailwind 3 风格的 `tailwind.config.ts` 作为主配置；如因历史原因保留，仅限用于极少数无法在 CSS 中声明的字段，且必须在 PR 中说明原因。
- 入口 CSS 文件固定为 `src/assets/css/tailwind.css`，该文件只做三件事：
    - 引入 Tailwind 主入口；
    - 引入全局主题配置文件 `shadcn-theme.css`；
    - 声明项目级通用基础样式（极少数情况下）。
- 全局设计令牌（颜色、圆角、阴影、间距、字号、字族）统一在 `shadcn-theme.css` 的 `@theme` 块中声明，与 Shadcn Vue 主题变量保持单源。

### 5.2 使用原则

- 严格遵循 utility-first 原则：优先用 Tailwind 原子类表达样式。
- 仅在以下情况下允许写自定义 CSS：
    - utility 无法表达的复杂选择器（如 `:has()`、`::marker`）；
    - 可复用的语义化组件样式块（需置于 `@layer components`）；
    - 与第三方库交互的必要覆盖（必须附注释说明）。
- 自定义样式必须按 `@layer` 分层组织：
    - `@layer base`：仅用于声明主题变量与全局排版基线，禁止写业务样式；
    - `@layer components`：语义化组件样式；
    - `@layer utilities`：项目扩展的 utility 类。
- 禁止在 `<style>` 块中裸写不分层的全局样式。

### 5.3 `@apply` 与语义类

- `@apply` 仅允许用于 `@layer components` 中的语义化类，用于封装可复用的组件样式。
- 禁止在业务 SFC 的 `<style scoped>` 中滥用 `@apply` 替代模板中的 utility 组合。
- 语义类命名使用 kebab-case，前缀体现领域：`btn-primary`、`card-section`、`form-row`，避免与 Tailwind 内置类冲突。

### 5.4 响应式与状态变体

- 响应式断点统一使用 Tailwind 默认断点（`sm`、`md`、`lg`、`xl`、`2xl`），确需自定义必须在 `@theme` 中显式声明并在本规范中登记。
- 状态变体使用顺序必须一致：`responsive:state:dark:utility`，例如 `md:hover:dark:bg-primary`。
- 禁止通过自定义 CSS 重复实现 Tailwind 已有的状态变体。

### 5.5 与 Shadcn Vue 主题互通

- 所有主题相关的颜色、圆角、阴影、间距必须通过 CSS 变量声明，Tailwind 侧通过 `@theme` 将变量暴露为 utility。
- 变量命名遵循 Shadcn 约定：`--primary`、`--primary-foreground`、`--background`、`--foreground`、`--border`、`--input`、`--ring`、`--radius` 等。
- Tailwind 侧必须同时暴露对应 utility，如 `bg-primary`、`text-foreground`、`border-border`、`ring-ring`、`rounded-[var(--radius)]`。
- 禁止出现 Shadcn 变量与 Tailwind utility 不一致的情况；变量与 utility 必须单源、同步更新。

### 5.6 颜色与色彩空间

- 项目统一推荐使用 **OKLCH** 色彩空间声明主题颜色，以获得更好的感知均匀性与广色域支持。
- 允许使用 HSL 作为兼容过渡方案，但新增颜色必须使用 OKLCH；历史 HSL 变量在下一次主题重构时必须迁移。
- 禁止在组件层直接使用十六进制或 RGB 字面量表达主题色；必须通过主题变量引用。
- 非主题性的装饰色（如特定插画背景）允许硬编码，但必须集中在 `constants/colors.ts` 中统一管理，不得散落于组件。

### 5.7 暗色模式

- 暗色模式策略统一使用 `class` 策略：在 `<html>` 上切换 `dark` 类。
- 禁止使用 `media` 策略直接基于 `prefers-color-scheme` 切换，因其无法配合用户手动偏好。
- 系统主题跟随由 composable 监听 `prefers-color-scheme` 实现，最终仍反映为 `dark` 类的增删。
- 组件内禁止写 `@media (prefers-color-scheme: dark)` 代码块，必须改为 `.dark` 选择器或 Tailwind `dark:` 变体。

### 5.8 字体与排版

- 字体族、字号、行高统一在 `@theme` 中声明；禁止组件层使用 `font-family` 内联字符串。
- 中文优先字体必须排在 fallback 链前半段；英文字体与等宽字体作为回退。
- 全局基础排版（正文行高、标题字号梯度）统一在 `@layer base` 中声明，禁止各页面各自调整。

### 5.9 Tailwind 红线

- 禁止全局覆盖 Tailwind 的 `base` 层原生元素样式（主题变量声明除外）。
- 禁止使用 `!important`；必要的优先级问题必须通过调整选择器特异性或全局变量解决。
- 禁止以深层选择器覆盖 Shadcn 组件内部实现；调整样式必须改全局主题变量。
- 禁止在模板中写超过 15 个 utility 类的"一行怪物"；超长类名必须抽离为语义类或组件属性。
- 禁止将主题变量硬编码到自定义 CSS 文件中；所有主题引用必须通过 `var(--xxx)`。
- 禁止引入其他 CSS 框架（Bootstrap、Element Plus 样式、Ant Design Vue 样式等）与 Tailwind 混用。

---

## 第 6 章　Shadcn Vue 规范

### 6.1 定位与组件库选型

- 本项目 UI 统一使用 Shadcn Vue；底层可访问性行为由 **reka-ui** 提供。
- 禁止在同一项目内混用多套 UI 组件库（Element Plus、Ant Design Vue、Naive UI、Vuetify 等）。
- 组件库的引入方式必须通过 Shadcn CLI 生成到 `src/components/ui/`，不允许通过 npm 引入"整包"式组件集合。
- 对 reka-ui 的直接引用仅限于在 `components/ui/` 内部进行定制化组合；业务组件不得绕过 Shadcn 层直接消费 reka-ui primitive。

### 6.2 基础组件清单（统一使用）

- **按钮**：`Button`。
- **表单容器与字段**：`Form`、`FormField`、`FormItem`、`FormLabel`、`FormControl`、`FormDescription`、`FormMessage`。
- **输入控件**：`Input`、`Textarea`、`Select`、`Checkbox`、`RadioGroup`、`Switch`、`Slider`。
- **数据展示**：`Table` 系列（`TableHeader`、`TableBody`、`TableRow`、`TableCell`）、`Badge`、`Avatar`、`Tooltip`、`Card`。
- **弹层与抽屉**：`Dialog`、`AlertDialog`、`Drawer`、`Popover`、`HoverCard`、`Sheet`。
- **导航**：`Tabs`、`Breadcrumb`、`Pagination`、`NavigationMenu`、`Command`。
- **反馈**：`Toast`（消息通知）、`Progress`、`Skeleton`。
- 上述组件以外的 UI 需求必须评估是否能通过组合现有组件实现；确需新增必须经技术评审后通过 CLI 生成。

### 6.3 二次封装约束

- 业务组件必须基于 `components/ui/` 中的 Shadcn 基础组件进行二次封装，放置在 `components/business/` 下。
- 封装过程中禁止修改 Shadcn 基础组件源码；如需扩展能力，通过插槽、Props、透传 attrs 实现。
- 消息通知、确认弹窗、全局 Loading 等横切 UI 必须封装为全局方法，统一由 `services/notify.ts` 或 `composables/useConfirm.ts` 提供，禁止各页面重复实现。
- 表单校验逻辑统一抽离至 composables（如 `useXxxForm.ts`），基于 `vee-validate` + `zod` 或项目统一选型的方案，校验 schema 与 TS 类型必须单源。

### 6.4 组件升级策略

- Shadcn 组件的升级统一通过 CLI 执行，升级前必须查看官方变更说明，评估对现有业务的影响。
- 升级产生的 diff 必须经 Code Review；涉及主题、可访问性、事件接口的变更必须回归测试。
- 禁止直接拉取 GitHub 源码手工覆盖，必须走 CLI 工作流，保证可重复、可追溯。

### 6.5 全局主题配置规范（核心）

#### 6.5.1 配置文件要求

- **唯一主题配置文件**：`src/assets/css/shadcn-theme.css`。禁止新增任何其他主题相关 CSS 文件（如 `theme.css`、`variables.css`、`colors.css` 等）。
- 该文件职责边界清晰：
    - 只声明主题变量与主题相关基础样式；
    - 不得写业务样式、页面布局样式、组件样式；
    - 不得引用具体组件或页面路径。
- 文件必须以 `@layer base` 包裹变量声明，确保不污染全局样式优先级。
- Tailwind 主题 token 通过 `@theme` 或 `@theme inline` 与 Shadcn 变量直接映射，实现单源同步。

#### 6.5.2 变量覆盖范围

主题变量必须覆盖以下维度，缺一不可：

- **主色体系**：`--primary`、`--primary-foreground`、`--primary-muted`、`--primary-muted-foreground`。
- **辅助色体系**：`--secondary`、`--secondary-foreground`。
- **语义色体系**：`--destructive`、`--destructive-foreground`、`--success`、`--success-foreground`、`--warning`、`--warning-foreground`、`--info`、`--info-foreground`。
- **中性色体系**：`--background`、`--foreground`、`--muted`、`--muted-foreground`、`--accent`、`--accent-foreground`、`--card`、`--card-foreground`、`--popover`、`--popover-foreground`。
- **边框与交互**：`--border`、`--input`、`--ring`。
- **形状与节律**：`--radius`、`--radius-sm`、`--radius-md`、`--radius-lg`。
- **阴影**：`--shadow-sm`、`--shadow`、`--shadow-md`、`--shadow-lg`。
- **间距**：`--spacing-xs`、`--spacing-sm`、`--spacing-md`、`--spacing-lg`、`--spacing-xl`。

#### 6.5.3 模式与多主题

- 必须同时支持 `light`、`dark`、`system` 三种主题模式；`system` 模式下跟随操作系统 `prefers-color-scheme`。
- 暗色主题通过 `.dark` 选择器覆盖 `:root` 中的变量，禁止另起炉灶定义独立文件。
- 预留多品牌主题扩展能力：通过 `[data-theme='brand-x']` 选择器覆盖部分变量，扩展主题必须在本规范中登记。
- 主题切换必须由统一的 composable 与 store 协作完成，禁止页面或组件各自切换。

#### 6.5.4 类型定义约束

- 主题变量必须有对应 TypeScript 类型定义，文件路径固定为 `src/types/shadcn-theme.ts`。
- 类型定义与 CSS 变量必须一一对应，任一侧变更必须同步另一侧；CI 必须提供脚本校验两侧的键名一致性。
- 主题模式类型固定为 `TThemeMode = 'light' | 'dark' | 'system'`。
- 主题方法接口 `IThemeMethods` 必须覆盖：设置模式、切换模式、读取当前模式、读取解析后的模式、读取当前主题变量。

#### 6.5.5 主题逻辑抽离

- 主题相关逻辑必须集中在 `src/composables/useTheme.ts`，职责包括：
    - 订阅 Pinia store 中的主题状态；
    - 监听系统 `prefers-color-scheme` 变化；
    - 在 `<html>` 上切换 `dark` 类；
    - 提供读取当前解析主题与主题变量的方法。
- 主题的持久化必须由 `useThemeStore` 配合 `pinia-plugin-persistedstate` 完成，`useTheme` 不得直接读写 `localStorage` 或 `sessionStorage`。
- 禁止在组件中监听媒体查询或操作 `document.documentElement.classList`；所有相关副作用统一由 `useTheme` 完成。

#### 6.5.6 主题切换体验

- 主题切换必须在单帧内完成，禁止出现可见的颜色闪烁。
- 允许通过 CSS 过渡（`transition-colors`）优化切换体验，过渡时长统一由主题变量 `--transition-theme` 控制。
- 首屏渲染前必须尽早确定主题模式，避免"白闪黑"现象；可通过在 `index.html` 中注入极小的同步脚本预设 `dark` 类，该脚本为唯一允许的内联脚本例外。

### 6.6 主题红线

- 禁止修改 Shadcn 基础组件源码中的主题相关样式。
- 禁止在任何组件内单独定义主题 CSS 变量（`--primary`、`--radius`、`--shadow` 等）。
- 禁止使用 `!important` 或深层选择器覆盖 Shadcn 组件样式；所有调整必须通过修改全局主题变量完成。
- 禁止新增多个主题配置文件；主题相关 CSS 只能存在于 `shadcn-theme.css`。
- 禁止主题变量与 Tailwind token 不一致；两者必须保持单源同步。
- 禁止主题配置文件中出现业务语义（如 `--login-btn-bg`），主题层只应有通用设计令牌。
- 禁止在主题变量中写入敏感信息（密钥、内部地址、用户标识等）。
- 禁止在模板中硬编码颜色、圆角、阴影、间距等设计令牌，必须引用主题变量或对应的 Tailwind utility。



---

## 第 7 章　Tauri 规范（强化安全）

### 7.1 版本与基线

- 本项目统一基于 Tauri 2.x，主版本锁定，次版本跟随官方稳定线。
- 前端侧 Tauri API 必须使用 Tauri 2 的包结构：`invoke` 从 `@tauri-apps/api/core` 导入，事件从 `@tauri-apps/api/event` 导入，插件从各自的 `@tauri-apps/plugin-xxx` 包导入。
- 禁止沿用 Tauri 1.x 的导入路径与 allowlist 机制；任何 1.x 时代的代码迁移必须彻底完成，不允许两套机制共存。

### 7.2 前端调用约束

- 组件层禁止直接调用 `invoke`；所有 IPC 调用必须经由 `services/ipc.ts` 统一封装。
- IPC 封装必须满足三项能力：
    - **入参运行时校验**：使用 Zod 或等效方案对入参做 schema 校验，校验失败直接抛出统一错误；
    - **出参运行时校验**：对来自 Rust 侧的返回值同样做 schema 校验，防止类型漂移；
    - **错误归一化**：所有 IPC 错误必须转换为统一的 `AppError` 结构，包含错误码、消息、原始错误引用。
- IPC 命令的 TypeScript 类型必须由工具（推荐 **tauri-specta**）从 Rust 侧自动生成，输出路径固定为 `src/types/ipc.generated.ts`，禁止手工维护。
- 前端调用 IPC 必须使用 `async/await`，禁止裸 Promise 链式写法；调用必须在 services 层做超时与取消控制。

### 7.3 Rust 侧规范

- 命令函数必须返回 `Result<T, AppError>`，`AppError` 基于 `thiserror::Error` 定义，包含业务错误码。
- 禁止在命令中使用 `unwrap`、`expect`、`panic!`，任何不可恢复错误必须转换为 `AppError` 返回。
- 命名统一使用 `snake_case`；文件、模块、函数、参数均遵循 Rust 官方命名约定。
- 命令必须遵循**最小参数原则**：只接收必要字段，禁止传递整个前端对象。
- 对文件系统、进程、网络等高风险操作必须封装在独立模块中，并提供明确的单元测试覆盖。
- 依赖管理：`Cargo.toml` 中禁止使用 `*` 或 `git = "..."` 未锁定来源的依赖；所有依赖必须指定精确版本或 `^x.y`。

### 7.4 权限与能力模型

- Tauri 2 的能力（capabilities）机制必须严格遵循**最小权限原则**：
    - 能力清单位于 `src-tauri/capabilities/` 下，按窗口或场景拆分文件；
    - 每个能力仅授予当前场景必需的命令与插件权限，禁止使用通配符授予整类权限；
    - 新增命令必须同步更新能力清单，并在 PR 中单独说明权限变更影响。
- 文件系统、Shell、HTTP、Notification 等高敏插件默认关闭；确需启用必须经过安全评审。
- 禁止启用 `dangerousRemoteDomainIpcAccess` 或其他被官方标记为危险的开关；如确有远程域 IPC 需求，必须走独立的安全方案评审。

### 7.5 CSP 与加载来源

- `tauri.conf.json` 中必须显式声明 `app.security.csp`，禁止留空。
- CSP 策略必须满足：
    - 禁止 `unsafe-inline` 与 `unsafe-eval`；
    - 图片、字体、样式、脚本来源必须白名单化；
    - 连接源（`connect-src`）仅允许项目明确依赖的后端与服务。
- 首屏为避免主题闪烁而注入的同步内联脚本，是 CSP 唯一允许的例外，必须在 CSP 中使用 `nonce` 授权，且该脚本体积必须控制在必要范围。
- 开发服务器 URL 通过 `build.devUrl` 指定，禁止以绝对 `file://` 或本地磁盘路径直接加载页面。

### 7.6 窗口与进程

- 窗口创建必须通过配置或受控 API 完成，禁止业务代码随意调用 `WebviewWindow` 构造。
- 多窗口场景必须在 `tauri.conf.json` 或 `capabilities` 中预声明窗口标签，运行时动态创建的窗口必须走统一的工厂函数。
- 子进程、Shell 命令执行默认禁用；确需使用必须限定命令白名单与参数校验，禁止拼接用户输入作为命令参数。

### 7.7 敏感数据与凭证

- 令牌、密钥、用户凭证等敏感数据必须存储在 Tauri 的安全容器中（推荐 `tauri-plugin-stronghold` 或操作系统 keyring），严禁使用 `localStorage`、`sessionStorage`、`IndexedDB` 明文存储。
- 前端内存中持有敏感数据的时间必须最小化，使用完毕立即清除引用。
- 日志、错误上报、遥测数据中禁止出现敏感字段；必须在统一日志封装层做字段脱敏。

### 7.8 文件与路径

- 前端不得接触原始绝对路径；文件操作必须通过 Rust 侧命令，命令内部完成路径校验与权限控制。
- 路径校验必须防止路径穿越攻击：拒绝包含 `..` 的路径、拒绝指向应用沙箱外的路径、拒绝符号链接穿越。
- 文件读写必须限定在应用数据目录或用户显式授权的路径，禁止访问系统目录。

### 7.9 自动更新

- 自动更新必须使用官方 updater 插件，更新源必须使用 HTTPS 并启用签名校验。
- 更新签名公钥必须硬编码在发布产物中，签名私钥必须托管于 CI 安全存储，禁止进入代码仓库。
- 更新失败必须提供可回滚的明确路径，禁止在更新过程中破坏用户数据。

### 7.10 事件与 IPC 数据流

- Rust 侧向前端推送事件必须通过 Tauri 事件系统，事件名使用 kebab-case，负载必须类型化。
- 禁止用事件模拟同步请求；请求-响应模型一律使用 `invoke` 命令。
- 高频事件（如进度、日志流）必须做节流或批量下发，避免主线程拥塞。

### 7.11 Tauri 红线

- 禁止在前端暴露任何系统绝对路径。
- 禁止任何未经 Zod 校验的 IPC 入参或出参。
- 禁止在 Rust 侧 `unwrap` / `panic`。
- 禁止使用通配符授予能力权限。
- 禁止关闭 CSP、禁止使用 `unsafe-inline` 或 `unsafe-eval`。
- 禁止前端存储敏感凭证于 Web 存储中。
- 禁止未经签名校验的自动更新。
- 禁止在组件层直接调用 `invoke`。

---

## 第 8 章　Pinia 规范

### 8.1 基本结构

- 所有 store 必须使用 **setup store** 风格，禁止使用 Options API 风格的 `defineStore({ state, getters, actions })`。
- store 文件统一放置于 `src/store/`，按业务域拆分，一个业务域一个文件。
- store 命名遵循 `useXxxStore`，`defineStore` 的 id 使用 kebab-case，如 `user`、`theme`、`app`。
- 一个文件只导出一个主 store；不得在同一文件中定义多个互相引用的 store。

### 8.2 状态分类

store 内状态必须显式按以下三类组织，并在注释中标明分类：

- **persistent（持久化）**：需要跨会话保留的状态，如主题模式、用户偏好、侧边栏折叠状态；通过 `pinia-plugin-persistedstate` 持久化，非敏感项可明文，敏感项必须经过加密序列化。
- **temporary（临时）**：仅在当前会话中使用的状态，如当前路由参数缓存、分页状态；不做持久化。
- **sensitive（敏感）**：令牌、凭证等敏感数据一律不进前端 store；必须走 Tauri 安全存储，store 中只保留必要的会话标识或派生状态。

### 8.3 Getter 与 Action

- Getter 必须是**纯函数**：只读状态、无副作用、无异步。带副作用的派生必须放在 action 中。
- Action 负责业务动作与副作用，命名使用动词短语：`fetchUser`、`updateProfile`、`toggleTheme`。
- Action 内部禁止写 `try/catch` 掩盖错误；错误必须向上抛出并由 services 层或调用方处理；如需兜底必须在注释中说明原因。
- Action 必须显式声明返回值类型；涉及异步必须返回 `Promise<T>` 并在调用处 `await`。

### 8.4 Store 间协作

- 禁止 store 之间直接互相 `import` 调用形成强耦合；跨 store 协作必须通过以下方式之一：
    - 将共享逻辑下沉到 composable；
    - 通过事件总线或统一的通知层（如 `services/notify.ts`）传递；
    - 由调用方（组件或 composable）同时组合多个 store 完成协作。
- 禁止在 store action 中直接修改另一个 store 的状态；只能调用另一个 store 暴露的 action。

### 8.5 状态持久化

- 持久化统一使用 `pinia-plugin-persistedstate`，在 `src/store/index.ts` 的 Pinia 实例初始化处一次性注册。
- 每个 store 显式声明 `persist` 配置：
    - 指定需要持久化的字段（`paths`），禁止整 store 全量持久化；
    - 指定存储键名（`key`），命名统一加前缀避免冲突；
    - 对非敏感但较大的状态使用 `debounce` 策略，避免频繁写入。
- 严禁直接在 store 或 composable 中手写 `localStorage.setItem`；持久化一律由插件统一接管。

### 8.6 主题 store 专项约束

- 主题相关状态集中在 `useThemeStore`，至少包含：当前主题模式（`TThemeMode`）、派生的解析主题、最近一次切换时间戳。
- 持久化字段仅包含主题模式，其他字段必须由 composable 实时推导，禁止持久化。
- 主题 store 的 action 仅负责"更新主题模式"这一纯状态变更；DOM 副作用（切换 `dark` 类、监听系统主题）由 `useTheme` composable 完成。

### 8.7 类型与契约

- store 的 state、getters、actions 公共签名必须显式类型化，禁止依赖推断作为对外契约。
- 对外暴露给组件使用的字段必须最小化；内部中间状态应封装在模块私有变量或通过 `readonly` 包装。
- Store 返回值类型必须稳定，新增字段不得破坏既有消费方；删除字段必须经 RFC。

### 8.8 Pinia 红线

- 禁止 Options Store 风格。
- 禁止 store 之间直接互相调用或交叉修改状态。
- 禁止在组件中 `import` store 文件的非公共符号（如内部辅助函数、模块级变量）。
- 禁止将敏感数据存入前端 store。
- 禁止整 store 全量持久化。
- 禁止在 action 中静默吞掉异常。
- 禁止在 store 外绕过 action 直接修改 state。

---

## 第 9 章　services 规范

### 9.1 定位与目录

- `services/` 是所有外部 I/O 的唯一出口，包括但不限于 HTTP 请求、Tauri IPC、通知、文件操作代理、第三方 SDK 封装。
- 目录结构：
    - `services/request.ts`：HTTP 请求基础封装，含拦截器、错误归一化、鉴权注入。
    - `services/ipc.ts`：Tauri IPC 调用统一封装，含 Zod 校验、错误归一化、超时控制。
    - `services/notify.ts`：全局消息与通知封装，基于 Shadcn Toast。
    - `services/modules/`：按业务域拆分的具体接口文件，如 `user.ts`、`file.ts`、`system.ts`、`auth.ts`。
- 禁止在 `services/` 以外的地方直接发起 `fetch`、`axios`、`invoke` 调用。

### 9.2 请求封装要求

- HTTP 客户端统一选型（推荐原生 `fetch` + 轻封装，或统一使用 axios，全项目二选一，不得混用）。
- 统一封装必须具备以下能力：
    - 请求拦截：注入鉴权头、租户头、语言头；
    - 响应拦截：解析统一响应体、做错误归一化；
    - 超时控制：默认超时时间在常量文件中统一配置；
    - 取消能力：支持 `AbortController`，组件卸载时必须取消未完成请求；
    - 重试策略：幂等请求允许配置有限次数指数退避重试，非幂等请求禁止自动重试。
- 请求与响应的数据结构必须类型化；业务接口出入参通过 Zod schema 同时完成类型与运行时校验。

### 9.3 错误处理

- 所有请求与 IPC 错误必须转换为统一的 `AppError`，字段至少包括：
    - `code`：业务错误码枚举 `EAppErrorCode`；
    - `message`：可直接对用户展示的中文消息；
    - `cause`：原始错误引用（保留堆栈，便于排查）；
    - `scope`：错误产生的域（`http` / `ipc` / `validation` / `unknown`）。
- 组件层禁止书写 `try/catch`；错误由 services 拦截器归一化后，通过以下任一路径传递：
    - 交由上层 composable / store 捕获并更新状态；
    - 由全局错误处理器（`app.config.errorHandler`、Vue Router 错误钩子、Promise `unhandledrejection`）统一上报与提示。
- 错误提示必须经 `services/notify.ts` 统一展示，禁止在组件内直接调用底层 Toast API 以避免样式与文案不一致。
- 禁止用静默回退（返回默认值、吞掉异常）处理错误，除非产品显式要求并在注释中说明。

### 9.4 接口模块组织

- `services/modules/` 下的每个文件对应一个业务域，文件内按"查询 / 命令"分组：
    - 查询函数命名以 `fetch`、`get`、`list`、`search` 开头；
    - 命令函数命名以 `create`、`update`、`delete`、`submit` 等动词开头。
- 每个接口函数必须显式类型化入参与返回值，禁止使用 `any` 或裸 `unknown` 对外暴露。
- 接口路径、HTTP 方法、查询参数等常量必须在模块顶部集中声明，禁止在函数体中散落字符串字面量。

### 9.5 IPC 封装专项

- `services/ipc.ts` 必须导出统一的 `ipc<TIn, TOut>(cmd, input, inSchema, outSchema)` 调用入口。
- 所有 IPC 命令必须配套 Zod schema，schema 与 `src/types/ipc.generated.ts` 中的自动生成类型必须保持一致，两者偏离时以生成类型为准并更新 schema。
- IPC 调用必须支持超时与取消；长耗时命令必须配合 Rust 侧事件推送进度，而非前端轮询。
- 与 HTTP 请求相同的错误归一化规则适用于 IPC：错误必须转换为 `AppError` 且 `scope` 为 `ipc`。

### 9.6 通知封装

- 全局通知必须由 `services/notify.ts` 统一提供，至少包含四个语义方法：`success`、`info`、`warning`、`error`。
- 通知默认时长、位置、堆叠数量在常量中统一配置，禁止各页面自定义样式参数。
- 错误通知的默认渲染必须显示错误码或可追溯 ID，便于用户反馈与问题排查。

### 9.7 Mock 与测试

- services 层必须天然可替换：测试中通过依赖注入或模块 mock 替换底层请求实现。
- 单元测试禁止真实发起网络请求或 IPC；必须使用 mock。
- 每个对外接口函数必须有对应测试覆盖核心成功路径与至少一条错误路径。

### 9.8 services 红线

- 禁止组件内直接调用 `fetch`、`axios`、`invoke`。
- 禁止组件内书写 `try/catch`；错误统一由 services 与全局处理器接管。
- 禁止在 services 层返回未归一化的原始错误。
- 禁止在业务函数中硬编码接口路径、HTTP 方法、超时时间。
- 禁止同一项目内混用多个 HTTP 客户端。
- 禁止跳过 Zod 校验直接消费网络或 IPC 数据。
- 禁止在通知封装外使用底层 Toast API。
好，只输出**第 10 章 性能优化**。

---

## 第 10 章　性能优化

### 10.1 总体原则

- 性能优化必须以**可度量指标**为依据，禁止凭主观感受做改动。
- 所有性能相关改动必须附带前后对比数据：首屏时间、可交互时间、关键操作响应时间、产物体积、内存占用中的至少一项。
- 性能与可读性、可维护性冲突时，优先保证可读性；仅在指标明确回归或低于基线时才允许引入复杂优化。
- 性能优化不得以牺牲类型安全、安全边界、可访问性为代价。

### 10.2 性能基线与预算

- 项目必须在 `docs/performance-budget.md` 中声明性能预算，至少覆盖以下维度：
    - 首屏渲染时间（冷启动、热启动分别声明）；
    - 路由切换平均耗时；
    - 主要业务操作的端到端响应时间；
    - 打包产物总体积（gzip 后）；
    - 单个首屏 chunk 体积上限；
    - 运行时常驻内存上限（桌面端关键场景）。
- 任一指标回归超过 10% 必须在 PR 中说明原因与补偿方案；连续两个版本回归必须立项整改。
- CI 必须集成产物体积检测（如 `size-limit` 或等效工具），超过预算直接失败。

### 10.3 路由与页面加载

- 路由级页面**必须**使用动态 `import()` 实现懒加载，禁止在路由表中同步引入页面组件。
- 首屏路由必须显式标识，允许以预加载（`<link rel="modulepreload">` 或路由钩子）提前加载其依赖。
- 非首屏路由禁止在应用启动阶段预加载，避免抢占首屏资源。
- 路由切换必须提供加载态反馈（骨架屏或进度条），避免用户感知空白。
- 路由懒加载产生的 chunk 必须具备稳定命名（通过 Vite `build.rollupOptions.output.chunkFileNames` 配置），便于缓存与排障。

### 10.4 组件级优化

- 大型业务组件（富文本、图表、代码编辑器、地图等）**必须**动态 `import()` 延迟加载，配合 `Suspense` 或加载态。
- 仅在必要时使用 `defineAsyncComponent`，并统一提供 `loadingComponent` 与 `errorComponent`，避免各组件各自实现降级界面。
- 避免在组件的 `setup` 阶段执行重计算；重计算必须放入 `computed` 并充分利用缓存。
- 对高频渲染组件（列表项、标签、图标）必须：
    - 使用 `v-memo` 或精确拆分 props 减少重渲染；
    - 避免在 props 中传递每次渲染都会变更的新对象或函数引用；
    - 避免在模板中创建内联对象或内联箭头函数作为事件处理器。
- 禁止在模板中调用可能触发副作用或耗时的函数；计算逻辑必须前置为 `computed`。

### 10.5 响应式数据优化

- 对大规模只读数据（大型列表、配置对象、字典表）必须使用 `shallowRef`、`shallowReactive` 或 `markRaw`，避免深度响应式代价。
- 禁止对第三方实例对象（如 Monaco editor instance、图表实例、Map 实例）直接使用 `ref` / `reactive`；必须使用 `shallowRef` 或 `markRaw`。
- `watch` 必须显式指定依赖源；禁止用 `watchEffect` 包住大段代码造成依赖漂移。
- 对频繁触发的响应式副作用必须做节流或防抖，统一通过 `composables/useDebounce.ts`、`useThrottle.ts` 提供，禁止各处重复实现。

### 10.6 长列表与大数据量渲染

- 单次渲染列表项超过 100 条时**必须**使用虚拟滚动方案（如 `vue-virtual-scroller` 或项目统一选型）。
- 虚拟列表组件必须由 `components/business/` 统一封装，禁止各页面直接依赖底层虚拟滚动库，便于未来替换。
- 大数据量表格必须支持分页或无限滚动，禁止一次性全量拉取并渲染。
- 排序、筛选、搜索等操作若涉及大数据量必须放入 Web Worker 或 Rust 侧处理，避免阻塞主线程。

### 10.7 资源与静态产物

- 图片：
    - 优先使用 WebP 或 AVIF 格式；提供合理的宽高与 `loading="lazy"` 属性；
    - 必须通过构建期压缩（如 `vite-plugin-image-optimizer` 或等效方案），禁止提交未压缩的大图；
    - 单张图片体积上限在性能预算中声明，超限必须拆分或改用矢量。
- 字体：
    - 使用子集化字体，只打包实际使用字符集；
    - 通过 `font-display: swap` 避免字体加载阻塞首屏；
    - 自托管字体必须启用缓存策略。
- 图标：
    - 优先使用 SVG 雪碧图或按需导入（如 `unplugin-icons`）；
    - 禁止整包引入 Icon 库；
    - 单色图标必须通过 `currentColor` 继承主题色，避免重复打包不同颜色变体。

### 10.8 打包与代码分割

- 公共依赖（Vue、Vue Router、Pinia、reka-ui）必须合并为 `vendor-core` chunk，避免重复加载。
- 按领域进行手动分包：认证、设置、编辑器、报表等大模块各自成包。
- 分包策略必须稳定：同一模块的 chunk 文件名在非破坏性改动中保持一致，最大化缓存命中率。
- 禁止为消除构建告警而盲目提高 `chunkSizeWarningLimit`；告警必须通过真实拆包解决。
- Monaco Editor 必须按需加载语言与 worker，禁止全量引入；worker 必须走 Vite 原生 worker 机制，不得内联为主 bundle。

### 10.9 缓存策略

- 静态资源文件名必须带内容 hash，配合长期 HTTP 缓存；桌面端打包产物同样遵循该约定以利差分更新。
- 业务接口层必须区分"可缓存查询"与"实时查询"：
    - 可缓存查询通过 `composables/useQuery.ts` 或统一数据层缓存结果，支持失效与主动刷新；
    - 实时查询不得进入缓存层。
- 同一请求在单次页面生命周期内必须去重，避免并发重复调用。

### 10.10 Tauri 桌面端性能

- Rust 侧耗时任务必须异步化，禁止在 IPC 命令中执行同步阻塞调用。
- 大体积数据（日志、二进制、长文本）传输必须分片或通过事件流式下发，禁止一次性跨 IPC 传输。
- 启动阶段禁止在 Rust 侧做重初始化工作；重任务必须延迟到窗口就绪后按需触发。
- 窗口恢复、最小化、最大化等操作必须保持 60 FPS；涉及重绘的逻辑必须放入 `requestAnimationFrame` 或 Rust 侧处理。

### 10.11 主题切换性能

- 主题切换必须在单帧内完成，禁止出现可见的颜色闪烁或内容回流。
- 颜色过渡统一通过 `transition-colors` 与主题变量控制，过渡时长集中配置于主题变量 `--transition-theme`。
- 首屏必须在渲染前确定主题模式，避免"白闪黑"；允许在 `index.html` 中注入极小的同步脚本预设 `dark` 类，此为唯一内联脚本例外。
- 主题切换不得触发路由重载或大规模组件重建；实现必须依赖 CSS 变量响应，而非组件 key 重置。

### 10.12 内存与泄漏预防

- composable 与组件中的事件监听、定时器、媒体查询、Tauri 事件订阅必须在 `onScopeDispose` 或 `onBeforeUnmount` 中显式清理。
- 长生命周期对象（全局 store、服务单例）内部禁止持有组件实例引用，避免组件无法回收。
- 使用 `new URL`、`URL.createObjectURL`、Blob 等资源时必须显式释放（`revokeObjectURL`）。
- 周期性重复创建的 Worker、WebSocket、EventSource 必须复用或在使用完成后关闭。

### 10.13 监控与度量

- 关键路径必须埋点度量，包括但不限于：应用启动、路由切换、主操作完成、错误发生率。
- 度量数据必须脱敏，禁止包含用户标识、敏感业务数据。
- 生产环境必须开启错误与性能监控，异常阈值必须触发告警并通知责任人。
- 每个版本发布后必须在一个迭代内复盘性能指标；指标回归必须回溯最近变更并输出结论。

### 10.14 性能红线

- 禁止在路由表中同步引入页面组件。
- 禁止一次性渲染超过 100 条的长列表而不使用虚拟滚动。
- 禁止对大型第三方实例使用深度响应式。
- 禁止在主线程执行重 CPU 任务（排序、加解密、解析大文件）。
- 禁止通过提高构建告警阈值来掩盖真实体积问题。
- 禁止未压缩、未 hash 化的静态资源进入产物。
- 禁止性能优化引入不可解释的复杂实现而无文档说明。
- 禁止未清理的事件监听、定时器、订阅进入生产代码。



