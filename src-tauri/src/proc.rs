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
    cmd
}

/// [`program`], async.
pub fn program_async(prog: impl AsRef<OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(prog);
    silence_async(&mut cmd);
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
    tokio::process::Command::new(prog)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Command`'s getters are the only way to see a builder's decisions without
    /// running it, and they are what makes the policy assertable off Windows.
    fn envs(cmd: &std::process::Command) -> Vec<(String, Option<String>)> {
        cmd.get_envs()
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
    fn program_applies_nothing_but_the_flag() {
        // The signer pipes all three streams itself, so the constructor must not
        // close stdin under it.
        let cmd = program("gpg");
        assert_eq!(cmd.get_program(), "gpg");
        assert!(envs(&cmd).is_empty());
    }
}
