use tauri::State;

use crate::{
    commands::net::Credentials,
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

#[tauri::command]
pub async fn set_upstream(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    upstream: Option<String>,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || {
        backend.set_upstream(&repo_id, &branch, upstream.as_deref())
    })
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

/// Run a git subprocess with no credentials — the historical prompt-less policy.
///
/// The env policy and failure classification now live in `commands::net`, shared
/// with clone, so the two cannot drift (#61 D5). Callers that can prompt use
/// `run_git_creds` instead.
async fn run_git(cwd: &std::path::Path, args: &[&str]) -> AppResult<()> {
    crate::commands::net::run_git_authenticated(cwd, args, None).await
}

/// Run a git subprocess with optional credentials from a retry.
async fn run_git_creds(
    cwd: &std::path::Path,
    args: &[&str],
    creds: Option<&Credentials>,
) -> AppResult<()> {
    crate::commands::net::run_git_authenticated(cwd, args, creds).await
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
    // Optional so an existing caller that omits it behaves exactly as before:
    // the first attempt is always prompt-less, and only a retry carries a
    // credential (#61 D5).
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git_creds(
        &path,
        &fetch_args(Some(remote.as_str()), prune),
        credentials.as_ref(),
    )
    .await
}

#[tauri::command]
pub async fn fetch_all(
    state: State<'_, AppState>,
    repo_id: String,
    prune: bool,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git_creds(&path, &fetch_args(None, prune), credentials.as_ref()).await
}

#[tauri::command]
pub async fn pull(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    mode: PullMode,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    let mode_flag = match mode {
        PullMode::FastForward => "--ff-only",
        PullMode::Merge => "--no-rebase",
        PullMode::Rebase => "--rebase",
    };
    run_git_creds(
        &path,
        &["pull", mode_flag, remote.as_str(), branch.as_str()],
        credentials.as_ref(),
    )
    .await
}

/// Build `git push` args. `set_upstream` adds `-u`, which the caller passes
/// only when the branch has no upstream yet — re-sending `-u` on every push
/// would rewrite tracking the user may have deliberately pointed elsewhere.
fn push_args(remote: &str, branch: &str, force: PushForce, set_upstream: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["push".to_string()];
    if set_upstream {
        args.push("-u".to_string());
    }
    args.push(remote.to_string());
    args.push(branch.to_string());
    match force {
        PushForce::None => {}
        PushForce::WithLease => args.push("--force-with-lease".to_string()),
        PushForce::Force => args.push("--force".to_string()),
    }
    args
}

#[tauri::command]
pub async fn push(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    force: PushForce,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;

    // -u only for a branch with no upstream yet, so the first push establishes
    // tracking without later pushes rewriting it.
    let needs_upstream = {
        let backend = state.backend.clone();
        let id = repo_id.clone();
        let branch_name = branch.clone();
        tokio::task::spawn_blocking(move || backend.branches(&id))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .map(|bs| {
                bs.iter()
                    .any(|b| !b.is_remote && b.name == branch_name && b.upstream.is_none())
            })
            // Failing to read branches must not block the push: fall back to a
            // plain push rather than guessing -u.
            .unwrap_or(false)
    };

    let args = push_args(&remote, &branch, force, needs_upstream);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git_creds(&path, &arg_refs, credentials.as_ref()).await
}

#[cfg(test)]
mod push_args_tests {
    use super::*;

    #[test]
    fn adds_u_only_when_requested() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, true),
            vec!["push", "-u", "origin", "main"]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false),
            vec!["push", "origin", "main"]
        );
    }

    #[test]
    fn force_flag_comes_last() {
        assert_eq!(
            push_args("origin", "main", PushForce::WithLease, false),
            vec!["push", "origin", "main", "--force-with-lease"]
        );
        assert_eq!(
            push_args("origin", "feat/x", PushForce::Force, true),
            vec!["push", "-u", "origin", "feat/x", "--force"]
        );
    }
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

/// Build `git push <remote> <tag>` args.
///
/// `--` ends option parsing before the two user-supplied values. Without it a
/// value beginning with `-` is read as an option, and both of these come from
/// the UI: the remote is typed into a prompt (`context-menu.tsx`), the tag name
/// comes from the tag list. `--receive-pack=<program>` is a real `git push`
/// option naming a program to run for the transport, so this is argument
/// injection, not just a confusing error. Verified against git 2.50: without the
/// separator git swallows the value as an option and then complains it has no
/// refspec; with it, git reports `src refspec --receive-pack=… does not match
/// any`. Same class of finding as the #61 D5 security review's third item, where
/// `verify_commit` handed an oid straight to `git show`.
fn push_tag_args<'a>(remote: &'a str, name: &'a str) -> Vec<&'a str> {
    vec!["push", "--", remote, name]
}

/// Build `git push --delete <remote> <branch>` args.
///
/// `--delete` is ours, so it precedes the separator; see `push_tag_args` for why
/// the separator is there at all.
fn push_delete_args<'a>(remote: &'a str, name: &'a str) -> Vec<&'a str> {
    vec!["push", "--delete", "--", remote, name]
}

#[tauri::command]
pub async fn push_tag(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    name: String,
    // Optional so an existing caller that omits it behaves exactly as before:
    // the first attempt is always prompt-less, and only a retry carries a
    // credential (#61 D5).
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git_creds(&path, &push_tag_args(&remote, &name), credentials.as_ref()).await
}

#[tauri::command]
pub async fn push_delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    name: String,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let path = get_repo_path(&state, &RepoId(repo_id)).await?;
    run_git_creds(
        &path,
        &push_delete_args(&remote, &name),
        credentials.as_ref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{fetch_args, push_delete_args, push_tag_args};

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

    #[test]
    fn push_tag_args_end_options_before_the_user_values() {
        assert_eq!(push_tag_args("origin", "v1.2.0"), ["push", "--", "origin", "v1.2.0"]);
    }

    #[test]
    fn push_delete_args_keep_delete_before_the_separator() {
        // `--delete` after `--` would be pushed as a refspec named "--delete".
        assert_eq!(
            push_delete_args("origin", "feature/x"),
            ["push", "--delete", "--", "origin", "feature/x"]
        );
    }

    #[test]
    fn a_dash_leading_value_lands_after_the_separator_not_as_an_option() {
        // The injection this guards: `--receive-pack` names a program git runs
        // for the transport. Both builders must keep every user-supplied value
        // strictly after the `--`.
        for args in [
            push_tag_args("--receive-pack=/bin/false", "v1"),
            push_tag_args("origin", "--receive-pack=/bin/false"),
            push_delete_args("--receive-pack=/bin/false", "main"),
            push_delete_args("origin", "--receive-pack=/bin/false"),
        ] {
            let sep = args
                .iter()
                .position(|a| *a == "--")
                .expect("builders must emit an end-of-options separator");
            let hostile = args
                .iter()
                .position(|a| a.starts_with("--receive-pack"))
                .expect("test value present");
            assert!(hostile > sep, "{args:?}");
        }
    }
}
