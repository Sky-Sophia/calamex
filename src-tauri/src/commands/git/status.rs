use super::*;
use super::cli;
use crate::commands::workspace_fs::workspace_name;
use gix::bstr::ByteSlice;

#[tauri::command]
pub fn get_git_repository_status(
    workspace_root_path: Option<String>,
) -> Result<GitRepositoryStatusPayload, String> {
    let workspace_root = resolve_git_workspace_root(workspace_root_path)?;
    match gix::discover(&workspace_root) {
        Ok(repository) => build_git_repository_status_payload(&repository),
        Err(_) => Ok(build_unavailable_git_status("当前工作区未检测到 Git 仓库。")),
    }
}

#[tauri::command]
pub fn init_git_repository(
    workspace_root_path: Option<String>,
) -> Result<GitRepositoryStatusPayload, String> {
    let workspace_root = resolve_git_workspace_root(workspace_root_path)?;
    match gix::open(&workspace_root) {
        Ok(repository) => build_git_repository_status_payload(&repository),
        Err(_) => {
            gix::init(&workspace_root).map_err(|e| format!("初始化 Git 仓库失败：{e}"))?;
            let repository = gix::open(&workspace_root).map_err(|e| format!("读取初始化后的 Git 仓库失败：{e}"))?;
            build_git_repository_status_payload(&repository)
        }
    }
}

#[tauri::command]
pub fn get_git_file_baseline(path: String) -> Result<GitFileBaselinePayload, String> {
    let file_path = normalize_path_for_git(Path::new(&path));
    let discovery_root = file_path.parent().unwrap_or(file_path.as_path());
    match gix::discover(discovery_root) {
        Ok(repository) => build_git_file_baseline_payload(&repository, &file_path),
        Err(_) => Ok(GitFileBaselinePayload {
            available: false, message: Some("当前文件不在 Git 仓库中。".into()),
            repository_root_path: None, file_path: path, relative_path: None,
            is_tracked: false, content: None,
        }),
    }
}

#[tauri::command]
pub fn stage_git_paths(payload: GitPathOperationRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;
    if pathspecs.is_empty() { return build_git_repository_status_payload(&repository); }
    let mut arg_list = vec!["add", "--"];
    let ps_refs: Vec<&str> = pathspecs.iter().map(|s| s.as_str()).collect();
    arg_list.extend_from_slice(&ps_refs);
    cli::run_git_ok(&repository_root, &arg_list, "暂存文件")?;
    build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn unstage_git_paths(payload: GitPathOperationRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;
    if pathspecs.is_empty() { return build_git_repository_status_payload(&repository); }
    let mut arg_list = vec!["reset", "-q", "--"];
    let ps_refs: Vec<&str> = pathspecs.iter().map(|s| s.as_str()).collect();
    arg_list.extend_from_slice(&ps_refs);
    cli::run_git_ok(&repository_root, &arg_list, "取消暂存")?;
    build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn commit_git_index(payload: GitCommitRequest) -> Result<GitCommitResultPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;
    let message = payload.message.trim();
    if message.is_empty() { return Err("Git 提交说明不能为空。".into()); }
    let mut arg_list = vec!["commit", "-m", message];
    if !pathspecs.is_empty() {
        arg_list.push("--");
        let ps_refs: Vec<&str> = pathspecs.iter().map(|s| s.as_str()).collect();
        arg_list.extend_from_slice(&ps_refs);
    }
    cli::run_git_ok(&repository_root, &arg_list, "提交")?;
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let commit_id = resolve_head_commit(&repository).ok().flatten().map(|commit| commit.id().to_string());
    let status = build_git_repository_status_payload(&repository)?;
    Ok(GitCommitResultPayload { status, commit_id })
}

#[tauri::command]
pub fn discard_git_paths(payload: GitPathOperationRequest) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;
    if pathspecs.is_empty() { return build_git_repository_status_payload(&repository); }
    let mut tracked_pathspecs: Vec<String> = Vec::new();
    for pathspec in &pathspecs {
        let relative_path = Path::new(pathspec);
        if is_tracked_git_path(&repository_root, relative_path)? {
            tracked_pathspecs.push(pathspec.clone());
        } else {
            // 未跟踪文件无法用 checkout 还原，直接从工作区删除。
            super::diff::remove_untracked_worktree_path(&repository_root, relative_path)?;
        }
    }
    if !tracked_pathspecs.is_empty() {
        let mut arg_list = vec!["checkout", "-q", "--"];
        let ps_refs: Vec<&str> = tracked_pathspecs.iter().map(|s| s.as_str()).collect();
        arg_list.extend_from_slice(&ps_refs);
        cli::run_git_ok(&repository_root, &arg_list, "放弃改动")?;
    }
    build_git_repository_status_payload(&repository)
}

/// 核心状态构建：通过 gix 读取 HEAD、领先/落后信息与文件状态，
/// 不再依赖系统安装的 git（免装目标）。
pub(super) fn build_git_repository_status_payload(
    repository: &Repository,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository_root = resolve_repository_root(repository)?;
    let status = build_git_status_via_gix(repository)?;

    let last_commit = resolve_head_commit(repository).ok().flatten().map(|c| build_git_commit_summary(&c));

    Ok(GitRepositoryStatusPayload {
        available: true, message: None,
        repository_root_path: Some(repository_root.to_string_lossy().to_string()),
        repository_name: Some(workspace_name(&repository_root)),
        git_dir_path: Some(repository.git_dir().to_string_lossy().to_string()),
        head_branch_name: status.head_branch,
        head_short_name: status.head_short_name,
        head_short_oid: status.head_oid.as_deref().map(|oid| oid.chars().take(7).collect::<String>()),
        is_detached: status.detached,
        is_clean: status.staged_count == 0 && status.unstaged_count == 0 && status.untracked_count == 0,
        ahead: status.ahead, behind: status.behind,
        staged_count: status.staged_count, unstaged_count: status.unstaged_count,
        untracked_count: status.untracked_count, conflicted_count: status.conflicted_count,
        files: status.files,
        last_commit,
    })
}

struct StatusAccum {
    head_branch: Option<String>,
    head_short_name: Option<String>,
    head_oid: Option<String>,
    detached: bool,
    ahead: usize,
    behind: usize,
    staged_count: usize,
    unstaged_count: usize,
    untracked_count: usize,
    conflicted_count: usize,
    files: Vec<GitFileStatusPayload>,
}

/// 通过 gix 的 status 迭代器构建状态，等价于
/// `git status --porcelain=v2 --branch --untracked-files=all --ignored=no`，避免依赖系统安装的 git。
fn build_git_status_via_gix(repository: &Repository) -> Result<StatusAccum, String> {
    let repository_root = resolve_repository_root(repository)?;

    let mut accum = StatusAccum {
        head_branch: None, head_short_name: None, head_oid: None, detached: false,
        ahead: 0, behind: 0,
        staged_count: 0, unstaged_count: 0, untracked_count: 0, conflicted_count: 0,
        files: Vec::new(),
    };

    // HEAD 信息。
    accum.head_oid = repository.head_id().ok().map(|id| id.detach().to_string());
    match repository.head_ref() {
        Ok(Some(reference)) => {
            let short = reference
                .name()
                .category_and_short_name()
                .map(|(_, short)| short.to_string());
            accum.head_branch = short.clone();
            accum.head_short_name = short;
            accum.detached = false;
        }
        // 无符号引用：detached HEAD（已有提交）或尚无提交的空仓库。
        Ok(None) => {
            accum.detached = accum.head_oid.is_some();
        }
        Err(_) => {}
    }

    // 领先/落后：复用 branches 中基于 gix 的修订遍历实现。
    if let Some(branch) = accum.head_short_name.as_deref() {
        let (ahead, behind) = super::branches::resolve_ahead_behind_cli(&repository_root, branch)?;
        accum.ahead = ahead;
        accum.behind = behind;
    }

    // 文件状态。
    let mut files: std::collections::BTreeMap<String, GitFileStatusPayload> =
        std::collections::BTreeMap::new();

    let iter = repository
        .status(gix::progress::Discard)
        .map_err(|error| format!("读取 Git 状态失败：{error}"))?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .into_iter(Vec::new())
        .map_err(|error| format!("枚举 Git 状态失败：{error}"))?;

    for item in iter {
        let item = item.map_err(|error| format!("读取 Git 状态条目失败：{error}"))?;
        let location = item.location().to_str_lossy().into_owned();
        match item {
            gix::status::Item::TreeIndex(change) => {
                apply_tree_index_change(&repository_root, &mut files, &location, &change);
            }
            gix::status::Item::IndexWorktree(change) => {
                apply_index_worktree_change(&repository_root, &mut files, &location, &change);
            }
        }
    }

    accum.files = files.into_values().collect();

    // 统计口径与原 porcelain v2 解析保持一致。
    for entry in &accum.files {
        if entry.index_status.as_deref() == Some("conflicted") {
            accum.conflicted_count += 1;
        } else if entry.index_status.is_some() {
            accum.staged_count += 1;
        }
        if entry.worktree_status.is_some() {
            accum.unstaged_count += 1;
        }
        if entry.is_untracked {
            accum.untracked_count += 1;
        }
    }

    Ok(accum)
}

fn build_status_paths(repository_root: &Path, rel: &str) -> (String, String, String) {
    let relative_path = Path::new(rel);
    let rps = path_to_forward_slashes(relative_path);
    let file_name = relative_path
        .file_name()
        .and_then(|v| v.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| rps.clone());
    let abs = repository_root.join(relative_path).to_string_lossy().to_string();
    (abs, rps, file_name)
}

fn status_entry_mut<'a>(
    repository_root: &Path,
    files: &'a mut std::collections::BTreeMap<String, GitFileStatusPayload>,
    rel: &str,
) -> &'a mut GitFileStatusPayload {
    let (abs, rps, file_name) = build_status_paths(repository_root, rel);
    files.entry(rps.clone()).or_insert_with(|| GitFileStatusPayload {
        path: abs,
        relative_path: rps,
        file_name,
        previous_path: None,
        previous_relative_path: None,
        index_status: None,
        worktree_status: None,
        is_conflicted: false,
        is_untracked: false,
    })
}

/// 暂存区相对 HEAD 树的变更（已暂存状态）。
fn apply_tree_index_change(
    repository_root: &Path,
    files: &mut std::collections::BTreeMap<String, GitFileStatusPayload>,
    location: &str,
    change: &gix::diff::index::ChangeRef<'_, '_>,
) {
    use gix::diff::index::ChangeRef;
    let entry = status_entry_mut(repository_root, files, location);
    // 冲突状态优先，不被暂存状态覆盖。
    if entry.index_status.as_deref() == Some("conflicted") {
        return;
    }
    match change {
        ChangeRef::Addition { .. } => {
            entry.index_status = Some("added".to_string());
        }
        ChangeRef::Deletion { .. } => {
            entry.index_status = Some("deleted".to_string());
        }
        ChangeRef::Modification { .. } => {
            entry.index_status = Some("modified".to_string());
        }
        ChangeRef::Rewrite { source_location, copy, .. } => {
            entry.index_status = Some(if *copy { "copied" } else { "renamed" }.to_string());
            let source = source_location.to_str_lossy().into_owned();
            let source_path = Path::new(&source);
            entry.previous_relative_path = Some(path_to_forward_slashes(source_path));
            entry.previous_path =
                Some(repository_root.join(source_path).to_string_lossy().to_string());
        }
    }
}

/// 索引相对工作区的变更（未暂存 / 未跟踪 / 冲突状态）。
fn apply_index_worktree_change(
    repository_root: &Path,
    files: &mut std::collections::BTreeMap<String, GitFileStatusPayload>,
    location: &str,
    change: &gix::status::index_worktree::Item,
) {
    use gix::status::index_worktree::iter::Summary;
    let summary = change.summary();
    let entry = status_entry_mut(repository_root, files, location);
    match summary {
        Some(Summary::Conflict) => {
            entry.index_status = Some("conflicted".to_string());
            entry.worktree_status = Some("conflicted".to_string());
            entry.is_conflicted = true;
        }
        Some(Summary::Added) => {
            // 工作区存在但索引中没有：未跟踪文件。
            entry.worktree_status = Some("untracked".to_string());
            entry.is_untracked = true;
        }
        Some(Summary::IntentToAdd) => {
            entry.worktree_status = Some("added".to_string());
        }
        Some(Summary::Removed) => {
            entry.worktree_status = Some("deleted".to_string());
        }
        Some(Summary::Modified) => {
            entry.worktree_status = Some("modified".to_string());
        }
        Some(Summary::TypeChange) => {
            entry.worktree_status = Some("typechange".to_string());
        }
        Some(Summary::Renamed) => {
            entry.worktree_status = Some("renamed".to_string());
        }
        Some(Summary::Copied) => {
            entry.worktree_status = Some("copied".to_string());
        }
        None => {}
    }
}

fn build_unavailable_git_status(message: &str) -> GitRepositoryStatusPayload {
    GitRepositoryStatusPayload {
        available: false, message: Some(message.into()),
        repository_root_path: None, repository_name: None, git_dir_path: None,
        head_branch_name: None, head_short_name: None, head_short_oid: None,
        is_detached: false, is_clean: true,
        ahead: 0, behind: 0,
        staged_count: 0, unstaged_count: 0, untracked_count: 0, conflicted_count: 0,
        files: Vec::new(), last_commit: None,
    }
}

fn build_git_file_baseline_payload(repository: &Repository, file_path: &Path) -> Result<GitFileBaselinePayload, String> {
    let repository_root = resolve_repository_root(repository)?;
    let relative_path = resolve_relative_path(&repository_root, file_path)?;
    let relative_path_string = path_to_forward_slashes(&relative_path);
    let is_tracked = is_tracked_git_path(&repository_root, &relative_path)?;
    if !is_tracked {
        return Ok(GitFileBaselinePayload {
            available: true, message: Some("当前文件未被 Git 跟踪。".into()),
            repository_root_path: Some(repository_root.to_string_lossy().to_string()),
            file_path: file_path.to_string_lossy().to_string(),
            relative_path: Some(relative_path_string), is_tracked: false, content: None,
        });
    }
    let object_spec = format!("HEAD:{relative_path_string}");
    let content = read_git_revision_text(&repository_root, &object_spec)?;
    Ok(GitFileBaselinePayload {
        available: true,
        message: if content.is_none() { Some("当前文件基线不是可直接比较的文本内容。".into()) } else { None },
        repository_root_path: Some(repository_root.to_string_lossy().to_string()),
        file_path: file_path.to_string_lossy().to_string(),
        relative_path: Some(relative_path_string), is_tracked: true, content,
    })
}

pub(super) fn is_tracked_git_path(repository_root: &Path, relative_path: &Path) -> Result<bool, String> {
    // 通过 gix 查询索引判断路径是否被 Git 跟踪（等价于 `git ls-files --error-unmatch`），避免依赖系统安装的 git。
    let repository = gix::open(repository_root)
        .map_err(|error| format!("打开 Git 仓库失败：{error}"))?;
    let index = repository
        .index_or_empty()
        .map_err(|error| format!("读取 Git 索引失败：{error}"))?;
    let rp = path_to_forward_slashes(relative_path);
    let path = gix::bstr::BStr::new(rp.as_bytes());
    Ok(index.entry_by_path(path).is_some())
}

pub(super) fn read_git_revision_text(repository_root: &Path, object_spec: &str) -> Result<Option<String>, String> {
    // 通过 gix 解析修订规格（如 `HEAD:path`）并读取 blob 内容（等价于 `git cat-file -p <spec>`），避免依赖系统安装的 git。
    let repository = gix::open(repository_root)
        .map_err(|error| format!("打开 Git 仓库失败：{error}"))?;
    let object_id = match repository.rev_parse_single(object_spec) {
        Ok(id) => id,
        Err(_) => return Ok(None),
    };
    let object = match repository.find_object(object_id) {
        Ok(object) => object,
        Err(_) => return Ok(None),
    };
    if object.kind != gix::objs::Kind::Blob {
        return Ok(None);
    }
    decode_script_bytes(&object.data)
        .map(|(c, _)| Some(c))
        .map_err(|_| "当前对象不是可直接比较的文本内容。".to_string())
}
