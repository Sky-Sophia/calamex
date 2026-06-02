use super::*;
use gix::bstr::ByteSlice;

#[tauri::command]
pub fn list_git_stashes(payload: GitRepositoryRootRequest) -> Result<GitStashListPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;

    // 直接读取贮藏栈的 reflog（.git/logs/refs/stash），避免依赖系统安装的 git。
    // 该文件按追加顺序记录（最旧在前），stash@索引 0 为最新，因此倒序枚举。
    let reflog_path = repository.git_dir().join("logs").join("refs").join("stash");
    if !reflog_path.exists() {
        return Ok(GitStashListPayload { entries: Vec::new() });
    }
    let content = fs::read_to_string(&reflog_path)
        .map_err(|error| format!("读取贮藏 reflog 失败：{error}"))?;

    let lines: Vec<&str> = content.lines().filter(|line| !line.trim().is_empty()).collect();
    let mut entries = Vec::new();
    for (index, line) in lines.iter().rev().enumerate() {
        let line = *line;
        // 每行格式：<old> <new> <name> <email> <ts> <tz>\t<message>
        let (meta, message) = match line.split_once('\t') {
            Some(pair) => pair,
            None => continue,
        };
        let mut tokens = meta.split(' ');
        let _old = tokens.next();
        let new_oid = match tokens.next() {
            Some(value) => value,
            None => continue,
        };
        let oid: gix::ObjectId = match new_oid.parse() {
            Ok(value) => value,
            Err(_) => continue,
        };
        entries.push(build_git_stash_entry_payload(&repository, index, message.trim(), oid)?);
    }
    Ok(GitStashListPayload { entries })
}

#[tauri::command]
pub fn save_git_stash(payload: GitStashSaveRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let status = super::status::build_git_repository_status_payload(&repository)?;
    if status.is_clean {
        return Err("当前没有可贮藏的改动。".into());
    }
    if status.conflicted_count > 0 {
        return Err("存在冲突文件，解决冲突后再执行贮藏。".into());
    }

    // 贮藏需要基线提交（HEAD）；空仓库无法贮藏。
    let base_commit = resolve_head_commit(&repository)?
        .ok_or_else(|| "当前分支尚无提交，无法贮藏。".to_string())?;
    let base_oid = base_commit.id().detach();
    let base_short = short_commit_id(base_oid);
    let base_subject = base_commit
        .message()
        .ok()
        .map(|message| message.summary().to_str_lossy().into_owned())
        .unwrap_or_default();
    let base_subject = base_subject.trim();
    let branch_label = status
        .head_short_name
        .clone()
        .unwrap_or_else(|| "(no branch)".to_string());

    let signature = stash_commit_signature(&repository)?;
    let index = repository
        .open_index()
        .map_err(|error| format!("读取 Git 索引失败：{error}"))?;

    // 父提交 2：索引快照（已暂存内容的树）。
    let index_tree_id = build_index_tree(&repository, &index)?;
    let index_commit_message = format!("index on {branch_label}: {base_short} {base_subject}");
    let index_commit = write_stash_commit(
        &repository,
        index_tree_id,
        vec![base_oid],
        index_commit_message.trim(),
        &signature,
    )?;
    let mut parents = vec![base_oid, index_commit];

    // 父提交 3：未跟踪文件快照（仅 --include-untracked 且确有未跟踪文件时）。
    if payload.include_untracked {
        if let Some(untracked_tree_id) =
            build_untracked_tree(&repository, &repository_root, &status.files)?
        {
            let untracked_message =
                format!("untracked files on {branch_label}: {base_short} {base_subject}");
            let untracked_commit = write_stash_commit(
                &repository,
                untracked_tree_id,
                Vec::new(),
                untracked_message.trim(),
                &signature,
            )?;
            parents.push(untracked_commit);
        }
    }

    // 贮藏 WIP 提交：树为跟踪文件的工作区状态（索引树叠加未暂存改动）。
    let worktree_tree_id =
        build_worktree_tree(&repository, &repository_root, index_tree_id, &status.files)?;
    let wip_message = match payload
        .message
        .as_ref()
        .map(|message| message.trim())
        .filter(|message| !message.is_empty())
    {
        Some(custom) => format!("On {branch_label}: {custom}"),
        None => format!("WIP on {branch_label}: {base_short} {base_subject}"),
    };
    let wip_message = wip_message.trim();
    let wip_commit =
        write_stash_commit(&repository, worktree_tree_id, parents, wip_message, &signature)?;

    // 更新 refs/stash 与其 reflog（追加一条贮藏记录）。
    push_stash_reference(&repository, wip_commit, &signature, wip_message)?;

    // 重置工作区与索引回 HEAD，清理已被贮藏的改动。
    reset_worktree_and_index_to_head(
        &repository,
        &repository_root,
        &status.files,
        payload.include_untracked,
    )?;

    let repository = open_repository_from_root(&payload.repository_root_path)?;
    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn apply_git_stash(payload: GitStashApplyRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let label = if payload.pop { "应用并移除贮藏" } else { "应用贮藏" };
    // 要求工作区干净：此时工作区内容等同 HEAD 树，便于安全地做三方应用。
    super::branches::assert_repository_is_clean_for_switch(&repository, label)?;

    let stash_oid = resolve_stash_oid_by_index(&repository, payload.stash_index)?;
    let stash = stash_oid.to_string();
    // peel 到 tree 的修订语法需要字面花括号 "^{tree}"，用字符串拼接构造。
    let worktree_tree_id = repository
        .rev_parse_single([stash.as_str(), "^{tree}"].concat().as_str())
        .map_err(|error| format!("解析贮藏树失败：{error}"))?
        .detach();
    let base_tree_id = repository
        .rev_parse_single([stash.as_str(), "^1^{tree}"].concat().as_str())
        .map_err(|error| format!("解析贮藏基线树失败：{error}"))?
        .detach();
    let untracked_tree_id = repository
        .rev_parse_single([stash.as_str(), "^3^{tree}"].concat().as_str())
        .ok()
        .map(|id| id.detach());

    let head_tree = repository
        .head_tree()
        .map_err(|error| format!("读取 HEAD 树失败：{error}"))?;

    let base_tree = repository
        .find_tree(base_tree_id)
        .map_err(|error| format!("读取贮藏基线树失败：{error}"))?;
    let new_tree = repository
        .find_tree(worktree_tree_id)
        .map_err(|error| format!("读取贮藏树失败：{error}"))?;
    let changes = repository
        .diff_tree_to_tree(Some(&base_tree), Some(&new_tree), None)
        .map_err(|error| format!("计算贮藏差异失败：{error}"))?;

    // 应用计划：对每个跟踪文件做 base/HEAD/贮藏 三方判断，冲突则记录、整体中止。
    enum PlannedChange {
        Upsert(String, gix::ObjectId, gix::index::entry::Mode),
        Delete(String),
    }
    let mut planned: Vec<PlannedChange> = Vec::new();
    let mut conflicts: Vec<String> = Vec::new();

    use gix::diff::tree_with_rewrites::Change;
    for change in changes {
        let (location, base_id, stash_id, entry_mode) = match change {
            Change::Addition { location, id, entry_mode, .. } => (location, None, Some(id), entry_mode),
            Change::Deletion { location, id, entry_mode, .. } => (location, Some(id), None, entry_mode),
            Change::Modification { location, previous_id, id, entry_mode, .. } => {
                (location, Some(previous_id), Some(id), entry_mode)
            }
            Change::Rewrite { location, source_id, id, entry_mode, .. } => {
                (location, Some(source_id), Some(id), entry_mode)
            }
        };
        if entry_mode.is_tree() || entry_mode.is_commit() {
            continue;
        }
        let relative_path = location.to_str_lossy().into_owned();
        // 工作区已干净 → 当前内容等同 HEAD 树中的版本。
        let head_id = {
            let mut tree = head_tree.clone();
            tree.peel_to_entry_by_path(Path::new(&relative_path))
                .ok()
                .flatten()
                .map(|entry| entry.id().detach())
        };
        if head_id == base_id {
            // 该文件自贮藏以来未变，可干净应用贮藏版本。
            match stash_id {
                Some(id) => {
                    let mode = if entry_mode.is_link() {
                        gix::index::entry::Mode::SYMLINK
                    } else if entry_mode.is_executable() {
                        gix::index::entry::Mode::FILE_EXECUTABLE
                    } else {
                        gix::index::entry::Mode::FILE
                    };
                    planned.push(PlannedChange::Upsert(relative_path, id, mode));
                }
                None => planned.push(PlannedChange::Delete(relative_path)),
            }
        } else if head_id == stash_id {
            // 当前已是贮藏后的内容，无需重复应用。
        } else {
            conflicts.push(relative_path);
        }
    }

    // 未跟踪文件：空树 → 未跟踪树的新增；工作区已存在同名文件则视为冲突。
    let mut untracked_plan: Vec<(String, gix::ObjectId, gix::index::entry::Mode)> = Vec::new();
    if let Some(untracked_id) = untracked_tree_id {
        let empty_tree = repository.empty_tree();
        let untracked_tree = repository
            .find_tree(untracked_id)
            .map_err(|error| format!("读取贮藏未跟踪树失败：{error}"))?;
        let untracked_changes = repository
            .diff_tree_to_tree(Some(&empty_tree), Some(&untracked_tree), None)
            .map_err(|error| format!("计算贮藏未跟踪差异失败：{error}"))?;
        for change in untracked_changes {
            if let Change::Addition { location, id, entry_mode, .. } = change {
                if entry_mode.is_tree() || entry_mode.is_commit() {
                    continue;
                }
                let relative_path = location.to_str_lossy().into_owned();
                let absolute_path = repository_root.join(Path::new(&relative_path));
                if path_exists_in_worktree(&absolute_path) {
                    conflicts.push(