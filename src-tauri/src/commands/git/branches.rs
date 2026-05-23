use super::*;

#[tauri::command]
pub fn list_git_branches(
    payload: GitRepositoryRootRequest,
) -> Result<GitBranchListPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let mut branches = Vec::new();
    let iterator = repository
        .branches(None)
        .map_err(|error| format!("读取 Git 分支列表失败：{error}"))?;
    for branch_result in iterator {
        let (branch, branch_type) =
            branch_result.map_err(|error| format!("读取 Git 分支失败：{error}"))?;
        let shorthand = resolve_branch_shorthand(&branch)?;
        if branch_type == BranchType::Remote && shorthand.ends_with("/HEAD") {
            continue;
        }
        branches.push(build_git_branch_payload(&repository, &branch, branch_type)?);
    }
    branches.sort_by(|left, right| {
        resolve_branch_sort_key(left)
            .cmp(&resolve_branch_sort_key(right))
            .then_with(|| left.shorthand.cmp(&right.shorthand))
    });
    Ok(GitBranchListPayload { branches })
}

#[tauri::command]
pub fn checkout_git_branch(
    payload: GitBranchCheckoutRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    assert_repository_is_clean_for_switch(&repository, "切换分支")?;

    if let Some(local_branch) = find_local_branch(&repository, &payload.branch_name)? {
        checkout_branch_reference(&repository, &local_branch)?;
        return super::status::build_git_repository_status_payload(&repository);
    }

    let remote_branch = find_remote_branch(&repository, &payload.branch_name)?
        .ok_or_else(|| format!("未找到 Git 分支：{}", payload.branch_name))?;
    let remote_shorthand = resolve_branch_shorthand(&remote_branch)?;
    let local_branch_name = derive_local_branch_name(&remote_shorthand);

    let mut local_branch = match repository.find_branch(&local_branch_name, BranchType::Local) {
        Ok(existing_branch) => existing_branch,
        Err(error) if error.code() == ErrorCode::NotFound => {
            let target_commit = resolve_branch_commit(&repository, &remote_branch)?;
            repository
                .branch(&local_branch_name, &target_commit, false)
                .map_err(|create_error| format!("基于远程分支创建本地分支失败：{create_error}"))?
        }
        Err(error) => return Err(format!("读取本地 Git 分支失败：{error}")),
    };

    local_branch
        .set_upstream(Some(&remote_shorthand))
        .map_err(|error| format!("设置 Git 分支上游失败：{error}"))?;
    checkout_branch_reference(&repository, &local_branch)?;
    super::status::build_git_repository_status_payload(&repository)
}

#[tauri::command]
pub fn create_git_branch(
    payload: GitBranchCreateRequest,
) -> Result<GitRepositoryStatusPayload, String> {
    let repository = open_repository_from_root(&payload.repository_root_path)?;
    let branch_name = payload.branch_name.trim();
    if branch_name.is_empty() {
        return Err("Git 分支名称不能为空。".into());
    }
    let is_valid_branch_name = Branch::name_is_valid(branch_name)
        .map_err(|error| format!("校验 Git 分支名称失败：{error}"))?;
    if !is_valid_branch_name {
        return Err(format!("Git 分支名称不合法：{branch_name}"));
    }
    if payload.checkout {
        assert_repository_is_clean_for_switch(&repository, "创建并切换分支")?;
    }
    let head_commit = resolve_head_commit(&repository)?
        .ok_or_else(|| "当前仓库还没有提交记录，无法创建分支。".to_string())?;
    let branch = repository
        .branch(branch_name, &head_commit, false)
        .map_err(|error| {
            if error.code() == ErrorCode::Exists {
                format!("Git 分支已存在：{branch_name}")
            } else {
                format!("创建 Git 分支失败：{error}")
            }
        })?;
    if payload.checkout {
        checkout_branch_reference(&repository, &branch)?;
    }
    super::status::build_git_repository_status_payload(&repository)
}

fn resolve_branch_sort_key(branch: &GitBranchPayload) -> (usize, usize, &str) {
    (
        if branch.is_current { 0 } else { 1 },
        if branch.kind == "local" { 0 } else { 1 },
        branch.shorthand.as_str(),
    )
}

fn build_git_branch_payload(
    repository: &Repository,
    branch: &Branch<'_>,
    branch_type: BranchType,
) -> Result<GitBranchPayload, String> {
    let shorthand = resolve_branch_shorthand(branch)?;
    let name = branch
        .get()
        .name()
        .map(str::to_string)
        .unwrap_or_else(|| shorthand.clone());

    let upstream_branch = if branch_type == BranchType::Local {
        match branch.upstream() {
            Ok(upstream) => Some(upstream),
            Err(error) if error.code() == ErrorCode::NotFound => None,
            Err(error) => return Err(format!("读取 Git 分支上游失败：{error}")),
        }
    } else {
        None
    };

    let upstream_name = match upstream_branch.as_ref() {
        Some(upstream) => Some(resolve_branch_shorthand(upstream)?),
        None => None,
    };

    let (ahead, behind) = match upstream_branch.as_ref() {
        Some(upstream) => resolve_ahead_behind_with_upstream(repository, branch, upstream)?,
        None => (0, 0),
    };

    let last_commit = branch
        .get()
        .target()
        .and_then(|oid| repository.find_commit(oid).ok())
        .map(|commit| build_git_commit_summary(&commit));

    Ok(GitBranchPayload {
        name,
        shorthand,
        kind: resolve_branch_kind(branch_type).to_string(),
        upstream_name,
        is_current: branch.is_head(),
        is_head: branch.is_head(),
        ahead,
        behind,
        last_commit,
    })
}

fn resolve_branch_kind(branch_type: BranchType) -> &'static str {
    match branch_type {
        BranchType::Local => "local",
        BranchType::Remote => "remote",
    }
}

fn resolve_branch_shorthand(branch: &Branch<'_>) -> Result<String, String> {
    if let Ok(Some(name)) = branch.name() {
        return Ok(name.to_string());
    }
    if let Some(shorthand) = branch.get().shorthand() {
        return Ok(shorthand.to_string());
    }
    Err("读取 Git 分支名称失败：分支名不是有效的 UTF-8。".into())
}

fn resolve_ahead_behind_with_upstream(
    repository: &Repository,
    branch: &Branch<'_>,
    upstream_branch: &Branch<'_>,
) -> Result<(usize, usize), String> {
    let Some(local_oid) = branch.get().target() else {
        return Ok((0, 0));
    };
    let Some(upstream_oid) = upstream_branch.get().target() else {
        return Ok((0, 0));
    };
    repository
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|error| format!("读取 Git 分支 ahead/behind 失败：{error}"))
}

fn resolve_branch_commit<'repo>(
    repository: &'repo Repository,
    branch: &Branch<'repo>,
) -> Result<git2::Commit<'repo>, String> {
    if let Some(oid) = branch.get().target() {
        return repository
            .find_commit(oid)
            .map_err(|error| format!("读取 Git 分支提交失败：{error}"));
    }
    branch
        .get()
        .peel_to_commit()
        .map_err(|error| format!("读取 Git 分支提交失败：{error}"))
}

fn find_local_branch<'repo>(
    repository: &'repo Repository,
    branch_name: &str,
) -> Result<Option<Branch<'repo>>, String> {
    find_branch_by_candidates(repository, branch_name, BranchType::Local, "refs/heads/")
}

fn find_remote_branch<'repo>(
    repository: &'repo Repository,
    branch_name: &str,
) -> Result<Option<Branch<'repo>>, String> {
    find_branch_by_candidates(repository, branch_name, BranchType::Remote, "refs/remotes/")
}

fn find_branch_by_candidates<'repo>(
    repository: &'repo Repository,
    branch_name: &str,
    branch_type: BranchType,
    prefix: &str,
) -> Result<Option<Branch<'repo>>, String> {
    for candidate in build_branch_name_candidates(branch_name, prefix) {
        match repository.find_branch(candidate.as_str(), branch_type) {
            Ok(branch) => return Ok(Some(branch)),
            Err(error) if error.code() == ErrorCode::NotFound => continue,
            Err(error) => return Err(format!("读取 Git 分支失败：{error}")),
        }
    }
    Ok(None)
}

fn build_branch_name_candidates(branch_name: &str, prefix: &str) -> Vec<String> {
    let trimmed = branch_name.trim();
    let mut candidates = Vec::new();
    for candidate in [Some(trimmed), trimmed.strip_prefix(prefix)]
        .into_iter()
        .flatten()
    {
        if candidate.is_empty() || candidates.iter().any(|value| value == candidate) {
            continue;
        }
        candidates.push(candidate.to_string());
    }
    candidates
}

fn checkout_branch_reference(repository: &Repository, branch: &Branch<'_>) -> Result<(), String> {
    let reference_name = branch
        .get()
        .name()
        .ok_or_else(|| "读取 Git 分支引用名失败。".to_string())?;
    repository
        .set_head(reference_name)
        .map_err(|error| format!("切换 Git HEAD 失败：{error}"))?;
    let mut checkout_builder = CheckoutBuilder::new();
    checkout_builder.safe();
    repository
        .checkout_head(Some(&mut checkout_builder))
        .map_err(|error| format!("切换 Git 工作区失败：{error}"))
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

fn derive_local_branch_name(remote_branch_name: &str) -> String {
    remote_branch_name
        .split_once('/')
        .map(|(_remote_name, local_name)| local_name.to_string())
        .unwrap_or_else(|| remote_branch_name.to_string())
}