# Shell 脚本 IDE（桌面端）

> 基于 Tauri 2 + Vue 3 的桌面 Shell 脚本开发工具，提供编辑、诊断、格式化、集成终端与 Git 集成功能。

## 技术栈

| 层 | 版本 |
|---|---|
| Tauri | ^2 |
| Vue | ~3.5 |
| TypeScript | 6.0.2 |
| Vite | 8.0.8 |
| Tailwind CSS | 4.2.2 |
| Shadcn-Vue | cli-latest-stable |
| Pinia | >=2.2 |
| Monaco Editor | 0.55.1 |
| pnpm | >=9 |
| Node | >=20 LTS |

完整基线版本见 [AGENTS.md 第 0 章](./AGENTS.md) 与 [ADR-0002](./docs/architecture/ADR-0002-dependency-baseline.md)。

---

## 快速上手

### 前置依赖

- Node.js ≥ 20 LTS
- pnpm ≥ 9
- Rust stable（安装 `rustup`）
- Windows：MSVC 工具链（VS Build Tools 2022）
- ShellCheck（可选，缺失则诊断降级）
- shfmt（可选，缺失则格式化降级）

### 安装依赖

```bash
pnpm install --frozen-lockfile
```

### 开发模式

```bash
pnpm run tauri:dev      # 启动 Tauri + Vite 开发服务器（Windows MSVC 环境）
# 或
pnpm run dev            # 仅启动 Vite 前端（不含 Rust 进程）
```

### 构建产物

```bash
pnpm run tauri:build
```

---

## 开发脚本

| 脚本 | 说明 |
|---|---|
| `pnpm dev` | 启动 Vite 前端开发服务器 |
| `pnpm build` | 前端 typecheck + 构建 |
| `pnpm typecheck` | `vue-tsc --noEmit` 类型检查 |
| `pnpm lint` | ESLint |
| `pnpm test` | 运行单元测试（Vitest）|
| `pnpm test:coverage` | 单元测试 + 覆盖率报告 |
| `pnpm guard` | 运行所有架构守护脚本 |
| `pnpm tauri:dev` | 完整桌面开发模式 |
| `pnpm tauri:build` | 完整桌面发布构建 |
| `pnpm generate:shell-catalog` | 重新生成 Shell 命令补全目录 |

---

## 目录结构

```
src/
  assets/css/         # Tailwind CSS 入口 + Shadcn 主题变量
  components/
    ui/               # Shadcn CLI 生成产物（勿手改主题）
    business/         # 基于 ui 的二次封装
    common/           # 通用 UI 组件
    editor/           # 编辑器相关组件
    workbench/        # 工作台 Shell 组件
  views/              # 路由级页面（当前仅 ShellWorkbenchView）
  composables/        # useXxx.ts 组合式函数
  services/           # I/O 唯一出口（HTTP/IPC）
  store/              # Pinia setup stores
  router/             # Vue Router（当前 @status: dormant）
  types/              # 跨模块类型定义
  themes/             # 主题合成与 Monaco/xterm 主题管理
  utils/              # 纯函数工具
  constants/          # UPPER_SNAKE_CASE 常量
src-tauri/
  src/commands/       # Tauri 命令（按领域拆分）
  capabilities/       # 按域拆分的权限声明
docs/
  architecture/       # ADR 决策记录
  tech-debt.md
  security-exceptions.md
  performance-budget.md
  observability.md
  env-vars.md
  audit-events.md
  incident-runbook.md
  incident-log.md
scripts/
  check-*.ts          # 架构守护脚本
  baselines/          # 守护豁免基线配置
```

---

## 架构决策记录（ADR）

重要架构决策见 [docs/architecture/README.md](./docs/architecture/README.md)。

---

## 贡献指南

1. 新功能分支从最新 `main` 切出，命名 `feat/<scope>-<desc>`
2. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org)（中文主题）
3. 合入前 MUST 本地通过四件套：`typecheck` + `lint` + `test` + `build`
4. PR 描述 MUST 含：背景/方案/影响面/验证方式/回滚方案
5. 架构偏离 MUST 配 ADR，见 [ADR 模板](./docs/architecture/_TEMPLATE.md)

---

## 规范参考

完整开发规范见 [AGENTS.md](./AGENTS.md)（AI 与人类开发者共同遵守的 SSoT）。

---

## 许可证

Private — 暂未开源
