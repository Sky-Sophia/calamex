use super::{decode_script_bytes, resolve_workspace_root, workspace_name};
use chrono::{TimeZone, Utc};
use git2::{BranchType, ErrorCode, ObjectType, Repository, Status, StatusEntry, StatusOptions};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummaryPayload {
    id: String,
    short_id: String,
    summary: String,
    author_name: String,
    authored_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatusPayload {
    path: String,
    relative_path: String,
    file_name: String,
    previous_path: Option<String>,
    previous_relative_path: Option<String>,
    index_status: Option<String>,
    worktree_status: Option<String>,
    is_conflicted: bool,
    is_untracked: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryStatusPayload {
    available: bool,
    message: Option<String>,
    repository_root_path: Option<String>,
    repository_name: Option<String>,
    git_dir_path: Option<String>,
    head_branch_name: Option<String>,
    head_short_name: Option<String>,
    head_short_oid: Option<String>,
    is_detached: bool,
    is_clean: bool,
    ahead: usize,
    behind: usize,
    staged_count: usize,
    unstaged_count: usize,
    untracked_count: usize,
    conflicted_count: usize,
    files: Vec<GitFileStatusPayload>,
    last_commit: Option<GitCommitSummaryPayload>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileBaselinePayload {
    available: bool,
    message: Option<String>,
    repository_root_path: Option<String>,
    file_path: String,
    relative_path: Option<String>,
    is_tracked: bool,
    content: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResultPayload {
    status: GitRepositoryStatusPayload,
    commit: GitCommitSummaryPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathOperationRequest {
    repository_root_path: String,
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    repository_root_path: String,
    message: String,
}

#[tauri::command]
pub fn get_git_repository_status(
    workspace_root_path: Option<String>,
) -> Result<GitRepositoryStatusPayload, String> {
    let workspace_root = resolve_workspace_root(workspace_root_path)?;

    match Repository::discover(&workspace_root) {
        Ok(repository) => build_git_repository_status_payload(&repository),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(build_unavailable_git_status(
            "当前工作区未检测到 Git 仓库。",
        )),
        Err(error) => Err(format!("读取 Git 仓库状态失败：{error}")),
    }
}

#[tauri::command]
pub fn init_git_repository(
    workspace_root_path: Option<String>,
) -> Result<GitRepositoryStatusPayload, String> {
    let workspace_root = resolve_workspace_root(workspace_root_path)?;

    match Repository::discover(&workspace_root) {
        Ok(repository) => build_git_repository_status_payload(&repository),
        Err(error) if error.code() == ErrorCode::NotFound => {
            Repository::init(&workspace_root)
                .map_err(|init_error| format!("初始化 Git 仓库失败：{init_error}"))?;

            let repository = Repository::open(&workspace_root)
                .map_err(|open_error| format!("读取初始化后的 Git 仓库失败：{open_error}"))?;

            build_git_repository_status_payload(&repository)
        }
        Err(error) => Err(format!("初始化 Git 仓库失败：{error}")),
    }
}

#[tauri::command]
pub fn get_git_file_baseline(path: String) -> Result<GitFileBaselinePayload, String> {
    let file_path = PathBuf::from(&path);
    let discovery_root = file_path.parent().unwrap_or(file_path.as_path());

    match Repository::discover(discovery_root) {
        Ok(repository) => build_git_file_baseline_payload(&repository, &file_path),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(GitFileBaselinePayload {
            available: false,
            message: Some("当前文件不在 Git 仓库中。".into()),
            repository_root_path: None,
            file_path: path,
            relative_path: None,
            is_tracked: false,
            content: None,
        }),
        Err(error) => Err(format!("读取 Git 文件基线失败：{error}")),
    }
}

#[tauri::command]
pub fn stage_git_paths(
    payload: GitPathOperationRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;

    if pathspecs.is_empty() {
        return build_git_repository_status_payload(&repository);
    }

    let mut index = repository
        .index()
        .map_err(|error| format!("读取 Git 索引失败：{error}"))?;

    for pathspec in &pathspecs {
        let relative_path = Path::new(pathspec);
        let file_status = repository
            .status_file(relative_path)
            .map_err(|error| format!("读取 Git 文件状态失败：{error}"))?;

        if file_status.contains(Status::WT_DELETED) || file_status.contains(Status::INDEX_DELETED) {
            match index.remove_path(relative_path) {
                Ok(_) => {}
                Err(error) if error.code() == ErrorCode::NotFound => {}
                Err(error) => return Err(format!("暂存 Git 变更失败：{error}")),
            }
            continue;
        }

        index
            .add_path(relative_path)
            .map_err(|error| format!("暂存 Git 变更失败：{error}"))?;
    }

    index
        .write()
        .map_err(|error| format!("写入 Git 索引失败：{error}"))?;

    build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn unstage_git_paths(
    payload: GitPathOperationRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let pathspecs = resolve_pathspecs(&repository_root, &payload.paths)?;

    if pathspecs.is_empty() {
        return build_git_repository_status_payload(&repository);
    }

    if let Some(head_object) = resolve_head_object(&repository)? {
        repository
            .reset_default(Some(&head_object), pathspecs.iter().map(String::as_str))
            .map_err(|error| format!("取消暂存 Git 变更失败：{error}"))?;
    } else {
        let mut index = repository
            .index()
            .map_err(|error| format!("读取 Git 索引失败：{error}"))?;

        for pathspec in &pathspecs {
            match index.remove_path(Path::new(pathspec)) {
                Ok(_) => {}
                Err(error) if error.code() == ErrorCode::NotFound => {}
                Err(error) => return Err(format!("取消暂存 Git 变更失败：{error}")),
            }
        }

        index
            .write()
            .map_err(|error| format!("写入 Git 索引失败：{error}"))?;
    }

    build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn commit_git_index(payload: GitCommitRequest) -> Result<GitCommitResultPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let message = payload.message.trim();

    if message.is_empty() {
        return Err("提交说明不能为空。".into());
    }

    let status = build_git_repository_status_payload(&repository)?;
    if status.staged_count == 0 {
        return Err("当前没有已暂存的 Git 变更。".into());
    }

    let signature = repository.signature().map_err(|error| {
        format!("读取 Git 提交身份失败：{error}。请先配置 user.name 和 user.email。")
    })?;

    let mut index = repository
        .index()
        .map_err(|error| format!("读取 Git 索引失败：{error}"))?;
    index
        .write()
        .map_err(|error| format!("写入 Git 索引失败：{error}"))?;

    let tree_id = index
        .write_tree()
        .map_err(|error| format!("写入 Git 树对象失败：{error}"))?;
    let tree = repository
        .find_tree(tree_id)
        .map_err(|error| format!("读取 Git 树对象失败：{error}"))?;
    let parent_commit = resolve_head_commit(&repository)?;

    let commit_id = if let Some(parent) = parent_commit.as_ref() {
        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &[parent],
            )
            .map_err(|error| format!("创建 Git 提交失败：{error}"))?
    } else {
        repository
            .commit(Some("HEAD"), &signature, &signature, message, &tree, &[])
            .map_err(|error| format!("创建 Git 提交失败：{error}"))?
    };

    let commit = repository
        .find_commit(commit_id)
        .map_err(|error| format!("读取新提交失败：{error}"))?;

    Ok(GitCommitResultPayload {
        status: build_git_repository_status_payload(&repository)?,
        commit: build_git_commit_summary(&commit),
    })
}

fn open_repository_from_root(repository_root_path: &str) -> Result<Repository, String> {
    Repository::discover(repository_root_path)
        .map_err(|error| format!("读取 Git 仓库失败：{error}"))
}

fn build_unavailable_git_status(message: &str) -> GitRepositoryStatusPayload {
    GitRepositoryStatusPayload {
        available: false,
        message: Some(message.into()),
        repository_root_path: None,
        repository_name: None,
        git_dir_path: None,
        head_branch_name: None,
        head_short_name: None,
        head_short_oid: None,
        is_detached: false,
        is_clean: true,
        ahead: 0,
        behind: 0,
        staged_count: 0,
        unstaged_count: 0,
        untracked_count: 0,
        conflicted_count: 0,
        files: Vec::new(),
        last_commit: None,
    }
}

fn build_git_repository_status_payload(
    repository: &Repository,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository_root = resolve_repository_root(repository)?;
    let git_dir_path = repository
        .path()
        .canonicalize()
        .unwrap_or_else(|_| repository.path().to_path_buf());
    let head_commit = resolve_head_commit(repository)?;
    let head_branch_name = resolve_head_branch_name(repository)?;
    let is_detached = resolve_head_detached(repository)?;
    let head_short_oid = head_commit
        .as_ref()
        .map(|commit| short_commit_id(commit.id()));
    let head_short_name = if is_detached {
        head_short_oid.clone()
    } else {
        head_branch_name.clone()
    };
    let (ahead, behind) = resolve_ahead_behind(repository, head_branch_name.as_deref())?;

    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .include_ignored(false)
        .include_unmodified(false)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .exclude_submodules(true);

    let statuses = repository
        .statuses(Some(&mut status_options))
        .map_err(|error| format!("读取 Git 文件状态失败：{error}"))?;

    let mut files = Vec::new();
    for entry in statuses.iter() {
        if let Some(file_status) = build_git_file_status_payload(&repository_root, entry)? {
            files.push(file_status);
        }
    }

    files.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| left.path.cmp(&right.path))
    });

    let staged_count = files
        .iter()
        .filter(|item| item.index_status.is_some() && !item.is_conflicted)
        .count();
    let unstaged_count = files
        .iter()
        .filter(|item| {
            item.worktree_status
                .as_deref()
                .is_some_and(|status| status != "untracked")
                && !item.is_conflicted
        })
        .count();
    let untracked_count = files.iter().filter(|item| item.is_untracked).count();
    let conflicted_count = files.iter().filter(|item| item.is_conflicted).count();

    Ok(GitRepositoryStatusPayload {
        available: true,
        message: None,
        repository_root_path: Some(repository_root.to_string_lossy().to_string()),
        repository_name: Some(workspace_name(&repository_root)),
        git_dir_path: Some(git_dir_path.to_string_lossy().to_string()),
        head_branch_name,
        head_short_name,
        head_short_oid,
        is_detached,
        is_clean: staged_count == 0
            && unstaged_count == 0
            && untracked_count == 0
            && conflicted_count == 0,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        conflicted_count,
        files,
        last_commit: head_commit.as_ref().map(build_git_commit_summary),
    })
}

fn build_git_file_baseline_payload(
    repository: &Repository,
    file_path: &Path,
) -> Result<GitFileBaselinePayload, String> {
    let repository_root = resolve_repository_root(repository)?;
    let relative_path = resolve_relative_path(&repository_root, file_path)?;
    let relative_path_string = path_to_forward_slashes(&relative_path);
    let head_commit = resolve_head_commit(repository)?;

    let Some(commit) = head_commit else {
        return Ok(GitFileBaselinePayload {
            available: true,
            message: None,
            repository_root_path: Some(repository_root.to_string_lossy().to_string()),
            file_path: file_path.to_string_lossy().to_string(),
            relative_path: Some(relative_path_string),
            is_tracked: false,
            content: None,
        });
    };

    let tree = commit
        .tree()
        .map_err(|error| format!("读取 Git 基线树失败：{error}"))?;

    let tree_entry = match tree.get_path(&relative_path) {
        Ok(entry) => entry,
        Err(error) if error.code() == ErrorCode::NotFound => {
            return Ok(GitFileBaselinePayload {
                available: true,
                message: None,
                repository_root_path: Some(repository_root.to_string_lossy().to_string()),
                file_path: file_path.to_string_lossy().to_string(),
                relative_path: Some(relative_path_string),
                is_tracked: false,
                content: None,
            })
        }
        Err(error) => return Err(format!("读取 Git 基线路径失败：{error}")),
    };

    let object = tree_entry
        .to_object(repository)
        .map_err(|error| format!("读取 Git 基线对象失败：{error}"))?;

    if object.kind() != Some(ObjectType::Blob) {
        return Ok(GitFileBaselinePayload {
            available: true,
            message: Some("当前文件不是可比较的文本 Blob。".into()),
            repository_root_path: Some(repository_root.to_string_lossy().to_string()),
            file_path: file_path.to_string_lossy().to_string(),
            relative_path: Some(relative_path_string),
            is_tracked: true,
            content: None,
        });
    }

    let blob = object
        .as_blob()
        .ok_or_else(|| "读取 Git 基线 Blob 失败。".to_string())?;
    let content = match decode_script_bytes(blob.content()) {
        Ok((content, _)) => Some(content),
        Err(_) => None,
    };

    Ok(GitFileBaselinePayload {
        available: true,
        message: if content.is_none() {
            Some("当前文件基线不是可直接比较的文本内容。".into())
        } else {
            None
        },
        repository_root_path: Some(repository_root.to_string_lossy().to_string()),
        file_path: file_path.to_string_lossy().to_string(),
        relative_path: Some(relative_path_string),
        is_tracked: true,
        content,
    })
}

fn build_git_file_status_payload(
    repository_root: &Path,
    entry: StatusEntry<'_>,
) -> Result<Option<GitFileStatusPayload>, String> {
    let status = entry.status();
    if status.is_empty() {
        return Ok(None);
    }

    let relative_path =
        resolve_status_path(&entry).ok_or_else(|| "解析 Git 变更路径失败。".to_string())?;
    let previous_relative_path = resolve_previous_status_path(&entry, &relative_path);
    let index_status = map_index_status(status).map(str::to_string);
    let worktree_status = map_worktree_status(status).map(str::to_string);
    let absolute_path = repository_root.join(&relative_path);
    let file_name = relative_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path_to_forward_slashes(&relative_path));

    Ok(Some(GitFileStatusPayload {
        path: absolute_path.to_string_lossy().to_string(),
        relative_path: path_to_forward_slashes(&relative_path),
        file_name,
        previous_path: previous_relative_path
            .as_ref()
            .map(|value| repository_root.join(value).to_string_lossy().to_string()),
        previous_relative_path: previous_relative_path
            .as_ref()
            .map(|value| path_to_forward_slashes(value)),
        index_status,
        worktree_status,
        is_conflicted: status.contains(Status::CONFLICTED),
        is_untracked: status.contains(Status::WT_NEW),
    }))
}

fn resolve_repository_root(repository: &Repository) -> Result<PathBuf, String> {
    repository
        .workdir()
        .ok_or_else(|| "当前 Git 仓库为 bare 模式，暂不支持工作区版本控制。".to_string())
        .and_then(|path| {
            path.canonicalize()
                .map_err(|error| format!("读取 Git 工作区根目录失败：{error}"))
        })
}

fn resolve_head_commit(repository: &Repository) -> Result<Option<git2::Commit<'_>>, String> {
    match repository.head() {
        Ok(head) => match head.peel_to_commit() {
            Ok(commit) => Ok(Some(commit)),
            Err(error) if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) => {
                Ok(None)
            }
            Err(error) => Err(format!("读取 Git HEAD 提交失败：{error}")),
        },
        Err(error) if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) => {
            Ok(None)
        }
        Err(error) => Err(format!("读取 Git HEAD 失败：{error}")),
    }
}

fn resolve_head_object(repository: &Repository) -> Result<Option<git2::Object<'_>>, String> {
    match repository.head() {
        Ok(head) => head
            .peel(ObjectType::Commit)
            .map(Some)
            .or_else(|error| {
                if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) {
                    Ok(None)
                } else {
                    Err(error)
                }
            })
            .map_err(|error| format!("读取 Git HEAD 对象失败：{error}")),
        Err(error) if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) => {
            Ok(None)
        }
        Err(error) => Err(format!("读取 Git HEAD 失败：{error}")),
    }
}

fn resolve_head_branch_name(repository: &Repository) -> Result<Option<String>, String> {
    match repository.head() {
        Ok(head) => {
            if !head.is_branch() {
                return Ok(None);
            }

            Ok(head.shorthand().map(str::to_string))
        }
        Err(error) if matches!(error.code(), ErrorCode::NotFound | ErrorCode::UnbornBranch) => {
            Ok(None)
        }
        Err(error) => Err(format!("读取 Git 分支信息失败：{error}")),
    }
}

fn resolve_head_detached(repository: &Repository) -> Result<bool, String> {
    repository
        .head_detached()
        .map_err(|error| format!("读取 Git 分支状态失败：{error}"))
}

fn resolve_ahead_behind(
    repository: &Repository,
    branch_name: Option<&str>,
) -> Result<(usize, usize), String> {
    let Some(branch_name) = branch_name else {
        return Ok((0, 0));
    };

    let local_branch = match repository.find_branch(branch_name, BranchType::Local) {
        Ok(branch) => branch,
        Err(error) if error.code() == ErrorCode::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("读取 Git 本地分支失败：{error}")),
    };

    let upstream_branch = match local_branch.upstream() {
        Ok(branch) => branch,
        Err(error) if error.code() == ErrorCode::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("读取 Git 上游分支失败：{error}")),
    };

    let Some(local_oid) = local_branch.get().target() else {
        return Ok((0, 0));
    };
    let Some(upstream_oid) = upstream_branch.get().target() else {
        return Ok((0, 0));
    };

    repository
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|error| format!("读取 Git ahead/behind 失败：{error}"))
}

fn build_git_commit_summary(commit: &git2::Commit<'_>) -> GitCommitSummaryPayload {
    let authored_at = Utc
        .timestamp_opt(commit.time().seconds(), 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339();

    GitCommitSummaryPayload {
        id: commit.id().to_string(),
        short_id: short_commit_id(commit.id()),
        summary: commit.summary().unwrap_or("无提交说明").to_string(),
        author_name: commit.author().name().unwrap_or("未知作者").to_string(),
        authored_at,
    }
}

fn short_commit_id(oid: git2::Oid) -> String {
    let value = oid.to_string();
    value.chars().take(7).collect()
}

fn resolve_status_path(entry: &StatusEntry<'_>) -> Option<PathBuf> {
    entry
        .path()
        .map(PathBuf::from)
        .or_else(|| {
            entry
                .index_to_workdir()
                .and_then(|delta| delta.new_file().path().map(PathBuf::from))
        })
        .or_else(|| {
            entry
                .head_to_index()
                .and_then(|delta| delta.new_file().path().map(PathBuf::from))
        })
}

fn resolve_previous_status_path(entry: &StatusEntry<'_>, current_path: &Path) -> Option<PathBuf> {
    entry
        .index_to_workdir()
        .and_then(|delta| delta.old_file().path().map(PathBuf::from))
        .filter(|path| path != current_path)
        .or_else(|| {
            entry
                .head_to_index()
                .and_then(|delta| delta.old_file().path().map(PathBuf::from))
                .filter(|path| path != current_path)
        })
}

fn map_index_status(status: Status) -> Option<&'static str> {
    if status.contains(Status::CONFLICTED) {
        return Some("conflicted");
    }

    if status.contains(Status::INDEX_NEW) {
        return Some("added");
    }
    if status.contains(Status::INDEX_MODIFIED) {
        return Some("modified");
    }
    if status.contains(Status::INDEX_DELETED) {
        return Some("deleted");
    }
    if status.contains(Status::INDEX_RENAMED) {
        return Some("renamed");
    }
    if status.contains(Status::INDEX_TYPECHANGE) {
        return Some("typechange");
    }

    None
}

fn map_worktree_status(status: Status) -> Option<&'static str> {
    if status.contains(Status::CONFLICTED) {
        return Some("conflicted");
    }

    if status.contains(Status::WT_NEW) {
        return Some("untracked");
    }
    if status.contains(Status::WT_MODIFIED) {
        return Some("modified");
    }
    if status.contains(Status::WT_DELETED) {
        return Some("deleted");
    }
    if status.contains(Status::WT_RENAMED) {
        return Some("renamed");
    }
    if status.contains(Status::WT_TYPECHANGE) {
        return Some("typechange");
    }

    None
}

fn resolve_relative_path(repository_root: &Path, path: &Path) -> Result<PathBuf, String> {
    let path_candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        repository_root.join(path)
    };

    path_candidate
        .strip_prefix(repository_root)
        .map(Path::to_path_buf)
        .map_err(|_| "目标文件超出当前 Git 仓库根目录。".to_string())
}

fn resolve_pathspecs(repository_root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    let mut pathspecs = Vec::new();

    for path in paths {
        if path.trim().is_empty() {
            continue;
        }

        let relative_path = resolve_relative_path(repository_root, Path::new(path))?;

        if relative_path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(format!("Git 变更路径不合法：{path}"));
        }

        let pathspec = path_to_forward_slashes(&relative_path);
        if !pathspec.is_empty() {
            pathspecs.push(pathspec);
        }
    }

    Ok(pathspecs)
}

fn path_to_forward_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
