use tauri::{AppHandle, Emitter, State};

use crate::{
    commands::net::Credentials,
    error::{AppError, AppResult},
    git::types::{
        BranchInfo, BulkFastForward, FastForward, NetOp, NetProgress, PullMode, PushForce,
        RemoteInfo, RepoId, StashInfo, TagInfo, TagTarget,
    },
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

/// `run_git_creds`, forwarding git's own progress to the frontend (#296).
///
/// The four ops a user watches — fetch, fetch-all, pull, push — go through this
/// one; everything else that talks to a remote (fast-forward's fetch, tag push,
/// remote-branch delete) keeps the quiet path, because its transfer is a handful
/// of objects and a bar that fills instantly is noise.
///
/// `repo_id` rides along on every tick because the event is app-global while the
/// indicator is per-repository: a background tab's fetch must not drive the
/// active tab's bar.
async fn run_git_progress(
    app: &AppHandle,
    cwd: &std::path::Path,
    repo_id: &RepoId,
    op: NetOp,
    args: &[&str],
    creds: Option<&Credentials>,
) -> AppResult<()> {
    let repo_id = repo_id.0.clone();
    crate::commands::net::run_git_authenticated_with_progress(cwd, args, creds, &mut |p| {
        // A dropped event costs one progress tick, never the operation.
        let _ = app.emit(
            "net://progress",
            &NetProgress {
                repo_id: repo_id.clone(),
                op,
                phase: p.phase,
                percent: p.percent,
            },
        );
    })
    .await
}

/// Build the argument list for `git fetch`. `remote = None` means all remotes.
///
/// The remote name lands strictly after `--`, for the reason spelled out on
/// `push_tag_args` below: it is user-supplied (typed into the add-remote prompt,
/// picked from the remote list) and `git fetch` has options that name a program
/// to run for the transport (`--upload-pack=<program>`). `--all` is ours, so it
/// stays where it is — there is no user value on that branch to separate.
/// Verified against git 2.50: `git fetch --prune -- origin` fetches normally,
/// and `-- --upload-pack=/bin/false` is refused as a strange pathname instead of
/// being honoured as an option.
///
/// `--progress` is unconditional: git writes no sideband progress unless stderr
/// is a tty, which it never is here, so without the flag there is nothing for
/// `run_git_progress` to report (#296). Harmless on the quiet callers — a sink
/// that never fires just discards the ticks.
fn fetch_args(remote: Option<&str>, prune: bool) -> Vec<&str> {
    let mut args = vec!["fetch", "--progress"];
    if remote.is_none() {
        args.push("--all");
    }
    if prune {
        args.push("--prune");
    }
    if let Some(r) = remote {
        args.push("--");
        args.push(r);
    }
    args
}

#[tauri::command]
pub async fn fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    prune: bool,
    // Optional so an existing caller that omits it behaves exactly as before:
    // the first attempt is always prompt-less, and only a retry carries a
    // credential (#61 D5).
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;
    run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Fetch,
        &fetch_args(Some(remote.as_str()), prune),
        credentials.as_ref(),
    )
    .await
}

#[tauri::command]
pub async fn fetch_all(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    prune: bool,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;
    run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Fetch,
        &fetch_args(None, prune),
        credentials.as_ref(),
    )
    .await
}

#[tauri::command]
pub async fn pull(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    mode: PullMode,
    credentials: Option<Credentials>,
) -> AppResult<()> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;
    let mode_flag = match mode {
        PullMode::FastForward => "--ff-only",
        PullMode::Merge => "--no-rebase",
        PullMode::Rebase => "--rebase",
    };
    run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Pull,
        // `--progress` for the same reason `fetch_args` carries it: a pull is a
        // fetch, and the fetch half is the part that takes the time.
        &["pull", "--progress", mode_flag, remote.as_str(), branch.as_str()],
        credentials.as_ref(),
    )
    .await
}

/// Fetch a branch's remote, then advance the branch to its upstream (#246).
///
/// The op `pull` cannot be: `git pull <remote> <branch>` merges the fetched head
/// into whatever HEAD is, so naming `main` while standing on `feat/x` merged
/// `origin/main` into `feat/x`. This moves `main`'s ref and leaves HEAD alone.
///
/// **The network half and the ref half sit on opposite sides of the boundary on
/// purpose.** A fetch is a subprocess with credentials, so it belongs here,
/// where `run_git_authenticated` is the one credential path. The ancestry check
/// and the ref move are libgit2 work that must not be split, so they are ONE
/// backend call holding ONE lock — see `GitBackend::fast_forward_branch`. The
/// remote lookup comes first and refuses a checked-out or untracked branch up
/// front, so a call that could not have succeeded never spends a fetch.
///
/// A branch that IS `HEAD` is refused rather than silently fast-forwarded: it
/// needs a working-tree update, and the user's `defaultPullMode` decides how.
/// The frontend routes those to `pull` before calling this.
#[tauri::command]
pub async fn fast_forward_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    prune: bool,
    // Optional so the first attempt is always prompt-less and only a retry
    // carries a credential (#61 D5), exactly as fetch/pull/push do.
    credentials: Option<Credentials>,
) -> AppResult<FastForward> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;

    let remote = {
        let backend = state.backend.clone();
        let id = repo_id.clone();
        let name = branch.clone();
        tokio::task::spawn_blocking(move || backend.fast_forward_remote(&id, &name))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))??
    };

    run_git_creds(
        &path,
        &fetch_args(Some(remote.as_str()), prune),
        credentials.as_ref(),
    )
    .await?;

    let backend = state.backend.clone();
    tokio::task::spawn_blocking(move || backend.fast_forward_branch(&repo_id, &branch))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Fetch every remote, then fast-forward every local branch that can be (#246).
///
/// One fetch for the whole sweep — the reason this is a command of its own
/// rather than the frontend looping the single-branch one, which would spend a
/// network round trip per branch.
///
/// The per-branch refusals come back as a report, not an error: one diverged
/// branch must not decide the fate of the other five.
#[tauri::command]
pub async fn fast_forward_all_branches(
    state: State<'_, AppState>,
    repo_id: String,
    prune: bool,
    credentials: Option<Credentials>,
) -> AppResult<BulkFastForward> {
    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;
    run_git_creds(&path, &fetch_args(None, prune), credentials.as_ref()).await?;

    let backend = state.backend.clone();
    tokio::task::spawn_blocking(move || backend.fast_forward_all(&repo_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Build `git push` args. `set_upstream` adds `-u`, which the caller passes
/// only when the branch has no upstream yet — re-sending `-u` on every push
/// would rewrite tracking the user may have deliberately pointed elsewhere.
fn push_args(
    remote: &str,
    branch: &str,
    force: PushForce,
    set_upstream: bool,
    no_verify: bool,
) -> Vec<String> {
    // `--progress` for the same reason `fetch_args` carries it (#296): without
    // it git stays silent on a non-tty stderr and there is no bar to draw.
    let mut args: Vec<String> = vec!["push".to_string(), "--progress".to_string()];
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
    // Skips `pre-push` (#232). Required rather than defaulted, so the compiler
    // finds every call site instead of one silently keeping hooks on.
    if no_verify {
        args.push("--no-verify".to_string());
    }
    args
}

#[tauri::command]
pub async fn push(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    branch: String,
    force: PushForce,
    credentials: Option<Credentials>,
    // Skip `pre-push` for this push only (#232).
    no_verify: Option<bool>,
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

    let args = push_args(&remote, &branch, force, needs_upstream, no_verify.unwrap_or(false));
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Push,
        &arg_refs,
        credentials.as_ref(),
    )
    .await
}

#[cfg(test)]
mod push_args_tests {
    use super::*;

    #[test]
    fn no_verify_is_added_only_when_asked() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, false),
            vec!["push", "--progress", "origin", "main"]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, true),
            vec!["push", "--progress", "origin", "main", "--no-verify"]
        );
    }

    #[test]
    fn no_verify_composes_with_upstream_and_force() {
        assert_eq!(
            push_args("origin", "feat/x", PushForce::WithLease, true, true),
            vec![
                "push",
                "--progress",
                "-u",
                "origin",
                "feat/x",
                "--force-with-lease",
                "--no-verify"
            ]
        );
    }

    use super::*;

    #[test]
    fn adds_u_only_when_requested() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, true, false),
            vec!["push", "--progress", "-u", "origin", "main"]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, false),
            vec!["push", "--progress", "origin", "main"]
        );
    }

    #[test]
    fn force_flag_comes_last() {
        assert_eq!(
            push_args("origin", "main", PushForce::WithLease, false, false),
            vec!["push", "--progress", "origin", "main", "--force-with-lease"]
        );
        assert_eq!(
            push_args("origin", "feat/x", PushForce::Force, true, false),
            vec!["push", "--progress", "-u", "origin", "feat/x", "--force"]
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

/// Signature status of one tag (#132). Called lazily, for the selected tag —
/// see the `verify_tag` doc comment on `GitBackend`.
#[tauri::command]
pub async fn verify_tag(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
) -> AppResult<crate::git::signing::SignatureStatus> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.verify_tag(&repo_id, &name))
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
        assert_eq!(
            fetch_args(Some("origin"), true),
            ["fetch", "--progress", "--prune", "--", "origin"]
        );
        assert_eq!(fetch_args(None, true), ["fetch", "--progress", "--all", "--prune"]);
    }

    #[test]
    fn fetch_args_without_prune() {
        assert_eq!(fetch_args(Some("origin"), false), ["fetch", "--progress", "--", "origin"]);
        assert_eq!(fetch_args(None, false), ["fetch", "--progress", "--all"]);
    }

    #[test]
    fn fetch_args_keep_the_remote_name_after_the_separator() {
        // `--upload-pack=<program>` names a program git runs for the transport,
        // so a remote name read as an option is argument injection, not just a
        // confusing error. Same class of finding as push_tag_args guards.
        for args in [
            fetch_args(Some("--upload-pack=/bin/false"), true),
            fetch_args(Some("--upload-pack=/bin/false"), false),
        ] {
            let sep = args
                .iter()
                .position(|a| *a == "--")
                .expect("named-remote fetch must emit an end-of-options separator");
            let hostile = args
                .iter()
                .position(|a| a.starts_with("--upload-pack"))
                .expect("test value present");
            assert!(hostile > sep, "{args:?}");
        }
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
