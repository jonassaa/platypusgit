use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;

use crate::{
    error::{AppError, AppResult},
    git::libgit2::default_branch_name,
    git::types::{CloneOptions, CloneProgress, RepoHandle},
    progress::{ProgressReader, DEFAULT_TAIL_LINES},
    state::AppState,
};

/// The branch name the Init dialog should prefill.
#[tauri::command]
pub async fn default_init_branch() -> AppResult<String> {
    Ok(tokio::task::spawn_blocking(default_branch_name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?)
}

#[tauri::command]
pub async fn init_repo(
    state: State<'_, AppState>,
    path: String,
    initial_branch: Option<String>,
) -> AppResult<RepoHandle> {
    let backend = state.backend.clone();
    let path_buf = PathBuf::from(path);
    tokio::task::spawn_blocking(move || backend.init(&path_buf, initial_branch.as_deref()))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Resolve and check the clone destination.
///
/// `name` must be a single path segment: it is joined onto a directory the
/// user picked, and `Path::join` silently replaces the base when handed an
/// absolute path, so `/etc` as a "name" would otherwise clone into `/etc`.
/// The same hazard applies to a Windows drive-relative name like `C:evil` —
/// `Path::push` replaces the base whenever the pushed path has a "prefix"
/// component but no root — so `name` must resolve to exactly one
/// `Component::Normal`. That check is Windows-`Prefix`-aware only when this
/// binary is actually compiled for Windows, so `:` is also rejected as plain
/// text below, making the same guarantee hold on every platform this runs on
/// (including the ones this validation is tested on).
pub fn validate_clone_target(parent: &Path, name: &str) -> AppResult<PathBuf> {
    let name = name.trim();
    let bad_name = name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(|c| c.is_control())
        || !matches!(
            (Path::new(name).components().next(), Path::new(name).components().nth(1)),
            (Some(Component::Normal(_)), None)
        );
    if bad_name {
        return Err(AppError::InvalidPath(format!(
            "'{name}' is not a valid folder name"
        )));
    }

    // Refuse when `parent` itself is a repository's working-tree root — the
    // accident this guard exists for is pointing "Clone" straight at an
    // existing repo. Deliberately bounded to `parent` itself: `open` (unlike
    // `discover`) never walks up ancestors, so a `parent` that merely sits
    // *inside* a repo several levels down is accepted, not refused.
    //
    // An ancestor-walking version of this check was tried and reverted: it
    // refused a parent five levels under a repo root, and — since `$HOME`
    // being a dotfiles repo is a common real setup — could make a user
    // unable to clone into ANY directory under their home, with an error
    // naming their home directory, and no override. Worse than the gap it
    // closes. A clone that does land several levels inside another repo's
    // working tree still degrades into an already-handled state rather than
    // silent corruption: it's an embedded repo (no `.gitmodules` entry), and
    // this app already detects that as data — see commit 1dddff3 and
    // `embedded_repo.rs` — with dedicated UI (`embeddedRepoMenuItems` in
    // `context-menu.tsx`) rather than a dead end.
    //
    // An ownership-refused directory counts too: it is a repository, we just
    // cannot read its workdir path back out for the message. Testing
    // `open(...).is_ok()` would have skipped this guard on every `/mnt/c`
    // repo under WSL.
    match git2::Repository::open(parent) {
        Ok(repo) => {
            let enclosing = repo.workdir().unwrap_or_else(|| repo.path()).to_path_buf();
            // Lead with the remedy, same principle `embeddedRepoMenuItems`
            // documents for embedded repos: name the repo, say what to do next,
            // don't just refuse.
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository — choose a different folder to clone into",
                enclosing.display()
            )));
        }
        Err(e) if e.code() == git2::ErrorCode::Owner => {
            return Err(AppError::InvalidPath(format!(
                "{} is already a git repository — choose a different folder to clone into",
                parent.display()
            )));
        }
        Err(_) => {}
    }

    let target = parent.join(name);
    // `exists()`/`is_dir()`/`read_dir()` all follow symlinks, so a
    // pre-planted `parent/name` -> elsewhere would be silently accepted here
    // and the clone would land outside `parent`. `symlink_metadata` reports
    // the link itself rather than following it — the same primitive `init`
    // already uses for `.git` provenance in `libgit2.rs`.
    match std::fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_symlink() => {
            return Err(AppError::InvalidPath(format!(
                "{} is a symlink — refusing to clone through it",
                target.display()
            )));
        }
        Ok(meta) if meta.is_dir() => {
            let mut entries = std::fs::read_dir(&target).map_err(|e| {
                AppError::Io(format!("failed to read {}: {e}", target.display()))
            })?;
            if entries.next().is_some() {
                return Err(AppError::InvalidPath(format!(
                    "{} already exists and is not empty",
                    target.display()
                )));
            }
        }
        Ok(_) => {
            return Err(AppError::InvalidPath(format!(
                "{} already exists and is not a directory",
                target.display()
            )));
        }
        Err(_) => {
            // Nothing there yet — fine.
        }
    }
    Ok(target)
}

/// Build the full `git` argument list (global options, then the `clone`
/// subcommand).
///
/// `-c protocol.ext.allow=never` comes first, before the subcommand, exactly
/// like `git -c key=val clone …`. Default git (2.12+) already disallows the
/// `ext::` remote helper, but that default lives in the user's own config —
/// `protocol.ext.allow=always` re-enables it, and an `ext::sh -c '…'` URL
/// then runs an arbitrary command with no credential prompt needed, so `--`
/// alone does not make a directly-spawned `git clone` safe against it. Pin
/// the setting here instead of trusting the ambient config, the same
/// defensive posture `opener.rs` already takes with URLs.
///
/// `--` terminates option parsing before the URL, so a URL beginning with a
/// dash is treated as a URL rather than a flag. Nothing here is ever handed to
/// a shell — these become argv elements of a directly-spawned `git`. Every
/// option below is OURS: a `u32` formatted here, or a fixed literal, so there
/// is no user text among the flags at all.
///
/// **`--no-single-branch` is not a strange extra** (#255): `git clone --depth`
/// *implies* `--single-branch` unless told otherwise, so a depth with the
/// dialog's Single branch box unticked would silently produce a single-branch
/// clone. Emitting the negation is what makes the checkbox mean what it says on
/// every combination.
pub fn clone_args(url: &str, name: &str, opts: &CloneOptions) -> Vec<String> {
    let mut args = vec![
        "-c".to_string(),
        "protocol.ext.allow=never".to_string(),
        "clone".to_string(),
        "--progress".to_string(),
    ];
    if let Some(depth) = opts.depth {
        args.push("--depth".to_string());
        args.push(depth.to_string());
    }
    if opts.blobless {
        // Full history, file contents fetched on demand — the better answer for
        // a big repository you intend to work in, and the one that does not
        // truncate anything.
        args.push("--filter=blob:none".to_string());
    }
    if opts.single_branch {
        args.push("--single-branch".to_string());
    } else if opts.depth.is_some() {
        args.push("--no-single-branch".to_string());
    }
    if opts.recurse_submodules {
        args.push("--recurse-submodules".to_string());
    }
    args.push("--".to_string());
    args.push(url.to_string());
    args.push(name.to_string());
    args
}

/// Spawn `git clone` in `parent`, streaming progress to `on_progress`.
///
/// Keeps `run_git`'s environment exactly (`commands/branches.rs`): prompts are
/// hard-disabled, so a private repo works only when the user's credential
/// helper or SSH agent answers without a TTY. Returns the destination path.
///
/// Cancellable (#234, #263): registers under `cancel::Scope::Clone` for as long
/// as it runs. `cancel_network_op` kills the child directly, by pid, from its
/// own task — SIGTERM to the whole process group first, escalating to SIGKILL
/// on a second cancel (see `cancel.rs`). This function only notices: a read or
/// `wait` returns because the child died, and every exit path checks
/// `registration.is_cancelled()` before trusting what git's dying stderr says.
pub async fn run_clone(
    url: &str,
    parent: &Path,
    name: &str,
    opts: &CloneOptions,
    creds: Option<&crate::commands::net::Credentials>,
    mut on_progress: impl FnMut(CloneProgress),
) -> AppResult<PathBuf> {
    // git's own answer to `--depth 0` is `fatal: depth 0 is not a positive
    // number` — a form-validation message wearing a clone failure's clothes,
    // and one that arrives only after the spawn. Refuse it up front, where the
    // dialog can show it beside the field it belongs to. (`depth` is a `u32`,
    // so 0 is the only unusable value there is.)
    if opts.depth == Some(0) {
        return Err(AppError::InvalidArgument(
            "clone depth must be at least 1".into(),
        ));
    }

    // Trimmed once, here, and reused for both validation and argv below.
    // `validate_clone_target` trims internally too, but that trimmed value
    // never left the function — the untrimmed `name` used to go straight to
    // `clone_args`, so a name with trailing whitespace made git create
    // "cloned " on disk while this function returned "cloned", a path that
    // doesn't exist.
    let name = name.trim();

    // Spawning into a missing parent fails inside `Command::spawn` below with
    // a bare "No such file or directory (os error 2)", which reads as "git
    // isn't installed" rather than "that folder doesn't exist". Check first
    // so the error names the actual problem. This is also the one asymmetry
    // with `init`, which creates missing parent directories instead of
    // requiring them — that's intentional, not an oversight to fix here.
    if !parent.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "{} does not exist",
            parent.display()
        )));
    }

    let target = validate_clone_target(parent, name)?;
    // Whether the destination was the user's own (empty) directory or something
    // only git is about to create. `validate_clone_target` has just guaranteed
    // it is one of those two, which is what makes the cancel cleanup below safe
    // to do at all — see `cancelled_clone`.
    let target_preexisted = target.is_dir();
    let args = clone_args(url, name, opts);

    // `git_async_in` and not `git_async`: a clone's working directory is the
    // PARENT of a repository that does not exist yet, so there is nothing for
    // `-C` to name. It carries CREATE_NO_WINDOW and the prompt-less policy.
    let mut cmd = crate::proc::git_async_in(parent);
    cmd.args(&args)
        // Never let the child read from our stdin. Nothing in this codebase
        // feeds it anything, so an unexpected read would just block forever.
        // There is a cancel button now (#234), so such a hang is escapable —
        // but a clone that silently waits on input nobody will ever type is
        // still not a state worth being able to reach.
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        // If reading stderr below bails out via `?`, or this future is dropped
        // (the window closing mid-clone), `child` is dropped without ever being
        // `.wait()`ed. Without this, git keeps running to completion in the
        // background and finishes populating the destination the frontend was
        // told never got created. A user-driven cancel does NOT rely on this —
        // `cancel_network_op` kills the process directly, by pid (#263), and
        // this function reaps it explicitly before the partial directory is
        // removed, so the process is provably gone first.
        .kill_on_drop(true);
    // Shared with fetch/pull/push so the env policy cannot drift (#61 D5).
    // With credentials this points askpass at our own executable; without them
    // it is the historical prompt-less policy. Applied after the builder chain
    // so it cannot be silently overridden by one of the calls above.
    crate::commands::net::apply_auth_env(&mut cmd, creds);

    // Registered before the spawn so a cancel arriving in the same tick as the
    // click cannot slip through the gap and be ignored (#234). The guard
    // deregisters on every exit path, including the `?`s below.
    let registration = crate::cancel::register(crate::cancel::Scope::Clone);

    // Cancelled between the click and here — do not start a transfer nobody
    // is waiting for.
    if registration.is_cancelled() {
        return Err(cancelled_clone(&target, target_preexisted).await);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("failed to run git clone: {e}")))?;

    // `id()` answers `None` once the child has already been reaped, so read it
    // right away. Recording it is what lets `cancel_network_op` reach this
    // exact process (#263) — before this, cancelling only ever reached the
    // `git` we spawned, never its `git-remote-https`/`ssh` transport helper.
    if let Some(pid) = child.id() {
        if !registration.attach(pid) {
            // A cancel landed in the window between the check above and the
            // spawn. `cancel()` found no pid to signal that time, so nothing
            // has been killed yet — do it here, now that we hold the child.
            kill_and_reap(&mut child).await;
            return Err(cancelled_clone(&target, target_preexisted).await);
        }
    }

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("git clone produced no stderr pipe".into()))?;

    // Splitting on `\r` as well as `\n`, the bounded `pending` buffer, and the
    // progress/failure-tail classification all live in `progress.rs` now: fetch,
    // pull and push read git's progress exactly the same way (#296).
    let mut reader = ProgressReader::new(DEFAULT_TAIL_LINES);
    let mut chunk = [0u8; 4096];

    loop {
        // Where a stalled clone actually sits: git has the connection open and
        // is saying nothing, so this read never completes on its own. What
        // unsticks it is `cancel_network_op` killing the process directly, by
        // pid, from its own task (#263, see `cancel.rs`) — not anything this
        // loop does. `read` then returns because the pipe closed underneath
        // it, either as EOF (the common case) or as an error.
        let read = match stderr.read(&mut chunk).await {
            Ok(n) => n,
            Err(e) => {
                if registration.is_cancelled() {
                    let _ = child.wait().await;
                    return Err(cancelled_clone(&target, target_preexisted).await);
                }
                return Err(AppError::Io(format!("reading git clone output: {e}")));
            }
        };
        if read == 0 {
            break;
        }
        reader.push(&chunk[..read], &mut on_progress);
    }
    reader.finish(&mut on_progress);
    let tail = reader.into_tail();

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Io(format!("waiting for git clone: {e}")))?;
    // BEFORE `map_git_failure`: a cancelled clone's git dies mid-transfer, and
    // its last stderr line reads like a network failure — or, on a bad day,
    // like an auth failure, which would pop the credential dialog over a
    // cancel. `child` is already reaped by the `wait` above, so only the
    // directory goes.
    if registration.is_cancelled() {
        return Err(cancelled_clone(&target, target_preexisted).await);
    }
    if !status.success() {
        // Routed through the shared classifier so a private repo yields Auth
        // (promptable + retryable) rather than a dead-end Network error, and so
        // any credential embedded in an echoed URL is scrubbed (#61 D5).
        return Err(crate::commands::net::map_git_failure(&clone_failure_message(
            &tail,
            status.code(),
        )));
    }
    Ok(target)
}

/// Kill a cancelled `git clone` and wait for it to actually be gone.
///
/// The ONE caller left is the narrow race `Registration::attach` documents:
/// a cancel that landed between registering and spawning, before
/// `cancel_network_op` had a pid to signal. Every other cancellation is
/// already killed by the time this function's callers see it — by
/// `cancel::kill_tree`, from the cancelling call's own task — and only needs
/// reaping, not a second kill; see `run_clone`.
///
/// A hard kill (not the SIGTERM-first escalation `kill_tree` otherwise does):
/// this window is too small to matter, and there is no second click to wait
/// for here — the child was never far enough along to leave a lock file, since
/// it has not sent us so much as one byte of progress yet.
///
/// Errors are swallowed on purpose — every one of them means "the process is
/// already gone", which is the outcome being asked for.
async fn kill_and_reap(child: &mut tokio::process::Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

/// Remove what a cancelled clone left behind and report the cancellation.
///
/// A SIGKILLed `git clone` cannot run its own cleanup, so it leaves a partial
/// working tree. Left there, the very next attempt fails
/// `validate_clone_target` with "already exists and is not empty" — a cancel
/// button whose real effect is to poison the destination.
///
/// Safe to delete precisely because `validate_clone_target` ran first and
/// accepts only two states: nothing there at all, or the user's own EMPTY
/// directory. Nothing of the user's can be inside it. The empty directory they
/// picked is put back, because they picked it — only the clone is undone.
async fn cancelled_clone(target: &Path, target_preexisted: bool) -> AppError {
    let target = target.to_path_buf();
    // `spawn_blocking` and not a bare `std::fs` call: a half-finished clone of a
    // large repository is thousands of unlink syscalls, and doing them on the
    // async worker would stall every other command in the app behind the cleanup
    // of the one that was cancelled to unstick it.
    //
    // Best-effort throughout: a leftover directory is a worse outcome than a
    // cancel, but a failure to remove one is not something to report over the
    // cancel itself — and the retry it breaks says so clearly enough on its own.
    let _ = tokio::task::spawn_blocking(move || {
        let _ = std::fs::remove_dir_all(&target);
        if target_preexisted {
            let _ = std::fs::create_dir_all(&target);
        }
    })
    .await;
    AppError::Cancelled
}

/// Build the `AppError::Network` message for a failed `git clone`. Falls back
/// to the exit status when `tail` is empty — near-unreachable in practice
/// (git almost always writes something to stderr on a failure), but an empty
/// string here would render nothing in the dialog's error slot, leaving the
/// user staring at a form that silently did nothing.
fn clone_failure_message(tail: &[String], exit_code: Option<i32>) -> String {
    if !tail.is_empty() {
        return tail.join("\n");
    }
    match exit_code {
        Some(code) => format!("git clone failed (exit {code})"),
        None => "git clone failed (terminated by signal)".to_string(),
    }
}

/// Clone `url` into `parent_dir/name`, emitting `clone://progress` as it goes.
///
/// `options` carries the Advanced section's four flags (#255). They are flags on
/// THIS clone — there is no second implementation, so the destination
/// validation, the cancel registration, the streamed progress and the one
/// credential path all still apply exactly as they did.
#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    url: String,
    parent_dir: String,
    name: String,
    options: CloneOptions,
    credentials: Option<crate::commands::net::Credentials>,
) -> AppResult<String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::InvalidPath("no repository URL given".into()));
    }
    let parent = PathBuf::from(parent_dir);
    let dest = run_clone(&url, &parent, &name, &options, credentials.as_ref(), |p| {
        // A dropped event only costs a progress tick, never the clone.
        let _ = app.emit("clone://progress", &p);
    })
    .await?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_failure_message_uses_the_tail_when_present() {
        assert_eq!(
            clone_failure_message(&["fatal: repository not found".to_string()], Some(128)),
            "fatal: repository not found"
        );
    }

    #[test]
    fn clone_failure_message_falls_back_to_the_exit_status_when_the_tail_is_empty() {
        assert_eq!(
            clone_failure_message(&[], Some(128)),
            "git clone failed (exit 128)"
        );
        assert_eq!(
            clone_failure_message(&[], None),
            "git clone failed (terminated by signal)"
        );
    }
}
