use tauri::State;

use crate::{
    error::{AppError, AppResult},
    git::types::{BranchInfo, PullMode, PushForce, RemoteInfo, RepoId, StashInfo, TagInfo, TagTarget},
    state::AppState,
};

#[tauri::command]
pub async fn list_branches(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<BranchInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.branches(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>, repo_id: String) -> AppResult<Vec<TagInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.tags(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_stashes(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<StashInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.stashes(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_remotes(
    state: State<'_, AppState>,
    repo_id: String,
) -> AppResult<Vec<RemoteInfo>> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.remotes(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.checkout_branch(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn create_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    from: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_branch(&repo_id, &name, from.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: bool,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_branch(&repo_id, &name, force))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rename_branch(
    state: State<'_, AppState>,
    repo_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rename_branch(&repo_id, &from, &to))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Helper: resolve the working-directory path for an open repo.
async fn get_repo_path(state: &AppState, repo_id: &RepoId) -> AppResult<std::path::PathBuf> {
    let backend = state.backend.clone();
    let repo_id = repo_id.clone();
    tokio::task::spawn_blocking(move || backend.repo_path(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Run a git subprocess and map non-zero exit to `AppError::Network`.
///
/// Credential prompts are disabled (`GIT_TERMINAL_PROMPT=0` plus a no-op
/// askpass): a subprocess has no terminal, so an auth-requiring remote would
/// otherwise hang forever on an invisible prompt. With prompts off, git fails
/// fast and the error surfaces through the normal `AppError::Network` path.
async fn run_git(
    cwd: &std::path::Path,
    args: &[&str],
) -> AppResult<()> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "true")
        .env("SSH_ASKPASS", "true")
        .output()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Network(stderr));
    }
    Ok(())
}

/// Build the argument list for `git fetch`. `remote = None` means all remotes.
fn fetch_args(remote: Option<&str>, prune: bool) -> Vec<&str> {
    let mut args = vec!["fetch"];
    match remote {
        Some(r) => args.push(r),
        None => args.push("--all"),
    }
    if prune {
        args.push("--prune");
    }
    args
}

#[tauri::command]
pub async fn fetch(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    prune: bool,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &fetch_args(Some(remote.as_str()), prune)).await
}

#[tauri::command]
pub async fn fetch_all(
    state: State<'_, AppState>,
    repo_id: String,
    prune: bool,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &fetch_args(None, prune)).await
}

#[tauri::command]
pub async fn pull(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    mode: PullMode,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    let mode_flag = match mode {
        PullMode::FastForward => "--ff-only",
        PullMode::Merge => "--no-rebase",
        PullMode::Rebase => "--rebase",
    };
    run_git(&path, &["pull", mode_flag, remote.as_str(), branch.as_str()]).await
}

#[tauri::command]
pub async fn push(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    force: PushForce,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    let mut args: Vec<String> = vec![
        "push".to_string(),
        remote,
        branch,
    ];
    match force {
        PushForce::None => {}
        PushForce::WithLease => args.push("--force-with-lease".to_string()),
        PushForce::Force => args.push("--force".to_string()),
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git(&path, &arg_refs).await
}

#[tauri::command]
pub async fn add_remote(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    url: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.add_remote(&repo_id, &name, &url))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn remove_remote(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.remove_remote(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn rename_remote(
    state: State<'_, AppState>,
    repo_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.rename_remote(&repo_id, &from, &to))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn set_remote_url(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    url: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.set_remote_url(&repo_id, &name, &url))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn prune_remote(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.prune_remote(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    target: TagTarget,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.create_tag(&repo_id, &name, target))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn delete_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.delete_tag(&repo_id, &name))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

// Higher-level operations implemented via the `git` CLI (same strategy as
// fetch/pull/push). libgit2's native merge/rebase implementations don't
// cover all the edge cases (recursive/ort strategies, hook integration),
// and for checkout of arbitrary refs (tags, commits) we want git's rules.

#[tauri::command]
pub async fn merge_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &["merge", name.as_str()]).await
}

#[tauri::command]
pub async fn rebase_onto(
    state: State<'_, AppState>,
    repo_id: String,
    upstream: String,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &["rebase", upstream.as_str()]).await
}

#[tauri::command]
pub async fn checkout_ref(
    state: State<'_, AppState>,
    repo_id: String,
    reference: String,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &["checkout", reference.as_str()]).await
}

#[tauri::command]
pub async fn push_tag(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    name: String,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &["push", remote.as_str(), name.as_str()]).await
}

#[tauri::command]
pub async fn push_delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    name: String,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git(&path, &["push", "--delete", remote.as_str(), name.as_str()]).await
}

#[cfg(test)]
mod tests {
    use super::fetch_args;

    #[test]
    fn fetch_args_with_prune() {
        assert_eq!(fetch_args(Some("origin"), true), ["fetch", "origin", "--prune"]);
        assert_eq!(fetch_args(None, true), ["fetch", "--all", "--prune"]);
    }

    #[test]
    fn fetch_args_without_prune() {
        assert_eq!(fetch_args(Some("origin"), false), ["fetch", "origin"]);
        assert_eq!(fetch_args(None, false), ["fetch", "--all"]);
    }
}
