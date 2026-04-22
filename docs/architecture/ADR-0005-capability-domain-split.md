# ADR-0005 Tauri capability 按 5 域拆分

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

当前 `src-tauri/capabilities/default.json` 是单一文件，负责所有窗口的所有权限授予——这违反了：

- R-7.4.1：能力清单 MUST 在 `capabilities/` 按窗口/场景拆分
- R-7.4.2：每个能力 MUST 仅授必需权限，MUST NOT 通配符
- R-18.12.5：MUST 对 5 组命令域分别维护 capability 清单，MUST NOT 单一文件授予跨域权限
- R-20.5.8：命令模块 MUST 与 `capabilities/` 按领域一一对应

## 决策

将单一 `default.json` 拆分为 5 个领域文件：

| 文件 | 命令域 | 主要权限 |
|------|--------|---------|
| `capabilities/window.json` | 窗口管理 | `core:window:allow-*`（仅必需）|
| `capabilities/workspace-fs.json` | 工作区/文件 | `dialog:default`、文件读写（按需） |
| `capabilities/script-toolchain.json` | 脚本工具链 | ShellCheck、shfmt、环境探测命令 |
| `capabilities/terminal.json` | 集成终端 | PTY 会话命令 |
| `capabilities/git.json` | Git 操作 | Git 命令授权 |

每个文件中 `windows` 字段保持 `["main"]`（当前单窗口应用）。

**组织说明（重要）**：当前为单窗口应用，拆分的主要目的是**组织性收益**——防止一次性权限膨胀，便于审计每个域授了什么权限，以及未来多窗口/多场景时能精确授权。

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 维持单文件 | 违反 R-7.4.1 / R-18.12.5；权限审计困难 |
| 按窗口维度拆分 | 当前只有一个窗口，无实质区分；命令域更有意义 |

## 影响

- **正面**：权限最小化原则落实；新增命令时只需改对应域文件；安全审计粒度更细。
- **代价**：后续新增 IPC 命令时须同步更新对应 capability 文件（PR 必须检查）。
- **关联规则**：R-7.4.1、R-7.4.2、R-7.4.3、R-18.12.5、R-20.5.8
- **关联任务**：T-1.8

## 相关链接

- [AGENTS.md §7.4 能力](../../AGENTS.md)
- [AGENTS.md §18.12.5](../../AGENTS.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
