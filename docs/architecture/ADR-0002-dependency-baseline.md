# ADR-0002 依赖基线一次性补齐

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

AGENTS.md 第 0 章要求精确锁定版本基线，但当前项目中以下关键包缺少精确版本登记或根本未安装：

- **运行时校验**：Zod（未安装）→ 缺失导致无法实现 R-3.8.1、R-20.4.1 IPC 契约层
- **持久化**：`pinia-plugin-persistedstate`（未安装）→ 导致 store/app.ts 不得不手写 localStorage
- **测试工具**：`vitest`、`@vue/test-utils`、`@playwright/test`（均未安装）→ 导致 R-11.* 无法达成
- **静态守卫**：`size-limit`、`dpdm`、`stylelint` 等（未安装）→ 导致 R-20.10 Enforcement 缺失
- **终端**：`xterm-addon-web-links`（当前已安装 `@xterm/addon-fit` 与 `@xterm/addon-webgl`，需补 web-links）

## 决策

将以下包加入 `package.json`，精确版本写入 AGENTS.md 第 0 章 Baseline 表。

### 运行时依赖（`dependencies`）

| 包 | 版本 | 用途 |
|---|---|---|
| `zod` | `^3.24.0` | 运行时 schema 校验（IPC 契约、外部输入） |
| `pinia-plugin-persistedstate` | `^4.1.0` | Store 持久化（替代手写 localStorage） |
| `@xterm/addon-web-links` | `^0.11.0` | xterm 超链接识别 |

### 开发依赖（`devDependencies`）

| 包 | 版本 | 用途 |
|---|---|---|
| `vitest` | `^2.1.0` | 单元/组件测试框架 |
| `@vue/test-utils` | `^2.4.0` | Vue 组件测试工具 |
| `@playwright/test` | `^1.48.0` | 桌面端 E2E 测试 |
| `@axe-core/playwright` | `^4.10.0` | a11y 自动化检测 |
| `@vitest/coverage-v8` | `^2.1.0` | 覆盖率 provider |
| `size-limit` | `^11.1.0` | bundle 体积预算 |
| `@size-limit/preset-app` | `^11.1.0` | size-limit 预设 |
| `dpdm` | `^3.14.0` | 循环依赖检测 |
| `stylelint` | `^16.12.0` | CSS/样式 lint |
| `stylelint-config-tailwindcss` | `^0.0.9` | Tailwind CSS 样式规范 |
| `tsx` | `^4.19.0` | TypeScript 脚本执行器（守卫脚本用） |
| `husky` | `^9.1.0` | Git hooks |
| `lint-staged` | `^15.3.0` | 暂存区增量 lint |
| `@commitlint/cli` | `^19.6.0` | commit 信息规范检查 |
| `@commitlint/config-conventional` | `^19.6.0` | Conventional Commits 预设 |

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 延迟安装，按需添加 | 导致 CI 守卫脚本无法运行，iteration 1 目标无法达成 |
| 使用 valibot 替代 zod | 生态、文档、工具链均不如 zod 成熟；偏离已记录规则 |

## 影响

- **正面**：IPC 契约、测试、守卫、持久化底座全部就绪；后续迭代可直接使用。
- **代价**：`pnpm install` 时间增加；`pnpm-lock.yaml` 发生变化（Renovate 可以后续自动维护）。
- **关联规则**：R-0.2.1、R-0.2.2、R-3.8.1、R-8.5.1、R-11.1.*、R-20.4.1
- **关联任务**：T-1.3（本 ADR），后续各迭代将使用这些包

## 相关链接

- [AGENTS.md §0 版本基线](../../AGENTS.md)
- [AGENTS.md §3.8 运行时校验](../../AGENTS.md)
- [AGENTS.md §11 测试](../../AGENTS.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
