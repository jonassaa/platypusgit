use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncReadExt;

use crate::{
    error::{AppError, AppResult},
    git::libgit2::default_branch_name,
    git::types::{CloneProgress, RepoHandle},
    state::AppState,
};

/// Parse one stderr line from `git clone --progress`.
///
/// Git writes progress as `Receiving objects:  62% (620/1000)`, separated by
/// carriage returns rather than newlines, and interleaves non-progress chatter
/// ("Cloning into 'foo'...", "remote: Enumerating objects: 1000, done.").
/// Unrecognized lines return `None` — a guess here would render a bogus bar.
pub fn parse_progress(line: &str) -> Option<CloneProgress> {
    let line = line.trim();
    let (phase, rest) = line.split_once(':')?;
    let phase = phase.trim();
    if phase.is_empty() {
        return None;
    }
    // Strip "remote:" prefix and parse the actual phase underneath.
    if phase == "remote" {
        return parse_progress(rest.trim());
    }
    // Reject non-progress lines that happen to have a colon.
    if phase == "fatal" || phase == "warning" {
        return None;
    }
    // Require an actual '%' character — split always yields at least one item,
    // but we need to verify the delimiter was found.
    let mut parts = rest.trim().splitn(2, '%');
    let percent_token = parts.next()?.trim();
    parts.next()?; // only Some when a '%' was actually present
    let percent: u8 = percent_token.parse().ok()?;
    if percent > 100 {
        return None;
    }
    Some(CloneProgress {
        phase: phase.to_string(),
        percent,
    })
}

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
/// a shell — these become argv elements of a directly-spawned `git`.
pub fn clone_args(url: &str, name: &str, recurse_submodules: bool) -> Vec<String> {
    let mut args = vec![
        "-c".to_string(),
        "protocol.ext.allow=never".to_string(),
        "clone".to_string(),
        "--progress".to_string(),
    ];
    if recurse_submodules {
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
pub async fn run_clone(
    url: &str,
    parent: &Path,
    name: &str,
    recurse_submodules: bool,
    creds: Option<&crate::commands::net::Credentials>,
    mut on_progress: impl FnMut(CloneProgress),
) -> AppResult<PathBuf> {
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
    let args = clone_args(url, name, recurse_submodules);

    // `git_async_in` and not `git_async`: a clone's working directory is the
    // PARENT of a repository that does not exist yet, so there is nothing for
    // `-C` to name. It carries CREATE_NO_WINDOW and the prompt-less policy.
    let mut cmd = crate::proc::git_async_in(parent);
    cmd.args(&args)
        // Never let the child read from our stdin. Nothing in this codebase
        // feeds it anything, so an unexpected read would just block forever
        // — and a clone has no cancel button, so a hang here is force-quit
        // territory rather than something the user can dismiss.
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        // If reading stderr below bails out via `?`, or this future is
        // dropped (e.g. the window closes mid-clone — there is no cancel
        // button), `child` is dropped without ever being `.wait()`ed. Without
        // this, git keeps running to completion in the background and
        // finishes populating the destination the frontend was told never
        // got created.
        .kill_on_drop(true);
    // Shared with fetch/pull/push so the env policy cannot drift (#61 D5).
    // With credentials this points askpass at our own executable; without them
    // it is the historical prompt-less policy. Applied after the builder chain
    // so it cannot be silently overridden by one of the calls above.
    crate::commands::net::apply_auth_env(&mut cmd, creds);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Io(format!("failed to run git clone: {e}")))?;

    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("git clone produced no stderr pipe".into()))?;

    // Git redraws each progress line with a bare `\r`; `\n` only shows up
    // once, at the end of a phase ("...done."). Reading by `\n` alone (as
    // `BufReader::read_until` did) buffers an entire phase — e.g. all of
    // "Receiving objects" — and only releases it as one burst right before
    // the next phase starts, which is not streaming: the bar freezes, then
    // jumps. Read raw bytes as they arrive off the pipe and split on both
    // `\r` and `\n`, carrying any trailing partial line across reads.
    let mut tail: Vec<String> = Vec::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    // Bounds `pending` against a line that never gets a delimiter (a
    // malformed or adversarial sideband stream) — `read_until` had no such
    // bound and would have grown forever.
    const MAX_PENDING: usize = 4096;

    loop {
        let read = stderr
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::Io(format!("reading git clone output: {e}")))?;
        if read == 0 {
            break;
        }
        pending.extend_from_slice(&chunk[..read]);
        while let Some(idx) = pending.iter().position(|&b| b == b'\r' || b == b'\n') {
            let line: Vec<u8> = pending.drain(..=idx).collect();
            handle_clone_line(&line[..line.len() - 1], &mut on_progress, &mut tail);
        }
        if pending.len() > MAX_PENDING {
            let overflow = std::mem::take(&mut pending);
            handle_clone_line(&overflow, &mut on_progress, &mut tail);
        }
    }
    // EOF can leave one final undelimited line (e.g. git's last error
    // message doesn't always end in a newline) — flush it too, or it's lost.
    if !pending.is_empty() {
        handle_clone_line(&pending, &mut on_progress, &mut tail);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Io(format!("waiting for git clone: {e}")))?;
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

/// Classify one stderr segment (already split on `\r`/`\n`): feed progress
/// lines to `on_progress`, keep everything else as context for a failure
/// message. `parse_progress`'s contract is a single trimmed line — it must
/// not see the delimiter itself.
fn handle_clone_line(bytes: &[u8], on_progress: &mut impl FnMut(CloneProgress), tail: &mut Vec<String>) {
    let line = String::from_utf8_lossy(bytes);
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    match parse_progress(line) {
        Some(p) => on_progress(p),
        // Keep non-progress lines: git's failure message is in here, and the
        // exit status alone would say nothing useful.
        None => {
            tail.push(line.to_string());
            if tail.len() > 20 {
                tail.remove(0);
            }
        }
    }
}

/// Clone `url` into `parent_dir/name`, emitting `clone://progress` as it goes.
#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    url: String,
    parent_dir: String,
    name: String,
    recurse_submodules: bool,
    credentials: Option<crate::commands::net::Credentials>,
) -> AppResult<String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err(AppError::InvalidPath("no repository URL given".into()));
    }
    let parent = PathBuf::from(parent_dir);
    let dest = run_clone(
        &url,
        &parent,
        &name,
        recurse_submodules,
        credentials.as_ref(),
        |p| {
            // A dropped event only costs a progress tick, never the clone.
            let _ = app.emit("clone://progress", &p);
        },
    )
    .await?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_receiving_objects_line() {
        assert_eq!(
            parse_progress("Receiving objects:  62% (620/1000)"),
            Some(CloneProgress { phase: "Receiving objects".into(), percent: 62 })
        );
    }

    #[test]
    fn parses_every_phase_git_reports() {
        for (line, phase, pct) in [
            ("Counting objects: 100% (10/10), done.", "Counting objects", 100),
            ("Compressing objects:   5% (1/20)", "Compressing objects", 5),
            ("Resolving deltas: 100% (3/3), done.", "Resolving deltas", 100),
            ("remote: Compressing objects:  45% (9/20)", "Compressing objects", 45),
        ] {
            assert_eq!(
                parse_progress(line),
                Some(CloneProgress { phase: phase.into(), percent: pct }),
                "failed on {line}"
            );
        }
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        for line in [
            "Cloning into 'foo'...",
            "remote: Enumerating objects: 1000, done.",
            "",
            "warning: redirecting to https://example.com/repo.git/",
            "fatal: repository 'https://example.com/nope.git/' not found",
        ] {
            assert_eq!(parse_progress(line), None, "should ignore {line}");
        }
    }

    #[test]
    fn rejects_a_percentless_number_instead_of_guessing() {
        // `split('%')` yields the whole string when the delimiter is absent, so
        // this used to parse as a confident 6%. Git delimits progress with \r,
        // so a truncated read really can hand us this.
        assert_eq!(parse_progress("Receiving objects: 6"), None);
    }

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
