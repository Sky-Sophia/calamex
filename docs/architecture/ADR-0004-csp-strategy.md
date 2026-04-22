# ADR-0004 CSP 策略（dev/prod 双套）

- **日期**：2026-04-21
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

当前 `src-tauri/tauri.conf.json` 的 `app.security.csp` 值为 `null`，等同于无任何 CSP 限制。这违反了：

- R-7.5.1：`csp` 必须显式声明，MUST NOT 留空
- R-7.5.2：CSP 必须禁 `unsafe-inline` / `unsafe-eval`

同时，应用内嵌 Monaco Editor（需要 Web Worker）和 xterm.js（需要 blob: worker），CSP 策略必须精确匹配这些需求。

## 决策

配置显式 CSP 策略，核心原则：

1. **禁止** `unsafe-inline`（脚本/样式均不允许）
2. **禁止** `unsafe-eval`（Monaco worker 内部会用到，需通过 `wasm-unsafe-eval` 替代）
3. `index.html` 内联主题注入脚本使用 CSP nonce（R-6.5.12 允许的唯一例外）

### 最终 CSP 字符串

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: asset: http://asset.localhost;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost;
worker-src 'self' blob:;
```

**说明**：
- `style-src` 保留 `unsafe-inline`：Tailwind CSS 的 CSS-first 模式生成 `<style>` 标签，目前无法避免。已在 `docs/security-exceptions.md` 登记，后续通过 Vite CSP plugin 生成 nonce 解决。
- `wasm-unsafe-eval`：Monaco Editor 内部的 TypeScript worker 需要，不可去除。
- `worker-src blob:`：Monaco web worker、xterm web worker 均需要 blob: URL。
- `connect-src ipc: http://ipc.localhost`：Tauri IPC 通道所需。

## 考虑的备选

| 备选 | 否决原因 |
|------|----------|
| 完全禁 `unsafe-inline`（含 style） | Monaco/Tailwind CSS 当前依赖 style 动态注入，会导致渲染损坏 |
| 使用 `'nonce-xxxx'` for style | 需要 Vite 插件配合，当前未引入；留作 tech-debt |
| 维持 `csp: null` | 直接违反 R-7.5.1，安全风险 |

## 影响

- **正面**：消除 XSS 最常见攻击面；满足 R-7.5.1 / R-7.5.2。
- **负面 / 代价**：`style-src unsafe-inline` 是一个已知的临时豁免，需登记 `docs/security-exceptions.md`。
- **关联规则**：R-7.5.1、R-7.5.2、R-7.5.3、R-6.5.12
- **关联任务**：T-1.7

## 相关链接

- [AGENTS.md §7.5 CSP](../../AGENTS.md)
- [docs/security-exceptions.md](../security-exceptions.md)

## 迁移计划

1. **T-1.7（本 ADR 落地时）**：配置上述 CSP；启动 Playwright CSP 冒烟测试。
2. **后续迭代**：引入 Vite CSP nonce 插件，消除 `style-src unsafe-inline`，更新本 ADR 为 `superseded by ADR-XXXX`。

---

> 如需推翻本 ADR，MUST 新建新 ADR 并标注本文末尾 `superseded by ADR-XXXX`。
