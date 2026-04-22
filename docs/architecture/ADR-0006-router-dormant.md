# ADR-0006 `src/router/` 休眠处置

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

`src/router/index.ts` 存在于仓库中，但：

1. `src/main.ts` 中从未调用 `app.use(router)`，故路由未被注册。
2. 业务代码未从任何路径 `import` 路由模块。
3. 该文件的存在具有误导性——新成员可能误认为路由已生效。

这违反了：
- R-18.2.1：当前运行时 MUST NOT 注册 Vue Router
- R-18.2.2：若路由目录保留，MUST 在顶部明示「当前未注册」
- R-20.8.2：`src/router/` 在当前未挂载期间 MUST 含 README 且 `index.ts` 顶部含 `// @status: dormant`

## 决策

保留 `src/router/` 目录（避免 git 历史损坏、保留备用可能），但明确标注休眠状态：

1. `src/router/index.ts` 顶部添加 `// @status: dormant` 注释及说明。
2. 创建 `src/router/README.md` 明示休眠原因和启用条件。
3. `scripts/check-dormant-modules.ts` 验证 dormant 模块不被业务代码 import。
4. 若未来引入路由，MUST 先发起 ADR，且 `ShellWorkbenchView.vue` MUST 同步拆解聚合职责（R-18.2.3）。

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 删除路由目录 | 可能破坏团队未来引入路由的参考基础；风险收益比不高 |
| 注册路由（hash 模式） | 引入 Vue Router 依赖但无实质路由需求；与 R-18.2.1 冲突 |
| 保留但不标注 | 继续存在误导隐患，违反 R-20.8.2 |

## 影响

- **正面**：消除误导；守卫脚本可检测意外 import；符合 R-18.2.2、R-20.8.2。
- **代价**：几乎无代价。
- **关联规则**：R-18.2.1、R-18.2.2、R-18.2.3、R-20.8.2
- **关联任务**：T-1.8

## 相关链接

- [AGENTS.md §18.2 路由策略](../../AGENTS.md)
- [AGENTS.md §20.8 死代码与结构漂移治理](../../AGENTS.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
