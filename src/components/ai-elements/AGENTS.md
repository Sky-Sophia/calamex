# ai-elements 约束

`ai-elements/` 是一层**纯展示组件**：只负责渲染与交互，不持有业务状态、不发起 I/O、不感知具体 AI provider。数据以 props 流入，意图以 emit 流出。

## 一、依赖边界（违反即不合格）
- MUST NOT import `@/store/*`、`@/services/*`、`@/composables/*`。
- 依赖方向单向：`business → ai-elements`，禁止反向 import `@/components/business/*`。
- 不出现任何副作用：`invoke`、`fetch`、读写 `localStorage` / keyring、文件 / 进程 / 网络访问一律不准进入本目录。
- 仅允许依赖 Vue、本目录内兄弟组件、以及无副作用的纯工具函数与类型。

## 二、provider 中立
- MUST NOT 包含任何 provider 特定逻辑：定价、tokenizer、计费换算、SDK 名、模型名硬编码或平台分支判断。
- 需要展示这类信息时，由父级计算并格式化后用 props 传入；组件本身不内置任何 provider 词典。

## 三、数据流与状态
- 单向数据流：props 进、emit 出；不修改 props，不回写父级状态。
- 只允许局部 UI 状态（展开、悬停等）使用 `ref`；不持有跨组件 / 跨会话的长期状态。
- 加载态、错误态、空态由父级以 props 下发；组件不自行获取或持久化数据。

## 四、类型与可测
- 禁 `any`、`@ts-ignore`、`!` 非空断言；对外暴露显式的 props / emits 类型。
- 组件必须能在不挂载任何 store / service 的情况下完成单测，输入只靠 props。
