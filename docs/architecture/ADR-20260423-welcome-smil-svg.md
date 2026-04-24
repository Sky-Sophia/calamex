# ADR-20260423-welcome-smil-svg

- **日期**：2026-04-23
- **状态**：`accepted`
- **决策者**：@xiaojianc
- **Supersedes**：ADR-0006（仅限欢迎页启动路径）

---

## Status

`accepted`

## Context

当前仓库仍使用旧的 bootstrap/splash 方案，存在以下问题：

1. 欢迎视觉与最新设计稿不一致，未采用指定的 Linear Isometric SVG。
2. 旧方案依赖代码打字动画，不满足本任务对原生 SMIL SVG 的要求。
3. 主题、背景色与欢迎页视觉并非严格同色，存在冷启动闪底与切换闪烁风险。
4. 仓库此前依据 ADR-0006 保持 router dormant，但本次欢迎页替换明确要求 `/welcome` 作为启动路由；若直接把整个工作台塞进 `<RouterView>`，又会违反 `App.vue` 作为窗口生命周期唯一协调器的约束。

因此，本次需要在不改动 Rust 启动主流程真源的前提下，落地一个“受限启用”的欢迎页路由：路由只负责欢迎页 overlay 与主题切换，工作台预挂载、ready handoff、窗口阶段切换仍由 `App.vue` 协调。

## Decision

1. 欢迎页改为内联 `?raw` 注入的本地 SVG，保留 Chromium/WebView2 原生 SMIL 播放，不引入 Lottie、视频或 iframe。
2. 启用受限 Vue Router：
   - `/welcome`：欢迎页路由；
   - `/home`：工作台路由锚点；
   - `App.vue` 继续负责工作台预挂载、`app-ready` 事件分发、主窗口 reveal 与 loading/error 兜底。
3. 主题策略采用双层兜底：
   - `index.html` 在 Vue 挂载前同步写入 `data-theme="dark"` 与深色背景；
   - 路由守卫在进入 `/welcome` 时强制 dark，离开后恢复 ThemeManager 当前模式。
4. 字体改为本地 `InterVariable.woff2`，消除 `rsms.me` 外网依赖。
5. 欢迎页使用 5 秒超时 + `app-ready` 事件双通道退出，避免无限循环造成“卡死”感知。

## Consequences

### 正面影响

- 欢迎页视觉与设计稿一致，且保留原始 SMIL 动画效果。
- 冷启动、欢迎页、主工作台切换时背景统一为 `#08090A`，可显著降低闪黑/闪白感知。
- 字体与 SVG 资源全部本地化，断网启动仍可保持一致视觉。
- 路由能力被限制在欢迎页场景内，不把工作台生命周期控制权从 `App.vue` 转移出去。

### 代价与风险

- **RISK-W-01**：Chromium 长期存在 SMIL 弃用讨论；当前 WebView2 仍支持，但后续需持续跟踪。
- **RISK-W-02**：`?raw` 内联 SVG 会增加首屏 chunk 体积，但对当前欢迎页资源量可接受。
- **RISK-W-03**：若未来把 SVG 文案改为中文，需要补齐中文字体策略，否则 fallback 字体可能破坏版式。
- **RISK-W-04**：高 DPI 下若 SMIL 性能低于 50 FPS，需要暂停合入并评估降载或迁移方案。

## Alternatives Considered

1. **独立 HWND splash + 预渲 WebM**：窗口、资源、同步与回收链路更复杂，体积更大；对可循环欢迎页不划算，否决。
2. **Lottie 迁移**：需要美术重做与动画资产转换，改造成本远高于直接使用现成 SVG，否决。
3. **第二个 WebView2 窗口**：会重新引入 WebView2 冷启动与窗口同步问题，与本任务“减少首屏抖动”的目标相悖，否决。
4. **继续保持 router dormant，只在 App.vue 内硬编码欢迎页状态机**：虽然可以工作，但无法满足 `/welcome` 作为明确启动路由与主题短路入口的需求，否决。

## Related Links

- [AGENTS.md](../../AGENTS.md)
- [欢迎页替换任务书](../../code_agent.md)
- [ADR-0006-router-dormant](./ADR-0006-router-dormant.md)
- [ADR-20260423-vendor-wry-visual-hosting](./ADR-20260423-vendor-wry-visual-hosting.md)

---

> 如需推翻本 ADR，MUST 新建新 ADR 并在本文末尾标注 `superseded by ADR-XXXX`，禁止就地重写历史决策。
