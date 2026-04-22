# ADR-0003 静态守卫与存量豁免机制

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

当前仓库存在多处违反 AGENTS.md 规则的存量代码（已识别于分析阶段），若直接引入 CI 守卫将导致 CI 全红、主干无法合入。

同时，「一刀全切」不符合 code_agent.md §1.2「先装护栏，不先拆业务」的原则：需要一种机制，使**新增违规立即失败、存量违规有序整改**。

## 决策

建立**「豁免清单 + 到期自动转失败」**机制：

1. 守卫脚本在 `scripts/` 下以 `check-*.ts` 形式实现（用 `tsx` 执行）。
2. 每个守卫对应 `scripts/baselines/<名称>.json` 豁免清单。
3. 守卫行为：
   - 命中豁免清单 → `WARN`（CI 打印警告日志，不阻断）
   - 未命中豁免清单的新违规 → `ERROR`（CI 阻断）
   - 豁免条目已过期（当前日期 > `expiresAt`）→ `ERROR`（CI 阻断）
4. 豁免条目结构固定：
   ```json
   {
     "path": "相对路径",
     "rule": "规则ID或守卫名",
     "reason": "豁免原因",
     "owner": "@负责人",
     "adrRef": "ADR-XXXX",
     "expiresAt": "YYYY-MM-DD"
   }
   ```
5. `package.json` 新增 `scripts.guard` = `tsx scripts/run-all-guards.ts` 聚合命令。

### 初始豁免条目

基于现状识别的存量违规，归入对应豁免清单：

**`scripts/baselines/file-size.json`**

| path | rule | expiresAt |
|------|------|-----------|
| `src/composables/useWorkbench.ts` | `max-lines-400` | iteration 2 结束 |
| `src/views/ShellWorkbenchView.vue` | `max-script-setup-120` | iteration 2 结束 |
| `src/composables/useIntegratedTerminal.ts` | `max-lines-composable` | iteration 2 结束 |
| `src/main.ts` | `max-inline-dom-120` | iteration 2 结束 |

**`scripts/baselines/rust-mod-size.json`**

| path | rule | expiresAt |
|------|------|-----------|
| `src-tauri/src/commands/mod.rs` | `max-lines-80` | iteration 3 结束 |

**`scripts/baselines/workbench-facade.json`**

| path | rule | expiresAt |
|------|------|-----------|
| `src/views/ShellWorkbenchView.vue` | `no-multi-business-store-import` | iteration 2 结束 |

**`scripts/baselines/dormant-modules.json`**

| path | rule | expiresAt |
|------|------|-----------|
| `src/router/index.ts` | `dormant-no-readme` | T-1.8 当周修复 |

**`scripts/baselines/config-refs.json`**

| path | rule | expiresAt |
|------|------|-----------|
| `components.json:tailwind.config` | `dangling-config-ref` | T-1.8 当周修复 |

**`scripts/baselines/capability-domains.json`**

（初始为空 — T-1.8 完成后不再需要豁免）

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 纯 warn 模式（永不 fail） | 无法阻止持续劣化，失去护栏意义 |
| 立即 fail（无豁免） | CI 全红，主干无法合入，阻塞正常开发 |
| 手写 `.eslintignore` 豁免 | 无到期机制；散布在多文件难以追踪 |

## 影响

- **正面**：存量问题有序整改；新增违规立即可见；豁免到期自动转失败防遗忘。
- **代价**：需维护额外 JSON 文件；豁免到期前须完成重构。
- **关联规则**：R-20.10（Enforcement）、AGENTS.md 全局约束 G-5
- **关联任务**：T-1.4（本 ADR）、T-1.5（守卫脚本实现）

## 相关链接

- [AGENTS.md §20.10 Enforcement](../../AGENTS.md)
- [code_agent.md §1.2 执行原则](../../code_agent.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
