# 故障响应手册（Incident Runbook）

> 按 R-13.6.2：P0/P1 响应流程 MUST 明确于本文件。

---

## 严重级别定义

| 级别 | 标准 | 响应时间 | 负责人 |
|---|---|---|---|
| P0 | 应用完全不可用 / 数据丢失 / 安全漏洞利用 | 立即 | xiaojianc |
| P1 | 关键功能不可用（终端/编辑/Git 之一） | 2 小时 | xiaojianc |
| P2 | 次要功能降级，有可用替代方案 | 24 小时 | xiaojianc |
| P3 | 体验类问题，不影响核心功能 | 下个版本 | xiaojianc |

---

## P0 响应步骤

1. **确认影响范围**：确定受影响版本号与平台
2. **触发回滚**：参见[回滚流程](#回滚流程)
3. **通知**：在内部渠道发布初始状态更新
4. **根因分析**：收集崩溃日志 / 错误监控数据
5. **修复验证**：Cherry-pick 修复到 `release/*` 分支，重跑 CI
6. **发版**：推送 patch 版本，更新 release notes
7. **事后复盘**：5 工作日内完成 blameless postmortem → [incident-log.md](./incident-log.md)

---

## 回滚流程

```bash
# 1. 确认上一稳定版本 tag
git tag --sort=-version:refname | head -5

# 2. 下载对应 CI 产物（或从 release 页面获取）
# 3. 分发给受影响用户（通过应用内更新机制 / 手动分发）
# 4. 在 release 页面将当前版本标记为 yanked
```

> Tauri updater 签名校验见 ADR-0002（depedency baseline）中的自动更新节。

---

## 常见故障排查

### 启动黑屏 / 白屏

1. 查看 Tauri webview 日志
2. 检查 `index.html` CSP 是否阻拦资源
3. 检查 Rust `apply_window_stage` 命令是否超时
4. 参见 ADR-0001（启动链路单源化）

### 终端会话无法创建

1. 检查 `src-tauri/capabilities/terminal.json` 权限
2. 检查 PTY 资源是否已耗尽（上一实例未正常关闭）
3. 查看 `ensure_terminal_session` Rust 日志

### ShellCheck / shfmt 不工作

1. 确认工具已安装：`shellcheck --version` / `shfmt --version`
2. 检查 `capabilities/script-toolchain.json`
3. 查看 `analyze_script` / `format_script` 命令错误码

---

## 事故复盘模板

参见 [incident-log.md](./incident-log.md)。
