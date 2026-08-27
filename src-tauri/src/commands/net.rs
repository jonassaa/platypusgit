//! One place for the network-op environment policy and failure mapping (#61 D5).
//!
//! Before this module the policy was duplicated in `branches.rs`
//! (fetch/pull/push) and `create.rs` (clone), which is how the two could drift.

use std::path::Path;

use serde::Deserialize;

use crate::{
    cli::{ASKPASS_MODE_ENV, ASKPASS_SECRET_ENV, ASKPASS_USERNAME_ENV},
    error::{AppError, AppResult},
    git::auth::{classify_auth_failure, host_from_stderr, scrub_credentials, AuthChallenge},
};

/// A credential collected from the user for one retry.
///
/// Nothing here is persisted: "remember" is `git credential approve`, which
/// hands the credential to whichever helper the user already has configured.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    /// Absent for an SSH passphrase, which has no username.
    pub username: Option<String>,
    pub secret: String,
}

/// Apply the environment policy for a git subprocess.
///
/// Without credentials this is the historical prompt-less policy: a subprocess
/// has no terminal, so an auth-requiring remote would otherwise hang forever on
/// an invisible prompt, and with prompts off git fails fast instead.
///
/// With credentials, our own executable becomes the askpass and reads the answer
/// from the environment. Two things to know:
///
/// * `GIT_ASKPASS` is **exec'd directly, not run through a shell**, so it cannot
///   carry arguments — hence `ASKPASS_MODE_ENV` rather than a `--askpass` flag.
/// * The secret travels in the environment, never in argv: argv is
///   world-readable via `ps` on macOS and Linux, a process's environment is not.
/// * It points at the **bare executable**, never at the installed `pgit` shim
///   (which on every Unix channel is a symlink to this same binary): `pgit`
///   detaches from the terminal on launch, and git reads the credential from the
///   askpass's stdout synchronously. See `detach::should_detach` and the fork
///   site in `lib.rs::run`.
pub fn apply_auth_env(cmd: &mut tokio::process::Command, creds: Option<&Credentials>) {
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    match creds {
        None => {
            cmd.env("GIT_ASKPASS", "true").env("SSH_ASKPASS", "true");
        }
        Some(c) => {
            let exe = std::env::current_exe()
                .unwrap_or_else(|_| std::path::PathBuf::from("platypusgit"));
            cmd.env("GIT_ASKPASS", &exe)
                .env("SSH_ASKPASS", &exe)
                // OpenSSH >= 8.4 needs this to use SSH_ASKPASS with no DISPLAY.
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env(ASKPASS_MODE_ENV, "1")
                .env(ASKPASS_SECRET_ENV, &c.secret);
            match &c.username {
                Some(u) => {
                    cmd.env(ASKPASS_USERNAME_ENV, u);
                }
                // Explicitly cleared: a stale value inherited from our own
                // environment must not answer a username prompt.
                None => {
                    cmd.env_remove(ASKPASS_USERNAME_ENV);
                }
            }
        }
    }
}

/// Map a failed git invocation to an error, scrubbing credentials first.
///
/// Scrubbing comes first so a remote URL with an embedded token cannot reach an
/// error banner or a log, whichever branch is taken.
pub fn map_git_failure(stderr: &str) -> AppError {
    let clean = scrub_credentials(stderr.trim());
    match classify_auth_failure(&clean) {
        Some(kind) => AppError::Auth(AuthChallenge {
            host: host_from_stderr(&clean),
            kind,
        }),
        None => AppError::Network(clean),
    }
}

/// Run `git -C cwd <args>`, mapping a non-zero exit through `map_git_failure`.
///
/// Cancellable (#234, #263): the op registers under `cancel::Scope::Repo(cwd)`
/// for as long as it runs, so `cancel_network_op` can stop a fetch, pull or
/// push that has stalled. Registering HERE and not per command is the same
/// choice the credential policy makes — a network op that grew its own spawn
/// would be one nobody can cancel. `cwd` comes from `GitBackend::repo_path`,
/// which is where `cancel_network_op` resolves its scope from too.
///
/// `cancel_network_op` kills the child directly, by pid, from its own task —
/// SIGTERM to the whole process group first, escalating to SIGKILL on a second
/// cancel (`cancel::kill_tree`). This function does not select on anything; it
/// just notices that `wait_with_output` returned because the child died, and
/// checks `is_cancelled()` before trusting what git's dying stderr says.
pub async fn run_git_authenticated(
    cwd: &Path,
    args: &[&str],
    creds: Option<&Credentials>,
) -> AppResult<()> {
    // `proc::git_async` carries GIT_TERMINAL_PROMPT=0 (which `apply_auth_env`
    // sets too), a closed stdin — nothing feeds it, so an unexpected read would
    // block forever — on Windows CREATE_NO_WINDOW: without it every fetch,
    // pull and push flashed a console, including the ones auto-fetch runs on a
    // timer with no user action at all (issue 172) — and, on unix, its own
    // process group, which `cancel::kill_tree` signals (issue 263).
    let mut cmd = crate::proc::git_async(cwd);
    cmd.args(args)
        // `Command::output()` sets these itself; spawning by hand below to keep
        // the `Child` reachable means setting them here instead.
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Backstop for a dropped future (e.g. the window closing mid-fetch) —
        // NOT what the ordinary cancel path relies on, which kills by pid
        // instead of dropping this `Child`. See the module docs above.
        .kill_on_drop(true);
    apply_auth_env(&mut cmd, creds);

    let registration = crate::cancel::register(crate::cancel::Scope::repo(cwd));

    // Cancelled between the click and here — do not start a fetch/pull/push
    // nobody is waiting for.
    if registration.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let mut child = cmd.spawn().map_err(|e| AppError::Io(e.to_string()))?;
    // `id()` answers `None` once the child has already been reaped, so read it
    // right away.
    if let Some(pid) = child.id() {
        if !registration.attach(pid) {
            // A cancel landed in the window between the check above and the
            // spawn. `cancel()` found no pid to signal that time, so nothing
            // has been killed yet — do it here, now that we hold the child.
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(AppError::Cancelled);
        }
    }

    // `wait_with_output` and not two manual pipe reads: it drains stdout and
    // stderr concurrently, and a fetch whose stderr filled the pipe buffer
    // while we waited on the exit status would deadlock.
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    // BEFORE `map_git_failure`: a cancelled op's git dies mid-transfer, and its
    // last stderr line reads like a network failure — "the remote end hung up
    // unexpectedly" — or, on a bad day, like an auth failure, which would pop
    // the credential dialog over a cancel. The request is what decides the
    // outcome, not whether git happened to be exiting on its own already.
    if registration.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    if !output.status.success() {
        return Err(map_git_failure(&String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

/// Cancel the network ops running in one scope (#234).
///
/// `repo_id` absent means the clone the Clone dialog is running — a clone has no
/// repository to name yet. Answers how many ops were signalled; zero is a normal
/// answer, not an error, because the op can finish between the user reading the
/// status line and clicking Cancel.
#[tauri::command]
pub async fn cancel_network_op(
    state: tauri::State<'_, crate::state::AppState>,
    repo_id: Option<String>,
) -> AppResult<usize> {
    let scope = match repo_id {
        None => crate::cancel::Scope::Clone,
        Some(id) => {
            let backend = state.backend.clone();
            let id = crate::git::types::RepoId(id);
            let path = tokio::task::spawn_blocking(move || backend.repo_path(&id))
                .await
                .map_err(|e| AppError::Internal(e.to_string()))??;
            crate::cancel::Scope::Repo(path)
        }
    };
    Ok(crate::cancel::cancel(&scope))
}

/// Store a credential with the user's own git credential helper (#61 D5).
///
/// Separate command rather than a flag on the ops, so a credential is stored
/// only after it has actually worked — storing on submit would persist a typo.
#[tauri::command]
pub async fn remember_credential(
    state: tauri::State<'_, crate::state::AppState>,
    repo_id: String,
    host: String,
    credentials: Credentials,
) -> AppResult<()> {
    let backend = state.backend.clone();
    let id = crate::git::types::RepoId(repo_id);
    let path = tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    credential_approve(&path, &host, &credentials).await;
    Ok(())
}

/// Hand a credential to the user's own git credential helper (`approve`), so
/// "remember" stores nothing here.
///
/// Best-effort: a repo with no helper configured simply has nowhere to put it,
/// which is not an error the user needs to see — the credential still worked for
/// the operation they asked for.
pub async fn credential_approve(cwd: &Path, host: &str, creds: &Credentials) {
    use tokio::io::AsyncWriteExt;

    // git's credential protocol is line-based `key=value`. A value containing a
    // newline would inject further keys — a `username` carrying
    // "x\nhost=evil.example" would store the password against a different host.
    // Values cannot legitimately contain newlines, so refuse rather than escape.
    let has_newline = |s: &str| s.contains('\n') || s.contains('\r');
    if has_newline(host)
        || has_newline(&creds.secret)
        || creds.username.as_deref().is_some_and(has_newline)
    {
        return;
    }

    let mut input = format!("protocol=https\nhost={host}\n");
    if let Some(u) = &creds.username {
        input.push_str(&format!("username={u}\n"));
    }
    input.push_str(&format!("password={}\n\n", creds.secret));

    let mut child = match crate::proc::git_async(cwd)
        .args(["credential", "approve"])
        // Overrides the constructor's closed stdin: the credential is fed here.
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(input.as_bytes()).await;
    }
    let _ = child.wait().await;
}
