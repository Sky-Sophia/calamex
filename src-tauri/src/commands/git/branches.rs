use super::*;
use super::cli;
use gix::bstr::ByteSlice;

#[tauri::command]
pub fn list_git_branches(
    payload: GitRepositoryRootRequest,
) -> Result<GitBranchListPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let mut branches = Vec::new();

    let references_platform = repository
        .references()
        .map_err(|error| format!("读取 Git 分支列表失败：{error}"))?;
    let references = references_platform
        .all()
        .map_err(|error| format!("读取 Git 分支列表失败：{error}"))?;

    for reference in references {
        let reference = reference.map_err(|error| format!("读取 Git 分支失败：{error}"))?;
        let name = reference.name();
        let (category, shorthand) = match name.category_and_short_name() {
            Some((cat, short)) => (cat, short.to_string()),
            None => continue,
        };

        let branch_kind = match category {
            gix::refs::Category::LocalBranch => "local",
            gix::refs::Category::RemoteBranch => "remote",
            _ => continue,
        };

        if branch_kind == "remote" && shorthand.ends_with("/HEAD") {
            continue;
        }

        if let Some(branch_payload) = build_git_branch_payload_from_ref(
            &repository,
            &repository_root,
            &reference,
            branch_kind,
            &shorthand,
        )? {
            branches.push(branch_payload);
        }
    }

    branches.sort_by(|left, right| {
        resolve_branch_sort_key(left).cmp(&resolve_branch_sort_key(right))
    });

    Ok(GitBranchListPayload { branches })
}

#[tauri::command]
pub fn checkout_git_branch(
    payload: GitBranchCheckoutRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    assert_repository_is_clean_for_switch(&repository, "切换分支")?;

    cli::run_git_ok(
        &repository_root,
        &["checkout", payload.branch_name.trim()],
        "切换分支",
    )?;

    let repository = open_repository_from_root(&payload.repository_root_path)?;
    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn create_git_branch(
    payload: GitBranchCreateRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let repository_root = resolve_repository_root(&repository)?;
    let branch_name = payload.branch_name.trim();
    if branch_name.is_empty() {
        return Err("Git 分支名称不能为空。".into());
    }
    if !is_valid_git_branch_name(branch_name) {
        return Err(format!("Git 分支名称不合法：{branch_name}"));
    }
    if payload.checkout {
        assert_repository_is_clean_for_switch(&repository, "创建并切换分支")?;
    }

    // 通过 gix 直接创建分支引用，避免依赖系统安装的 git（免装目标）。
    let head_target = repository
        .head_id()
        .map_err(|error| format!("读取 HEAD 失败：{error}"))?
        .detach();
    repository
        .reference(
            format!("refs/heads/{branch_name}"),
            head_target,
            gix::refs::transaction::PreviousValue::MustNotExist,
            "branch: created from HEAD",
        )
        .map_err(|error| format!("创建分支失败：{branch_name}（{error}）"))?;

    if payload.checkout {
        cli::run_git_ok(&repository_root, &["checkout", branch_name], "切换分支")?;
    }

    let repository = open_repository_from_root(&payload.repository_root_path)?;
    super::status::build_git_repository_status_payload(&repository)
}

fn is_valid_git_branch_name(name: &str) -> bool {
    if name.is_empty() { return false; }
    if name.starts_with('.') || name.ends_with('.') { return false; }
    if name.ends_with(".lock") { return false; }
    if name.contains("..") { return false; }
    if name.contains(' ') || name.contains('~') || name.contains('^')
        || name.contains(':') || name.contains('?') || name.contains('*')
        || name.contains('[') { return false; }
    if name.contains("@{") { return false; }
    if name.as_bytes().iter().any(|&b| b == 0x7f || b < 0x20) { return false; }
    if name.starts_with('/') || name.ends_with('/') { return false; }
    true
}

fn resolve_branch_sort_key(branch: &GitBranchPayload) -> (usize, usize, &str) {
    (
        if branch.is_current { 0 } else { 1 },
        if branch.kind == "local" { 0 } else { 1 },
        branch.shorthand.as_str(),
    )
}

fn build_git_branch_payload_from_ref(
    repository: &Repository,
    repository_root: &Path,
    reference: &gix::Reference<'_>,
    kind: &str,
    shorthand: &str,
) -> Result<Option<GitBranchPayload>, String> {
    let name = reference.name().as_bstr().to_str_lossy().into_owned();
    let target_id = reference.id().detach();

    let is_current = is_current_branch(repository, reference);

    let (ahead, behind, upstream_name) = if kind == "local" {
        let upstream_name = resolve_branch_upstream(repository_root, shorthand);
        let (ahead, behind) = if upstream_name.is_some() {
            resolve_ahead_behind_cli(repository_root, shorthand)?
        } else {
            (0, 0)
        };
        (ahead, behind, upstream_name)
    } else {
        (0, 0, None)
    };

    let last_commit = repository
        .find_commit(target_id)
        .ok()
        .map(|commit| build_git_commit_summary(&commit));

    Ok(Some(GitBranchPayload {
        name,
        shorthand: shorthand.to_string(),
        kind: kind.to_string(),
        upstream_name,
        is_current,
        is_head: is_current,
        ahead,
        behind,
        last_commit,
    }))
}

fn is_current_branch(repository: &Repository, reference: &gix::Reference<'_>) -> bool {
    let Ok(Some(head_ref)) = repository.head_ref() else {
        return false;
    };
    head_ref.name().as_bstr() == reference.name().as_bstr()
}

fn resolve_branch_upstream(repository_root: &Path, branch_name: &str) -> Option<String> {
    // 通过 gix 读取分支上游配置（branch.<name>.remote / branch.<name>.merge），
    // 拼出形如 "origin/main" 的上游短名，避免依赖系统安装的 git。
    let repository = gix::open(repository_root).ok()?;
    let config = repository.config_snapshot();

    let remote = config.string(format!("branch.{branch_name}.remote").as_str())?;
    let merge = config.string(format!("branch.{branch_name}.merge").as_str())?;

    let remote = remote.to_str_lossy();
    let remote = remote.trim();
    let merge = merge.to_str_lossy();
    let merge_branch = merge
        .strip_prefix("refs/heads/")
        .unwrap_or_else(|| merge.as_ref())
        .trim();

    if remote.is_empty() || merge_branch.is_empty() {
        return None;
    }
    Some(format!("{remote}/{merge_branch}"))
}

pub(super) fn resolve_ahead_behind_cli(
    repository_root: &Path,
    branch_name: &str,
) -> Result<(usize, usize), String> {
    // 比较「该分支」与「它自己的上游」，而不是当前 HEAD 的上游。
    // 通过 gix 的修订遍历计算 ahead/behind，等价于
    // `git rev-list --count --left-right <branch>...<upstream>`，避免依赖系统安装的 git。
    let repository = gix::open(repository_root)
        .map_err(|error| format!("打开 Git 仓库失败：{error}"))?;

    let local_id = match repository.rev_parse_single(branch_name) {
        Ok(id) => id.detach(),
        Err(_) => return Ok((0, 0)),
    };

    let upstream_name = match resolve_branch_upstream(repository_root, branch_name) {
        Some(name) => name,
        None => return Ok((0, 0)),
    };
    let upstream_id = match repository.rev_parse_single(upstream_name.as_str()) {
        Ok(id) => id.detach(),
        Err(_) => return Ok((0, 0)),
    };

    // ahead：本地分支可达、但上游不可达的提交数。
    let ahead = repository
        .rev_walk(Some(local_id))
        .with_hidden(Some(upstream_id))
        .selected(|_| true)
        .map_err(|error| format!("计算领先提交数失败：{error}"))?
        .count();

    // behind：上游可达、但本地分支不可达的提交数。
    let behind = repository
        .rev_walk(Some(upstream_id))
        .with_hidden(Some(local_id))
        .selected(|_| true)
        .map_err(|error| format!("计算落后提交数失败：{error}"))?
        .count();

    Ok((ahead, behind))
}

pub(super) fn assert_repository_is_clean_for_switch(
    repository: &Repository,
    action: &str,
) -> Result<(), String> {
    let status = super::status::build_git_repository_status_payload(repository)?;
    if status.conflicted_count > 0 {
        return Err(format!("当前工作区存在冲突，{action} 前请先解决冲突。"));
    }
    if !status.is_clean {
        return Err(format!(
            "当前工作区存在未提交改动，{action} 前请先提交、贮藏或放弃当前改动。"
        ));
    }
    Ok(())
}
