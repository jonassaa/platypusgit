//! The one sanctioned way to spawn a child process (issue 172).
//!
//! # Why this module exists
//!
//! `main.rs` sets `#![cfg_attr(not(debug_assertions), windows_subsystem =
//! "windows")]`, so a **release** build is a GUI-subsystem process with no
//! console attached. When such a process `CreateProcess`es a *console*-subsystem
//! child — and `git.exe`, `gpg.exe`, `powershell.exe` all are — Windows
//! allocates a fresh console for it and starts `conhost.exe` to host it. That
//! console's window is visible unless the child is created with
//! `CREATE_NO_WINDOW` (`0x0800_0000`).
//!
//! The symptom was a console window flashing on every commit selection in
//! History (`verify_commit`'s `git show --format=%G?`), but the same flash rode
//! along on hunk staging (`git apply`), the LFS availability probe, every
//! `bisect_status` read, and — with auto-fetch on — a timer with no user action
//! at all. It reproduces **only in a release/bundled build**: a debug build is
//! console-subsystem, already owns a console, and children inherit it.
//!
//! # Why constructors rather than a `no_window(&mut cmd)` helper
//!
//! A helper is something a new spawn site can forget. There were 20 spawn sites
//! and exactly one remembered. So the flag is applied *by the only functions that
//! hand out a `Command` at all*, and `tests/spawn_no_window.rs` fails the build
//! if a raw `Command::new` appears anywhere outside this file. A twenty-first
//! spawn site inherits the fix instead of reopening the issue.
//!
//! `std::process::Command` and `tokio::process::Command` are unrelated types
//! (std's `creation_flags` comes from the `CommandExt` trait, tokio's is an
//! inherent `#[cfg(windows)]` method), so each gets its own constructor rather
//! than one taking a trait object.
//!
//! # The two deliberate exceptions
//!
//! [`git_async_keeping_console`] and [`program_async_keeping_console`] exist for
//! the two children that are **interactive terminal programs on purpose**. See
//! their doc comments; the guard test allow-lists their call sites by name, so
//! adding a third is a deliberate act with a test to update, not an omission.

use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;

/// `CREATE_NO_WINDOW` — "the process is a console application that is being run
/// without a console window", i.e. no console is created and no `conhost.exe`
/// window appears. Documented as ignored when the child is not a console
/// application, so it is harmless on a GUI-subsystem child.
///
/// Spelled out rather than pulled from `windows-sys` to keep this module free of
/// a platform dependency; the value is part of the stable Win32 ABI.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply the no-console flag. No-op off Windows.
#[cfg(windows)]
fn silence(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

/// Non-Windows sibling, so every call site compiles unconditionally.
#[cfg(not(windows))]
fn silence(_cmd: &mut std::process::Command) {}

/// Apply the no-console flag to a tokio command. No-op off Windows.
#[cfg(windows)]
fn silence_async(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn silence_async(_cmd: &mut tokio::process::Command) {}

/// Spawn `prog` with no console window.
///
/// Nothing else is applied: this is for children that are not git and whose
/// stdio policy is their caller's business (the signing program pipes all three
/// streams; `rundll32` inherits them).
pub fn program(prog: impl AsRef<OsStr>) -> std::process::Command {
    let mut cmd = std::process::Command::new(prog);
    silence(&mut cmd);
    apply_path(&mut cmd, child_path());
    cmd
}

/// [`program`], async.
pub fn program_async(prog: impl AsRef<OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(prog);
    silence_async(&mut cmd);
    apply_path_async(&mut cmd, child_path());
    cmd
}

/// The prompt-less policy every non-interactive git shell-out in this codebase
/// wants, in one place.
///
/// * `GIT_TERMINAL_PROMPT=0` — a subprocess of a GUI app has no terminal, so an
///   auth-requiring remote would otherwise hang forever on a prompt nobody can
///   see; with prompts off git fails fast and the failure is classifiable.
/// * `stdin` closed — nothing here feeds a child's stdin, so an unexpected read
///   blocks forever. A caller that *does* pipe stdin (`git apply`,
///   `git credential`) overrides it afterwards; later builder calls win.
fn prompt_less(cmd: &mut std::process::Command) {
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());
}

fn prompt_less_async(cmd: &mut tokio::process::Command) {
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());
}

/// Marker wrapped around the PATH probe's payload. An rc file is free to print
/// banners, version notices and nvm chatter; only what lies between two markers
/// is ours.
const PATH_MARK: &str = "__PGIT_PATH__";

/// How long the login shell gets before we give up on it. An rc file can block
/// on a prompt or a slow network mount, and a GUI app that hangs at startup is
/// worse than one with a short `PATH`.
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Extract the payload from the probe's stdout, or `None` if it is unusable.
///
/// Requires BOTH markers. A shell killed by the timeout mid-print would
/// otherwise yield a truncated `PATH`, which is worse than no `PATH` at all
/// because it looks like it worked.
pub(crate) fn parse_probe_output(raw: &str) -> Option<String> {
    let start = raw.find(PATH_MARK)? + PATH_MARK.len();
    let rest = &raw[start..];
    let end = rest.find(PATH_MARK)?;
    let path = rest[..end].trim();
    (!path.is_empty()).then(|| path.to_string())
}

/// `login` first, then whatever we inherited, deduped.
///
/// # Why a union and not a replacement
///
/// Measured, not assumed: `Command::env("PATH", …)` governs where the child
/// **binary itself** is looked up, and it uses only that value — never the
/// parent's. A probe against a directory holding one fake binary found the fake
/// and then failed to find `sh` at all. So assigning the login shell's `PATH`
/// verbatim would break `Command::new("git")` for any user whose login `PATH`
/// happens not to contain git's directory: a regression caused by the fix.
///
/// Login entries come first on purpose. A Dock-launched app should prefer the
/// `git`, `gpg` and `node` the user's own terminal uses; the inherited tail is
/// there so nothing that resolves today stops resolving.
pub(crate) fn merge_paths(login: &str, inherited: Option<&str>) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for entry in login
        .split(':')
        .chain(inherited.unwrap_or_default().split(':'))
    {
        if !entry.is_empty() && seen.insert(entry) {
            out.push(entry);
        }
    }
    out.join(":")
}

/// The `PATH` every child should get, resolved once, or `None` to inherit ours.
///
/// # Why this exists
///
/// A GUI launch (Dock, Finder, a `.desktop` file) inherits launchd's or the
/// session manager's minimal environment, not the login shell's. A launch
/// through our own `pgit` CLI inherits the terminal's. So a `pre-commit` hook
/// calling `node`, or a `gpg.program` living in `/opt/homebrew/bin`, works or
/// fails depending on **how the app was started** — the worst kind of bug to
/// debug from a user's report, and the one issue 232 is fixed around.
///
/// # Why a login shell and not a list of likely directories
///
/// nvm, asdf, pyenv, rbenv and fnm all put their shims in version-specific
/// directories that cannot be guessed
/// (`~/.nvm/versions/node/v22.3.0/bin`). Asking the shell is the only way to
/// find them.
///
/// `None` on Windows — a GUI process there inherits the user and machine `PATH`
/// from the registry, so there is nothing to fix — and `None` whenever the probe
/// fails, in which case children inherit our environment exactly as they do
/// today. A failure is never worse than the status quo.
pub fn child_path() -> Option<&'static str> {
    CHILD_PATH.get().and_then(|v| v.as_deref())
}

static CHILD_PATH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// Resolve [`child_path`] if it has not been resolved yet. Blocks.
///
/// # Why resolution is separated from reading
///
/// [`child_path`] is **non-blocking on purpose**: it reads the cache and answers
/// `None` if the probe has not finished. Doing the `get_or_init` there instead
/// would make the FIRST spawn of the process wait for a login shell to run the
/// user's rc files — up to [`PROBE_TIMEOUT`]. A slow `.zshrc` (nvm, a network
/// mount) would then stall the first git operation of the session, which is a
/// bad trade for a `PATH` that is only needed by the time someone commits.
///
/// So `run()` warms this on a background thread at startup, and the tiny window
/// before it lands fails safe: a spawn in that window inherits our environment,
/// exactly as it did before this existed. In practice the probe resolves in
/// milliseconds and long before any user action can reach a hook.
pub fn warm_child_path() {
    CHILD_PATH.get_or_init(|| {
        let login = probe_login_path()?;
        let inherited = std::env::var("PATH").ok();
        Some(merge_paths(&login, inherited.as_deref()))
    });
}

#[cfg(windows)]
fn probe_login_path() -> Option<String> {
    None
}

/// Ask the user's login shell what its `PATH` is.
#[cfg(not(windows))]
fn probe_login_path() -> Option<String> {
    use std::io::Read;

    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;

    // `-l` so the profile files run — that is where the version managers put
    // their shims. `printf` rather than `echo`, whose escape handling differs
    // between shells.
    let script = format!("printf '%s%s%s' '{PATH_MARK}' \"$PATH\" '{PATH_MARK}'");

    // Deliberately NOT `program()`: this is the one child that must not be
    // handed the environment we are trying to replace, and it cannot create a
    // Windows console because it does not run on Windows at all.
    let mut child = std::process::Command::new(&shell)
        .arg("-l")
        .arg("-c")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Polled rather than `wait_with_output`, which cannot time out. An rc file
    // that blocks must not hang the first spawn that needs a `PATH`.
    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(_) => return None,
        }
    }

    let mut raw = String::new();
    child.stdout.as_mut()?.read_to_string(&mut raw).ok()?;
    parse_probe_output(&raw)
}

/// Hand `path` to a child, if there is one to hand over.
fn apply_path(cmd: &mut std::process::Command, path: Option<&str>) {
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
}

fn apply_path_async(cmd: &mut tokio::process::Command, path: Option<&str>) {
    if let Some(p) = path {
        cmd.env("PATH", p);
    }
}

/// `git -C <workdir>`, with no console window and the prompt-less policy above.
///
/// Sync, because every caller is already inside `spawn_blocking` (commands wrap
/// the whole backend call).
pub fn git(workdir: &Path) -> std::process::Command {
    let mut cmd = program("git");
    cmd.arg("-C").arg(workdir);
    prompt_less(&mut cmd);
    cmd
}

/// [`git`], async.
pub fn git_async(workdir: &Path) -> tokio::process::Command {
    let mut cmd = program_async("git");
    cmd.arg("-C").arg(workdir);
    prompt_less_async(&mut cmd);
    cmd
}

/// `git` run **with `dir` as its working directory** rather than `-C dir`.
///
/// For `clone`, whose working directory is the *parent* of a repository that does
/// not exist yet — `-C` would have to name a directory git is about to create.
pub fn git_async_in(dir: &Path) -> tokio::process::Command {
    let mut cmd = program_async("git");
    cmd.current_dir(dir);
    prompt_less_async(&mut cmd);
    cmd
}

/// `git -C <workdir>` **keeping its console**, and inheriting stdio.
///
/// The one caller is `run_mergetool`. `git mergetool` launches the tool the user
/// configured, and a console mergetool (`vimdiff`, `nvimdiff`, `emerge`) *is* a
/// terminal program: silencing it would leave an invisible, unfocusable process
/// holding the conflicted file open, with `status().await` never returning and no
/// cancel button anywhere in the UI. The visible console is worse-looking and
/// strictly more usable.
///
/// The asymmetry that decides it: silencing costs a console window for GUI
/// mergetools (cosmetic — and `CREATE_NO_WINDOW` is ignored for them anyway,
/// they are not console applications), while not silencing costs a console
/// window for console mergetools (which is the window they need). Only one of
/// those two mistakes is unrecoverable, so we make the other one.
///
/// This is also the path a user reaches *by asking for their own tool* —
/// platypusgit has its own resolver window for everyone else — so a terminal
/// appearing is closer to expected than surprising.
///
/// No prompt-less policy either: an interactive tool needs its stdin.
pub fn git_async_keeping_console(workdir: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("-C").arg(workdir);
    // The PATH fix still applies: a console mergetool the user configured is
    // exactly the kind of program that lives in a version-managed directory.
    apply_path_async(&mut cmd, child_path());
    cmd
}

/// Spawn `prog` **keeping its console**, inheriting stdio.
///
/// The one caller is `open_in_editor`, running `$VISUAL` / `$EDITOR`. Same
/// asymmetry as [`git_async_keeping_console`]: `EDITOR=vim` names a console
/// program, and hiding its console makes the editor invisible while it holds the
/// file — the user's next move would be Task Manager. A GUI editor is unaffected
/// either way, because the flag does not apply to non-console applications.
///
/// A batch-file shim (`code.cmd`) is the one case that would genuinely benefit,
/// since `cmd.exe` is a console application; that is a cosmetic flash traded
/// against an unrecoverable one, so it loses.
pub fn program_async_keeping_console(prog: impl AsRef<OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(prog);
    // `$EDITOR` is the canonical victim of a Dock launch's minimal PATH.
    apply_path_async(&mut cmd, child_path());
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Command`'s getters are the only way to see a builder's decisions without
    /// running it, and they are what makes the policy assertable off Windows.
    ///
    /// **`PATH` is filtered out.** Every constructor now applies the cached
    /// login-shell `PATH` (issue 232), and whether the probe finds anything
    /// depends on the `$SHELL` of the machine running the test — so asserting on
    /// it here would make these tests pass or fail by environment. The
    /// assertions below are about the prompt-less policy; the `PATH` behaviour is
    /// tested directly in `apply_path_*` and `merge_paths_*`.
    fn envs(cmd: &std::process::Command) -> Vec<(String, Option<String>)> {
        cmd.get_envs()
            .filter(|(k, _)| k.to_string_lossy() != "PATH")
            .map(|(k, v)| {
                (
                    k.to_string_lossy().to_string(),
                    v.map(|v| v.to_string_lossy().to_string()),
                )
            })
            .collect()
    }

    #[test]
    fn git_runs_git_in_the_workdir_prompt_less() {
        let cmd = git(Path::new("/tmp/repo"));
        assert_eq!(cmd.get_program(), "git");
        let args: Vec<_> = cmd.get_args().collect();
        assert_eq!(args, vec![OsStr::new("-C"), OsStr::new("/tmp/repo")]);
        assert!(
            envs(&cmd).contains(&("GIT_TERMINAL_PROMPT".into(), Some("0".into()))),
            "{:?}",
            envs(&cmd)
        );
    }

    #[test]
    fn git_async_matches_the_sync_constructor() {
        let cmd = git_async(Path::new("/tmp/repo"));
        let std = cmd.as_std();
        assert_eq!(std.get_program(), "git");
        let args: Vec<_> = std.get_args().collect();
        assert_eq!(args, vec![OsStr::new("-C"), OsStr::new("/tmp/repo")]);
        assert!(envs(std).contains(&("GIT_TERMINAL_PROMPT".into(), Some("0".into()))));
    }

    #[test]
    fn git_async_in_sets_a_working_directory_instead_of_dash_c() {
        let cmd = git_async_in(Path::new("/tmp/parent"));
        let std = cmd.as_std();
        assert_eq!(std.get_current_dir(), Some(Path::new("/tmp/parent")));
        assert_eq!(std.get_args().count(), 0, "no -C for the clone path");
    }

    #[test]
    fn the_console_keeping_constructors_apply_no_policy() {
        // Whatever else changes, these two must not acquire a stdin(null) or a
        // GIT_TERMINAL_PROMPT: an interactive child needs its terminal.
        let cmd = git_async_keeping_console(Path::new("/tmp/repo"));
        assert!(envs(cmd.as_std()).is_empty(), "mergetool keeps its env");

        let cmd = program_async_keeping_console("vim");
        assert_eq!(cmd.as_std().get_program(), "vim");
        assert!(envs(cmd.as_std()).is_empty());
    }

    #[test]
    fn program_applies_nothing_but_the_flag_and_the_path() {
        // The signer pipes all three streams itself, so the constructor must not
        // close stdin under it. `envs` filters PATH — see its doc comment.
        let cmd = program("gpg");
        assert_eq!(cmd.get_program(), "gpg");
        assert!(envs(&cmd).is_empty());
    }

    // --- PATH resolution (issue 232) ---

    #[test]
    fn parses_the_path_between_markers_ignoring_rc_noise() {
        let raw = format!(
            "Welcome to your shell!\nnvm: loaded\n\
             {PATH_MARK}/opt/homebrew/bin:/usr/bin{PATH_MARK}\nbye\n"
        );
        assert_eq!(
            parse_probe_output(&raw).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn rejects_probe_output_with_no_markers() {
        assert_eq!(parse_probe_output("just noise\n"), None);
    }

    #[test]
    fn rejects_a_single_unterminated_marker() {
        // A shell killed by the timeout mid-print must not yield a truncated
        // PATH: that looks like success and silently drops directories.
        assert_eq!(parse_probe_output(&format!("{PATH_MARK}/opt/homebrew/bin")), None);
    }

    #[test]
    fn rejects_an_empty_path_between_markers() {
        assert_eq!(parse_probe_output(&format!("{PATH_MARK}{PATH_MARK}")), None);
    }

    #[test]
    fn merge_paths_puts_login_first_and_keeps_the_inherited_tail() {
        // The inherited tail is what stops this fix breaking `Command::new("git")`
        // for a user whose login PATH has no git in it.
        assert_eq!(
            merge_paths("/opt/homebrew/bin", Some("/usr/bin:/bin")),
            "/opt/homebrew/bin:/usr/bin:/bin"
        );
    }

    #[test]
    fn merge_paths_dedupes_without_reordering() {
        assert_eq!(
            merge_paths("/usr/bin:/opt/homebrew/bin", Some("/usr/bin:/bin")),
            "/usr/bin:/opt/homebrew/bin:/bin"
        );
    }

    #[test]
    fn merge_paths_drops_empty_entries() {
        // A trailing colon means "the current directory" to some shells; carrying
        // it into every child is a footgun we do not need.
        assert_eq!(merge_paths("/usr/bin:", Some(":/bin")), "/usr/bin:/bin");
    }

    #[test]
    fn merge_paths_survives_no_inherited_path() {
        assert_eq!(merge_paths("/usr/bin", None), "/usr/bin");
    }

    /// The `PATH` a builder will hand its child, if any.
    fn path_of(cmd: &std::process::Command) -> Option<String> {
        cmd.get_envs()
            .find(|(k, _)| k.to_string_lossy() == "PATH")
            .and_then(|(_, v)| v.map(|v| v.to_string_lossy().to_string()))
    }

    /// Asserted against `child_path()` rather than a literal, so the test is
    /// deterministic on a machine that resolves one AND on a machine that does
    /// not — including Windows, where the answer is always `None`. A literal
    /// would make this pass or fail by `$SHELL`.
    ///
    /// Deliberately NOT written as `Command::new` + `apply_path`: raw spawns in
    /// this file are counted by `tests/spawn_no_window.rs`, and a test site
    /// inflating that count would hide a future production spawn inside the
    /// allowance. Going through the constructors also tests the thing that
    /// actually matters — that they apply it at all.
    #[test]
    fn the_sync_constructors_hand_over_the_resolved_path() {
        // Warm first, or `child_path()` is `None` and this compares two Nones.
        warm_child_path();
        assert_eq!(path_of(&program("gpg")).as_deref(), child_path());
        assert_eq!(path_of(&git(Path::new("/tmp/repo"))).as_deref(), child_path());
    }

    #[test]
    fn the_async_constructors_hand_over_the_resolved_path() {
        warm_child_path();
        assert_eq!(
            path_of(program_async("gpg").as_std()).as_deref(),
            child_path()
        );
        assert_eq!(
            path_of(git_async(Path::new("/tmp/repo")).as_std()).as_deref(),
            child_path()
        );
        assert_eq!(
            path_of(git_async_in(Path::new("/tmp/parent")).as_std()).as_deref(),
            child_path()
        );
    }

    #[test]
    fn the_console_keeping_constructors_also_get_the_path() {
        // `$EDITOR` and a console mergetool are exactly the programs a Dock
        // launch's minimal PATH fails to find, so these two are not exempt.
        warm_child_path();
        assert_eq!(
            path_of(git_async_keeping_console(Path::new("/tmp/repo")).as_std()).as_deref(),
            child_path()
        );
        assert_eq!(
            path_of(program_async_keeping_console("vim").as_std()).as_deref(),
            child_path()
        );
    }
    /// The contract that keeps a slow `.zshrc` from stalling the first git
    /// operation of the session: `child_path()` is a cache READ, and
    /// `warm_child_path` is the only thing that runs the probe.
    ///
    /// Asserted on the SOURCE rather than by timing, for the same reason
    /// `tests/spawn_no_window.rs` greps: a timing test here would be warmed by
    /// whichever sibling test ran first in this binary and pass vacuously.
    #[test]
    fn only_warm_child_path_resolves_the_probe() {
        // Everything ABOVE the test module. Scoped that way because this test's
        // own body names the things it is looking for, and a guard that counts
        // its own source counts to four.
        let src = include_str!("proc.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("module source above the tests");

        let body = src
            .split("pub fn child_path() -> Option<&'static str> {")
            .nth(1)
            .and_then(|s| s.split('}').next())
            .expect("child_path body");
        assert!(
            !body.contains("get_or_init"),
            "child_path() must not resolve the probe itself — warm_child_path \
             does, off the main thread. Found body: {body}"
        );
        // Comment lines are not code — the same filter `tests/spawn_no_window.rs`
        // needs, and for the same reason: the doc comment above `child_path`
        // explains this rule by naming it.
        let code_hits = src
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !(t.starts_with("//") || t.starts_with("/*") || t.starts_with('*'))
            })
            .filter(|l| l.contains("get_or_init"))
            .count();
        assert_eq!(
            code_hits, 1,
            "the PATH probe must have exactly one resolution site"
        );
    }

}
