# ADR-20260513 AED 纯 Rust 基础设施选型

- **日期**：2026-05-13
- **状态**：`accepted`
- **决策者**：@xiaojianc

---

## 背景

`ADR-20260428 Agent 自动编辑与可回滚体系` 已确定 AED 负责 AI 自动写盘、快照、审计和多粒度回滚。第一版实现保留了较多手写逻辑：

- `ai_patch::apply_file_patch` 只按 `+` / `-` / 空格行重建结果，缺少标准 unified diff 语义。
- `ai_edit::diff_render` 自写 LCS 与 hunk 反向应用，遇到大文件、病态输入、无末尾换行等边界时风险较高。
- journal、blob 存储、原子写、多文件事务、路径沙箱仍主要依赖手写约束，后续需要统一收敛到成熟 Rust 组件。

目标是在不牺牲 AED 授权、审计、快照和回滚边界的前提下，逐步替换手写基础设施，做到纯 Rust、crash-safe、跨平台一致、零 C 依赖，并明确区分：

- **核心层（数据安全）**：写盘事务、WAL、快照、OCC、路径沙箱。
- **进程层（UX）**：进度展示、冲突提示、pin 操作、清理策略可视化。

## 决策

### 1. Diff / Patch 引擎

采用 `diffy-imara = 0.3.2`，替换手写 diff / patch 应用核心逻辑。

- License：MIT OR Apache-2.0。
- `diffy-imara` 是 `diffy` unified diff API 与 `imara-diff` backend 的结合，默认 Histogram 算法。
- AED 只接受标准 unified hunk body。旧的“仅列出 `-old` / `+new` 且缺少无末尾换行标记”的 legacy payload 不再兼容。
- `apply_patch`、hunk diff 渲染、hunk 反向应用均必须通过 `diffy-imara`。

### 2. Journal / WAL

后续采用 `fjall >= 3.0` 作为 AED journal 与小 blob 存储底座。

- License：MIT OR Apache-2.0。
- 当前核验版本：`3.1.4`，Rust MSRV 为 `1.90.0`；本机工具链 `rustc 1.95.0` 满足。
- 使用多 partition 区分 operations、snapshots、blobs、gc-index 等域。
- 迁移时必须提供旧 NDJSON journal 的一次性导入或兼容读取策略。

### 3. Blob 与哈希

采用 `blake3` 作为内容哈希、OCC 校验和 CAS key。

- License：CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception。
- 小文件（默认 `<= 256 KiB`）写入 `fjall` 的 blobs partition。
- 大文件写入分片目录，例如 `~/.aster/blobs/<hash[0..2]>/<hash[2..]>`，`fjall` 仅保存索引引用。

### 4. 原子写与多文件事务

单文件原子写采用 `atomic-write-file`。

- 当前核验版本：`0.3.0`。
- License：BSD-3-Clause。
- 用于替代手写 tmp + rename + fsync 流程。

多文件批量事务采用 `fjall` batch + staging 目录 + 顺序 rename + 父目录 fsync 的二阶段提交：

1. 写 `prepared` journal。
2. 写所有 staging 文件并 fsync。
3. 标记 `committed`。
4. 顺序 rename 到目标路径并 fsync 父目录。
5. 标记 `done`。

进程重启后的 crash recovery 必须按 journal 状态执行 redo / discard，且写入前对每个目标文件执行 OCC 校验。

### 5. 路径、安全与并发

- Protected path：继续使用 `globset`，按需结合 `ignore` 处理 `.gitignore` 语义。
- 文件系统沙箱：采用 `cap-std`；Linux 可选叠加 `landlock-rs`。
- 路径类型：采用 `normpath` + `camino`，统一 Windows / macOS / Linux 路径规范化与 UTF-8 路径表达。
- 多进程互斥：采用 Rust stdlib `File::try_lock` / `File::try_lock_shared` 锁定 `~/.aster/<project-hash>/journal.lock`。同项目锁竞争失败时，写入必须显式报错；只读路径可拿 shared lock，但不能绕过正在进行的写入。

### 6. 保留策略与 GC

保留策略使用现实时间，不使用运行时长或会话时长：

- 14 天内：保留完整 before / after blob，支持一键回滚。
- 14 天后：未 pin 的记录可降级为 diff 文本 + 元数据。
- 30 天后：未 pin 的记录只保留元数据。
- pin 的节点最多完整保留 30 天；超过 30 天仍会清理完整 blob，只保留元数据。
- 默认总配额 1 GiB；超过配额时按 LRU 淘汰最老、未 pin、可降级的 blob。

pin 属于进程层 UX。UI 应在 AI 回复 diff 预览区域提供符合语义的 lucide 图标按钮，状态与操作必须通过 AED service / IPC 进入 Rust 层，组件不得直接写存储。

## 分阶段落地

### 阶段 1：Patch 引擎替换

- 引入 `diffy-imara`。
- 删除 legacy patch payload 兼容。
- `propose_patch` 与 AED diff preview 均产出标准 unified hunk。
- `apply_patch` 与 `revert_hunk` 均通过 `diffy-imara` 应用 patch。

### 阶段 2：哈希与 OCC

- 引入 `blake3`。
- 替换现有 FNV64 内容 hash。
- 写前记录并校验 `(mtime, blake3)` baseline。
- 冲突时返回明确 `StaleFileError` / 项目约定错误码。

### 阶段 3：Journal / Blob 存储

- 引入 `fjall`。
- 迁移 operation journal 与 snapshot manifest。
- 小 blob 进入 `fjall` partition，大 blob 进入 CAS 分片目录。

### 阶段 4：进程级存储锁

- 使用 Rust stdlib `File::try_lock` / `File::try_lock_shared`，不再引入额外锁依赖。
- 所有 AED journal / snapshot / blob 访问进入 `fjall` 前必须先拿 `journal.lock`。
- 写入、裁剪使用 non-blocking exclusive lock；列表、加载使用 non-blocking shared lock。
- 锁竞争失败时返回 `AI_EDIT_STORAGE_LOCKED`，不得静默降级或阻塞 UI。

### 阶段 5：Crash-safe 写盘事务

- 引入 `atomic-write-file`。
- 实现单文件原子写。
- AED 自动写盘 create / modify / delete / rename 通过 `file_transactions` journal + staging 目录二阶段提交。
- `prepared` 状态崩溃后丢弃 staging；`committed` 状态崩溃后重放文件动作并幂等补写 operation journal；完成后标记 `done`。
- AI Edit 命令入口在读写前触发 pending transaction recovery。

### 阶段 6：路径沙箱与 GC / Pin UX

- 引入 `cap-std`、`normpath`、`camino`。
- 实现 pin、现实时间 TTL、配额清理。
- 前端通过 AED service 暴露 pin / unpin，不直接写本地存储。

## 影响

- **正面**：减少手写 diff / patch / WAL / 原子写 / 路径安全逻辑，提升大文件和边界输入稳定性。
- **代价**：新增多项 Rust 依赖，需要逐阶段 ADR 对齐、迁移测试和回滚预案。
- **风险**：`fjall` 与 `atomic-write-file` 会改变核心数据持久化路径，必须单独实施，不能与 UI 改动混在同一 PR。

## 当前落地状态

截至 2026-05-13，已落地：

- 阶段 1：`diffy-imara` 替换 AED patch/diff/hunk 反向应用。
- 阶段 2：`blake3` 替换 AED 内容 hash；`apply_patch` 与 `auto_apply` 写盘链路按 `(mtime, blake3)` 执行 OCC。
- 阶段 3：`fjall` 替换 AED operation journal 与小 snapshot blob 存储；大 blob 走 blake3 CAS 分片目录。
- 阶段 4：stdlib `File::try_lock` / `File::try_lock_shared` 为 AED 存储根目录增加 `journal.lock` 进程级互斥；写路径 exclusive lock，读路径 shared lock。
- 阶段 5：`atomic-write-file = 0.3.0` 替换 AED 文本写回与 CAS 大 blob 写入中的直接 `fs::write`；AED 自动写盘接入 `file_transactions` journal + staging 目录二阶段提交，并在命令入口执行 pending transaction recovery。

其余阶段尚未实施。

## 相关链接

- [ADR-20260428-agent-auto-edit-and-rollback.md](./ADR-20260428-agent-auto-edit-and-rollback.md)
- [AGENTS.md](../../AGENTS.md)
