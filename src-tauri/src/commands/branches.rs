use tauri::{AppHandle, Emitter, State};

use crate::{
    commands::net::Credentials,
    error::{AppError, AppResult},
    git::types::{
        BranchInfo, BulkFastForward, FastForward, NetOp, NetProgress, PullMode, PushForce,
        RemoteInfo, RepoId, StashInfo, StatusFlag, TagInfo, TagTarget,
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

/// Switch to a local branch.
///
/// `take` releases the branch from a linked worktree that holds it instead of
/// refusing (#358). The frontend passes it only after the user has answered the
/// choice `BranchHeldByWorktree` raised — never on a first attempt.
#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    take: bool,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let repo_id = RepoId(repo_id);
    tokio::task::spawn_blocking(move || backend.checkout_branch(&repo_id, &name, take))
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

/// Build the argument list for `git fetch --unshallow` (#255).
///
/// Deliberately carries NO remote name. git resolves the default itself (the
/// current branch's `branch.<name>.remote`, else `origin`), and leaving the
/// choice to git is what keeps this argument list entirely free of
/// user-supplied text — there is no `--upload-pack=<program>` shape to guard
/// against, and therefore no `--` needed either.
///
/// `--progress` for the same reason `fetch_args` carries it: git writes no
/// sideband progress unless stderr is a tty, which it never is here — and
/// unshallowing a large repository is the longest wait in the app, so a bar is
/// the difference between "working" and "hung".
pub fn unshallow_args() -> Vec<&'static str> {
    vec!["fetch", "--progress", "--unshallow"]
}

/// Fetch the history a shallow clone left behind (#255).
///
/// Answers whether a fetch actually ran. `git fetch --unshallow` on a complete
/// repository is `fatal: --unshallow on a complete repository does not make
/// sense`, and that is not something to show anyone: the outcome the caller
/// asked for — full history — already holds. A stale banner, or another window
/// having unshallowed first, must not turn a no-op into a red error. So the
/// state is re-read here and `Ok(false)` is the honest answer.
///
/// One credential path like every other network op: `run_git_progress` is
/// `run_git_authenticated_with_progress`, which registers the run under
/// `cancel::Scope::Repo` — so this is cancellable and reports progress with
/// nothing extra to remember.
#[tauri::command]
pub async fn unshallow(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    credentials: Option<Credentials>,
) -> AppResult<bool> {
    let repo_id = RepoId(repo_id);
    let backend = state.backend.clone();
    let probe_id = repo_id.clone();
    let info = tokio::task::spawn_blocking(move || backend.shallow_info(&probe_id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    if !info.shallow {
        return Ok(false);
    }
    let path = get_repo_path(&state, &repo_id).await?;
    run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Fetch,
        &unshallow_args(),
        credentials.as_ref(),
    )
    .await?;
    Ok(true)
}

/// Build `git pull` args, refusing a remote or branch git would read as an
/// option.
///
/// **`--` alone does not protect a pull, and this is the one remote path where
/// that is true.** `git pull` parses its own options, consumes the separator,
/// and then re-runs `git fetch <remote> <refspec>` with no separator of its
/// own — so the value reaches that fetch as an option after all. Verified
/// against git 2.54, with the separator in place:
/// `git pull --ff-only -- '--upload-pack=touch X;false' main` runs the named
/// program, and so does the same value in the branch position. `git push` is
/// not affected: it does its own parsing and nothing re-execs.
///
/// So the values are refused instead, the way `commands/forge.rs` refuses a
/// remote name and `forge::validate_ref_name` refuses a branch. Untrusted
/// rather than merely ours: git accepts `git remote add -- -evil <url>`, and a
/// repository's config can name a remote anything at all.
///
/// The separator is still emitted. It is this file's rule, it does end `pull`'s
/// own option parsing, and a reader who finds it missing here would have to
/// re-derive all of the above.
///
/// `--progress` for the same reason `fetch_args` carries it: a pull is a fetch,
/// and the fetch half is the part that takes the time.
///
/// **The branch is named by its FULL ref** — #451 reaches this builder too,
/// though the issue only reported the push half. The branch is a refspec to
/// `git pull` as well, so a leading `+` was git's force marker here and the
/// pull merged a different branch than the one named: measured against git
/// 2.50.1 with a remote carrying both `main` and `+main`,
/// `git pull --progress --ff-only -- origin '+main'` reported
/// `* branch main -> FETCH_HEAD` and fast-forwarded to `main`. Milder than the
/// push — a local merge of the wrong branch, not remote history loss — and the
/// same defect.
///
/// Only the SRC half, unlike the push builders: a `<src>:<dst>` pair here
/// names a LOCAL ref for the fetch to update, and git refuses to fetch into
/// the branch that is checked out. Measured equivalent to the bare name for
/// all three modes, including the auto-generated merge subject, which stays
/// `Merge branch 'main' of <url>` byte for byte.
///
/// The dash refusal above still stands, and the REMOTE is now the half that
/// needs it: a prefixed branch cannot begin with `-` any more, so its check is
/// a clearer error rather than the injection guard it was. Keep both — the
/// remote's is load-bearing, and one of the two silently becoming decorative
/// is not a reason to make the pair inconsistent.
fn pull_args(mode_flag: &str, remote: &str, branch: &str) -> AppResult<Vec<String>> {
    for (what, value) in [("remote", remote), ("branch", branch)] {
        if value.starts_with('-') {
            return Err(AppError::InvalidArgument(format!(
                "invalid {what} name {value:?}: a leading dash would be read as a command-line option"
            )));
        }
    }
    Ok(vec![
        "pull".to_string(),
        "--progress".to_string(),
        mode_flag.to_string(),
        "--".to_string(),
        remote.to_string(),
        format!("refs/heads/{branch}"),
    ])
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
    let mode_flag = match mode {
        PullMode::FastForward => "--ff-only",
        PullMode::Merge => "--no-rebase",
        PullMode::Rebase => "--rebase",
    };
    // Before the path lookup: a refused argument must cost nothing.
    let args = pull_args(mode_flag, remote.as_str(), branch.as_str())?;
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let path = get_repo_path(&state, &repo_id).await?;
    let outcome = run_git_progress(
        &app,
        &path,
        &repo_id,
        NetOp::Pull,
        &arg_refs,
        credentials.as_ref(),
    )
    .await;
    // A pull is the one network op that also MERGES, so it is the one whose
    // failure may have nothing to do with the network (#212). The index says
    // which it was — git's own conflict output goes to stdout, which the runner
    // discards. See `net::map_conflicted_pull`.
    match outcome {
        Ok(()) => Ok(()),
        Err(e) => Err(crate::commands::net::map_conflicted_pull(
            e,
            &conflicted_paths(&state, &repo_id).await,
        )),
    }
}

/// Paths the index reports as conflicted — best effort, on a failure path.
///
/// Best effort on purpose: this runs only to REFINE a failure that already
/// happened, so a status read that itself fails costs a better label, never the
/// original error.
async fn conflicted_paths(state: &State<'_, AppState>, repo_id: &RepoId) -> Vec<String> {
    let backend = state.backend.clone();
    let id = repo_id.clone();
    match tokio::task::spawn_blocking(move || backend.status(&id)).await {
        Ok(Ok(files)) => files
            .into_iter()
            .filter(|f| {
                matches!(f.worktree, StatusFlag::Conflicted)
                    || matches!(f.index, StatusFlag::Conflicted)
            })
            .map(|f| f.path)
            .collect(),
        _ => Vec::new(),
    }
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
///
/// Options first, then `--`, then the remote and the branch: see
/// `push_tag_args` for why the separator is there at all. The force flag and
/// `--no-verify` used to be appended AFTER the two values, which is the reason
/// this builder carried no separator (#212, audit finding 4) — after a `--`
/// git reads them as refspecs, not options. Verified against git 2.54:
/// `git push --progress -u --force-with-lease -- origin main` pushes normally,
/// and `-- --receive-pack=/bin/false main` is refused as a strange pathname
/// instead of running the named program.
///
/// **The branch is named in FULL on both sides of the refspec** — the fix for
/// #451, and the shape `push_commit_args` already uses. `--` ends OPTION
/// parsing, but the branch lands in REFSPEC position, which has a grammar of
/// its own, and a leading `+` there is git's force marker. A branch
/// legitimately named `+main` (git accepts it —
/// `git check-ref-format --branch '+main'` passes, and a clone can bring one
/// in) was therefore sent as "force-update `main`": measured against git
/// 2.50.1 on a diverged remote as
/// `+ b51af1b...bf589a0 main -> main (forced update)`, with no
/// `refs/heads/+main` created and no `confirmRewrite` in front of it, because
/// the app believed it was pushing normally.
///
/// Spelling both sides removes the ambiguity rather than detecting it, and
/// costs nothing — measured equivalent to the bare name for `-u` (sets
/// `branch.<n>.merge = refs/heads/<n>` identically), `--force-with-lease`
/// (still refuses with `stale info`), `--force`, branch creation and slashed
/// names. It also settles two cases the bare name got wrong: `+main` now
/// reaches `refs/heads/+main`, and a repository holding both a branch and a
/// tag named `dup` pushes the BRANCH instead of failing with
/// `src refspec dup matches more than one`.
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
    // Every option is emitted above, so the separator can go here and the two
    // user-supplied values after it.
    args.push("--".to_string());
    args.push(remote.to_string());
    // Both sides in full, so no character of the branch name is ever the first
    // character of the refspec — see the doc comment (#451).
    args.push(format!("refs/heads/{branch}:refs/heads/{branch}"));
    args
}

/// `git push <remote> <oid>:refs/heads/<branch>` — publish history only up to
/// one commit.
///
/// A REFSPEC push, which is what makes "up to here" expressible: the ordinary
/// push sends whatever the branch points at, and there is no way to say "stop
/// at this commit" without naming the source explicitly.
///
/// **Fast-forward only, by construction** — no force variant is offered, so the
/// remote refuses anything that would discard commits and the refusal surfaces
/// like any other network error. `--force-with-lease` on a partial push is its
/// own design question and is deliberately out of scope.
///
/// No `-u`: this does not establish tracking. The branch's upstream is what
/// decided where this push goes, so re-pointing it here would be circular.
///
/// `--` before the remote and the refspec, for the reason `push_args` gives.
/// The oid and the branch are validated by the caller, but the remote name is
/// not, and it is the value `--receive-pack=<program>` would ride in on.
fn push_commit_args(remote: &str, oid: &str, branch: &str, no_verify: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["push".to_string(), "--progress".to_string()];
    if no_verify {
        args.push("--no-verify".to_string());
    }
    args.push("--".to_string());
    args.push(remote.to_string());
    // The FULL destination ref, not a bare branch name: `<oid>:main` would make
    // git guess, and it guesses differently depending on whether `main` already
    // exists on the remote.
    args.push(format!("{oid}:refs/heads/{branch}"));
    args
}

/// Push history up to one commit to `branch` on `remote`.
///
/// See [`push_commit_args`] for the shape and why there is no force option.
#[tauri::command]
pub async fn push_commit(
    app: AppHandle,
    state: State<'_, AppState>,
    repo_id: String,
    remote: String,
    oid: String,
    branch: String,
    credentials: Option<Credentials>,
    // Skip `pre-push` for this push only (#232).
    no_verify: Option<bool>,
) -> AppResult<()> {
    // Both halves of the refspec are validated before it is built: the oid must
    // be hex and the branch must be a name git would accept, so neither can
    // introduce an option or a second refspec. Secrets travel in env, never
    // argv, which `run_git_progress` already guarantees.
    crate::forge::validate_sha(&oid)?;
    crate::forge::validate_ref_name(&branch)?;

    let repo_id = RepoId(repo_id);
    let path = get_repo_path(&state, &repo_id).await?;
    let args = push_commit_args(&remote, &oid, &branch, no_verify.unwrap_or(false));
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
    fn no_verify_is_added_only_when_asked_and_precedes_the_separator() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, false),
            vec![
                "push",
                "--progress",
                "--",
                "origin",
                "refs/heads/main:refs/heads/main"
            ]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, true),
            vec![
                "push",
                "--progress",
                "--no-verify",
                "--",
                "origin",
                "refs/heads/main:refs/heads/main"
            ]
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
                "--force-with-lease",
                "--no-verify",
                "--",
                "origin",
                "refs/heads/feat/x:refs/heads/feat/x"
            ]
        );
    }

    // ─── push_commit_args ───────────────────────────────────────────────────

    #[test]
    fn pushes_a_full_destination_refspec() {
        // The FULL ref, not a bare name: `<oid>:main` makes git guess, and it
        // guesses differently depending on whether `main` exists on the remote.
        assert_eq!(
            push_commit_args("origin", "abc1234", "main", false),
            vec![
                "push",
                "--progress",
                "--",
                "origin",
                "abc1234:refs/heads/main"
            ]
        );
    }

    /// No force flag exists on this path, and no `-u`: fast-forward only, and
    /// the upstream is what decided where the push goes, so re-pointing it here
    /// would be circular.
    #[test]
    fn carries_no_force_and_no_upstream_flag() {
        let args = push_commit_args("origin", "abc1234", "main", false);
        assert!(!args.iter().any(|a| a.starts_with("--force")), "{args:?}");
        assert!(!args.iter().any(|a| a == "-u"), "{args:?}");
    }

    #[test]
    fn no_verify_precedes_the_separator_on_a_commit_push() {
        assert_eq!(
            push_commit_args("origin", "abc1234", "feat/x", true),
            vec![
                "push",
                "--progress",
                "--no-verify",
                "--",
                "origin",
                "abc1234:refs/heads/feat/x"
            ]
        );
    }

    /// A branch name with slashes stays one refspec — it must not be split or
    /// re-escaped.
    #[test]
    fn a_slashed_branch_name_stays_one_refspec() {
        let args = push_commit_args("origin", "abc1234", "release/2026/09", false);
        assert_eq!(args[4], "abc1234:refs/heads/release/2026/09");
        assert_eq!(args.len(), 5, "no extra argument may appear: {args:?}");
    }

    use super::*;

    #[test]
    fn adds_u_only_when_requested() {
        assert_eq!(
            push_args("origin", "main", PushForce::None, true, false),
            vec![
                "push",
                "--progress",
                "-u",
                "--",
                "origin",
                "refs/heads/main:refs/heads/main"
            ]
        );
        assert_eq!(
            push_args("origin", "main", PushForce::None, false, false),
            vec![
                "push",
                "--progress",
                "--",
                "origin",
                "refs/heads/main:refs/heads/main"
            ]
        );
    }

    /// The force flag is an option, so it belongs BEFORE the separator. After
    /// it, git reads `--force-with-lease` as a refspec and the push is neither
    /// forced nor refused.
    #[test]
    fn force_flag_comes_before_the_separator() {
        assert_eq!(
            push_args("origin", "main", PushForce::WithLease, false, false),
            vec![
                "push",
                "--progress",
                "--force-with-lease",
                "--",
                "origin",
                "refs/heads/main:refs/heads/main"
            ]
        );
        assert_eq!(
            push_args("origin", "feat/x", PushForce::Force, true, false),
            vec![
                "push",
                "--progress",
                "-u",
                "--force",
                "--",
                "origin",
                "refs/heads/feat/x:refs/heads/feat/x"
            ]
        );
    }

    // ─── #451: refspec position ─────────────────────────────────────────────

    /// A branch whose name begins with `+` used to force-update a DIFFERENT
    /// ref. The branch lands in refspec position, where a leading `+` is git's
    /// force marker, so `+main` pushed local `main` over remote `main` and
    /// never created `refs/heads/+main`.
    ///
    /// Measured against git 2.50.1 with a diverged remote, before this fix:
    /// `git push --progress -- origin '+main'` answered
    /// `+ b51af1b...bf589a0 main -> main (forced update)` and
    /// `git ls-remote origin | grep -c 'heads/+main'` was `0`. Silent history
    /// loss on the remote's default branch, with no `confirmRewrite` in front
    /// of it, because as far as the app was concerned this was an ordinary
    /// push. `--` does not help: it ends OPTION parsing, not refspec parsing.
    #[test]
    fn a_plus_leading_branch_pushes_itself_not_a_force_refspec() {
        let args = push_args("origin", "+main", PushForce::None, false, false);
        assert_eq!(
            args,
            vec![
                "push",
                "--progress",
                "--",
                "origin",
                "refs/heads/+main:refs/heads/+main"
            ]
        );
        // The bare name is the spelling git read as a force refspec, so its
        // absence is the fix — asserting the pair alone would still pass for a
        // builder that emitted both.
        assert!(!args.iter().any(|a| a == "+main"), "{args:?}");
    }

    /// The same for a tag: `push_tag_args` puts the tag name in refspec
    /// position too. Measured before the fix:
    /// `git push --progress -- origin '+v1.2.0'` created no `+v1.2.0` and
    /// force-updated `v1.2.0` instead.
    #[test]
    fn a_plus_leading_tag_pushes_itself_not_a_force_refspec() {
        let args = push_tag_args("origin", "+v1.2.0");
        assert_eq!(
            args,
            ["push", "--", "origin", "refs/tags/+v1.2.0:refs/tags/+v1.2.0"]
        );
        assert!(!args.iter().any(|a| *a == "+v1.2.0"), "{args:?}");
    }

    /// The invariant behind both: every user-supplied ref name is spelled as a
    /// FULL `refs/…` path on both sides of the refspec, so no character of the
    /// name is ever the first character of the refspec. That is what makes the
    /// refspec metacharacters (`+` force, a leading `^` negation) ordinary
    /// characters of a ref name instead of grammar.
    #[test]
    fn a_user_ref_name_is_never_the_start_of_the_refspec() {
        // `:` and `^` are already illegal in a ref name, but the builders must
        // not depend on a validator they do not call.
        for name in ["+main", "^main", "-main", "main", "feat/+x", "+"] {
            let args = push_args("origin", name, PushForce::None, false, false);
            let spec = args.last().expect("a refspec is emitted");
            assert_eq!(
                *spec,
                format!("refs/heads/{name}:refs/heads/{name}"),
                "branch {name:?} must be named in full on both sides"
            );

            let targs = push_tag_args("origin", name);
            assert_eq!(
                *targs.last().expect("a refspec is emitted"),
                format!("refs/tags/{name}:refs/tags/{name}"),
                "tag {name:?} must be named in full on both sides"
            );
        }
    }

    /// #212, audit finding 4: these were the two push builders without an
    /// end-of-options separator, while `push_tag_args`/`push_delete_args` had
    /// one. `--receive-pack=<program>` names a program git runs for the
    /// transport, so a value read as an option is argument injection.
    #[test]
    fn every_user_value_lands_after_the_separator() {
        let hostile = "--receive-pack=/bin/false";
        // `PushForce::Force` gets its own set: it is a different match arm from
        // `WithLease`, so a reorder could move one and leave the other. The
        // flag says whether the set was built WITH a hostile value — the last
        // one is the ordinary-path control, and counting it as hostile is what
        // would make its half of this test vacuous.
        let sets: Vec<(bool, Vec<String>)> = vec![
            (true, push_args(hostile, "main", PushForce::None, false, false)),
            (true, push_args("origin", hostile, PushForce::WithLease, true, true)),
            (true, push_args("origin", hostile, PushForce::Force, true, true)),
            (true, push_commit_args(hostile, "abc1234", "main", false)),
            (false, push_commit_args("origin", "abc1234", "main", true)),
        ];
        for (has_hostile, args) in sets {
            let sep = args
                .iter()
                .position(|a| a == "--")
                .unwrap_or_else(|| panic!("no end-of-options separator: {args:?}"));
            // PRESENT and after the separator. A bare `if` here would also pass
            // for a builder that dropped the user's value altogether, which is
            // a different bug but not a passing one.
            // `contains`, not `starts_with`: since #451 the branch is wrapped
            // in a full refspec, so a hostile branch name is no longer the
            // start of its argument — which is exactly the protection, but it
            // also means a `starts_with` probe would quietly find nothing and
            // leave this guard asserting against an empty set.
            let at: Vec<usize> = args
                .iter()
                .enumerate()
                .filter(|(_, a)| a.contains("--receive-pack"))
                .map(|(i, _)| i)
                .collect();
            assert_eq!(
                at.len(),
                usize::from(has_hostile),
                "user value must survive exactly once: {args:?}"
            );
            if let Some(&i) = at.first() {
                assert!(i > sep, "user value read as an option: {args:?}");
            }
            // Every one of ours stays an option: after the separator it would
            // be a refspec instead. EVERY occurrence is checked, not just the
            // first — a second copy emitted after `--` is the regression a
            // `position()` lookup cannot see.
            for flag in ["--progress", "-u", "--force-with-lease", "--force", "--no-verify"] {
                for (i, _) in args.iter().enumerate().filter(|(_, a)| *a == flag) {
                    assert!(i < sep, "{flag} must precede the separator: {args:?}");
                }
            }
        }
    }

    // ─── pull_args ──────────────────────────────────────────────────────────

    #[test]
    fn pull_args_carry_the_mode_flag_and_the_separator() {
        for mode_flag in ["--ff-only", "--no-rebase", "--rebase"] {
            assert_eq!(
                pull_args(mode_flag, "origin", "main").unwrap(),
                vec![
                    "pull",
                    "--progress",
                    mode_flag,
                    "--",
                    "origin",
                    "refs/heads/main"
                ]
            );
        }
    }

    /// The separator cannot carry this one: `git pull` consumes it and then
    /// re-runs `git fetch <remote> <refspec>` without one, so a dash-leading
    /// value reaches that fetch as an option (verified against git 2.54).
    /// Refusing it is the guard.
    #[test]
    fn pull_args_refuse_a_value_git_would_read_as_an_option() {
        let hostile = "--upload-pack=/bin/false";
        for (remote, branch) in [(hostile, "main"), ("origin", hostile), (hostile, hostile)] {
            let err = pull_args("--ff-only", remote, branch)
                .expect_err("a dash-leading value must be refused");
            assert!(
                matches!(err, AppError::InvalidArgument(_)),
                "wrong variant: {err:?}"
            );
        }
    }

    /// Only a LEADING dash is an option. A branch named `feat/-x` or a remote
    /// with a dash inside it is ordinary and must still pull.
    #[test]
    fn pull_args_accept_a_dash_that_is_not_leading() {
        assert!(pull_args("--rebase", "my-remote", "feat/-x").is_ok());
    }

    /// #451 reaches `pull` as well, and the issue did not cover it: the branch
    /// is a REFSPEC to `git pull` too, so a leading `+` merged a different
    /// branch than the one named.
    ///
    /// Measured against git 2.50.1, with a remote carrying both `main` and
    /// `+main`: `git pull --progress --ff-only -- origin '+main'` reported
    /// `* branch main -> FETCH_HEAD` and fast-forwarded to `main`'s tip.
    /// Milder than the push (it is a local merge of the wrong branch, not
    /// remote history loss) but the same defect.
    ///
    /// The fix here is the SRC half only. A `<src>:<dst>` pair the way the
    /// push builders use is wrong for pull: the dst would name a local branch
    /// to update, and git refuses to fetch into the checked-out one.
    #[test]
    fn pull_args_name_the_branch_by_its_full_ref() {
        assert_eq!(
            pull_args("--ff-only", "origin", "+main").unwrap(),
            vec!["pull", "--progress", "--ff-only", "--", "origin", "refs/heads/+main"]
        );
        // The bare name is the spelling git read as a force refspec.
        let args = pull_args("--ff-only", "origin", "+main").unwrap();
        assert!(!args.iter().any(|a| *a == "+main"), "{args:?}");

        // ...and an ordinary branch is named the same way, so there is one
        // shape rather than a special case that only triggers on `+`.
        assert_eq!(
            pull_args("--rebase", "origin", "feat/x").unwrap(),
            vec!["pull", "--progress", "--rebase", "--", "origin", "refs/heads/feat/x"]
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
///
/// The tag is named in FULL on both sides for the reason `push_args` gives
/// (#451): the separator ends option parsing, not refspec parsing, so a tag
/// named `+v1.2.0` was read as "force-update `v1.2.0`". Measured against git
/// 2.50.1: `git push --progress -- origin '+v1.2.0'` created no `+v1.2.0` and
/// updated `v1.2.0` instead; the pair creates `refs/tags/+v1.2.0`.
fn push_tag_args(remote: &str, name: &str) -> Vec<String> {
    vec![
        "push".to_string(),
        "--".to_string(),
        remote.to_string(),
        format!("refs/tags/{name}:refs/tags/{name}"),
    ]
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
    let args = push_tag_args(&remote, &name);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git_creds(&path, &arg_refs, credentials.as_ref()).await
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
    use super::{fetch_args, push_delete_args, push_tag_args, unshallow_args};

    #[test]
    fn unshallow_args_carry_progress_and_no_user_value() {
        let args = unshallow_args();
        assert_eq!(args, ["fetch", "--progress", "--unshallow"]);
        // The whole point of naming no remote: there is nothing in this argv a
        // user typed, so there is nothing for `--` to protect.
        assert!(!args.contains(&"--"));
    }

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
        assert_eq!(
            push_tag_args("origin", "v1.2.0"),
            ["push", "--", "origin", "refs/tags/v1.2.0:refs/tags/v1.2.0"]
        );
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
        //
        // `contains`, not `starts_with`: since #451 the tag builder wraps the
        // name in a full refspec, so the hostile value is no longer the start
        // of its argument — which is the point, but it means a `starts_with`
        // probe would silently stop finding the value and this guard would
        // pass without checking anything.
        let sets: Vec<Vec<String>> = vec![
            push_tag_args("--receive-pack=/bin/false", "v1"),
            push_tag_args("origin", "--receive-pack=/bin/false"),
            push_delete_args("--receive-pack=/bin/false", "main")
                .iter()
                .map(|a| (*a).to_string())
                .collect(),
            push_delete_args("origin", "--receive-pack=/bin/false")
                .iter()
                .map(|a| (*a).to_string())
                .collect(),
        ];
        for args in sets {
            let sep = args
                .iter()
                .position(|a| a == "--")
                .expect("builders must emit an end-of-options separator");
            let hostile = args
                .iter()
                .position(|a| a.contains("--receive-pack"))
                .expect("test value present");
            assert!(hostile > sep, "{args:?}");
        }
    }
}
