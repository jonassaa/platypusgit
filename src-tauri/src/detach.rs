//! Handing the terminal back on a `pgit …` launch (#163).
//!
//! `pgit .` used to hold the terminal for as long as the app stayed open, and
//! `Ctrl+C` killed it. It cannot be fixed in the shims: every channel that
//! installs `pgit` installs either a **symlink to this very binary** (the Unix
//! self-install and the Homebrew cask's `binary` stanza) or a wrapper whose one
//! line is `exec /usr/bin/platypusgit "$@"` — a symlink has no script to put a
//! `&` in, and `setsid` does not exist on macOS. So the detach lives here, in
//! the one place all four shim shapes pass through.
//!
//! ## What must NOT detach
//!
//! `should_detach` is the whole gate, and `Parsed::Launch` is the only variant
//! it says yes to. The dangerous one is `Parsed::Askpass`: git runs this binary
//! as `GIT_ASKPASS` and reads the credential from **its stdout, synchronously**,
//! so a process that spawned a child and exited would hand git an empty
//! credential and every authenticated fetch/pull/push would fail with nothing to
//! trace it back to. `Parsed::Help` and `Parsed::Version` must stay
//! synchronous too, or their output is printed by a child whose stdout is
//! `/dev/null`.
//!
//! A **dev build** must not detach either, whatever the arguments say (#197).
//! `tauri dev` runs the app as its own child with the developer's terminal
//! inherited, so the tty gate says yes — and the parent exiting 0 is exactly how
//! the CLI learns the app has closed: it stops the vite dev server that a dev
//! build's webview loads `devUrl` from, and returns the prompt. What is left is
//! a setsid'd orphan whose frontend is a closed port — a window that never
//! paints, with no Ctrl+C, no HMR and no rebuild on change. `tauri::is_dev()` is
//! the exact test and not a proxy: the same flag chooses `devUrl` over the
//! embedded assets, so it is true precisely when our frontend belongs to a
//! server that is about to die with the CLI.
//!
//! ## Why this re-execs instead of calling `fork()`
//!
//! A bare `fork()` keeps the GUI in a child that never `exec`s, and macOS
//! forbids exactly that: fork(2) says "all APIs, including Core Foundation and
//! Objective-C frameworks, are subject to this restriction" until one of the
//! `exec` functions is called, and CoreFoundation is already initialised by the
//! time `main` runs in a process linked against AppKit and WebKit. The child
//! here *is* the GUI, so it gets a clean process image instead. `exec` also
//! costs nothing we care about: the parent has done no Tauri, AppKit or libgit2
//! work at the point the decision is made.
//!
//! ## Room left for `--wait`
//!
//! `code --wait` blocks until the window closes so it can serve as `$EDITOR`
//! (issue 163 records it as out of scope). Nothing here consumes a flag —
//! `DETACHED_ENV` is an environment variable — so the flag namespace is
//! untouched. Whoever adds `--wait` gives it its own `Parsed` shape and
//! `should_detach` refuses it, the same way it refuses `Help`.

use std::path::Path;

use crate::cli::Parsed;

/// Set in the re-executed child's environment so it can never detach again.
///
/// The tty check would already stop it (the child's stdout is `/dev/null`), but
/// a launcher is not a place to rely on one condition: this makes the recursion
/// impossible rather than merely unlikely.
pub const DETACHED_ENV: &str = "PLATYPUSGIT_DETACHED";

/// Everything outside the parsed arguments that the decision depends on.
///
/// Passed in rather than read, so every combination is unit-testable — this is
/// the one function in the app whose wrong answer is invisible until somebody's
/// push stops authenticating.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchEnv {
    /// Whether stdout is a terminal. A launch from Finder, the Dock or a
    /// `.desktop` entry has no terminal to hand back and must be untouched.
    pub stdout_is_terminal: bool,
    /// Whether `ASKPASS_MODE_ENV` is set — i.e. git is running us as its
    /// askpass. Belt to `Parsed::Askpass`'s brace: git's prompt string is
    /// arbitrary text and parses as a *path*, so a reordering that let it reach
    /// this gate would otherwise read as a `Launch`.
    pub askpass_mode: bool,
    /// Whether we are already the detached child.
    pub already_detached: bool,
    /// Whether this is a dev build — one whose webview loads `devUrl` from the
    /// dev server that `tauri dev` owns and kills on the way out. Compile-time,
    /// so it cannot be forced from the environment (see the module docs).
    pub dev_build: bool,
}

impl LaunchEnv {
    /// Read the real environment.
    pub fn current() -> Self {
        use std::io::IsTerminal;
        Self {
            stdout_is_terminal: std::io::stdout().is_terminal(),
            askpass_mode: std::env::var_os(crate::cli::ASKPASS_MODE_ENV).is_some(),
            already_detached: std::env::var_os(DETACHED_ENV).is_some(),
            // `tauri::is_dev()` is `!cfg!(feature = "custom-protocol")` — the
            // feature the Tauri CLI adds for a bundle build and leaves off for
            // `tauri dev`, and the same one Tauri reads to pick `devUrl`.
            dev_build: tauri::is_dev(),
        }
    }
}

/// Whether this invocation should hand the terminal back. PURE.
pub fn should_detach(parsed: &Parsed, env: LaunchEnv) -> bool {
    // Askpass answers git on stdout and Help prints USAGE; both are synchronous
    // by contract. Only a launch has a window to go on living behind it.
    matches!(parsed, Parsed::Launch(_))
        && env.stdout_is_terminal
        && !env.askpass_mode
        && !env.already_detached
        && !env.dev_build
}

/// Whether the caller is now the process that should keep going.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Detached {
    /// A detached child owns the launch. Return from `main` — exit 0, like
    /// `code .`.
    Yes,
    /// Nothing was detached; carry on in the foreground exactly as before.
    No,
}

/// Re-exec this binary detached from the terminal, with the same arguments.
///
/// `cwd` is passed to the child explicitly even though an exec'd child inherits
/// it: `parse_args` resolves a relative path against it, so `pgit ../other-repo`
/// depends on the child seeing the shell's directory and not on an inheritance
/// rule holding.
#[cfg(unix)]
pub fn detach(cwd: &Path) -> Detached {
    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => return Detached::No,
    };
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    match spawn_detached(&exe, &args, cwd) {
        Ok(()) => Detached::Yes,
        // Degrade to the old behaviour rather than failing to launch. One line
        // on stderr because the visible symptom (the terminal stays held) is
        // otherwise unattributable.
        Err(e) => {
            eprintln!(
                "platypusgit: could not detach from the terminal ({e}); staying in the foreground"
            );
            Detached::No
        }
    }
}

/// Windows is deliberately untouched (issue 163).
///
/// The release binary is GUI-subsystem (`windows_subsystem = "windows"` in
/// `main.rs`), so `cmd.exe` and PowerShell already return the prompt without
/// waiting. Git Bash does wait — but its stdout is an MSYS named pipe, which
/// `IsTerminal` reports as *not* a terminal, so the tty gate would refuse to
/// detach there anyway. Fixing that shell needs a Windows machine to verify on.
#[cfg(not(unix))]
pub fn detach(_cwd: &Path) -> Detached {
    Detached::No
}

/// Spawn `exe` with `args`, in `cwd`, with no terminal and no stdio.
///
/// Separate from [`detach`] so tests can drive the mechanism with a probe
/// program instead of the app binary — re-executing the app would open a window,
/// and re-executing the test harness would fork-bomb it.
#[cfg(unix)]
pub fn spawn_detached(exe: &Path, args: &[std::ffi::OsString], cwd: &Path) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .env(DETACHED_ENV, "1")
        // Or the app keeps writing into a terminal the user believes it has
        // left. Only tauri-plugin-log's Stdout target lands here; its LogDir
        // target opens its own file and is unaffected.
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: `pre_exec` runs in the forked child before `exec`, where only
    // syscalls are legal. `setsid` is one, and it is what puts the app in a new
    // session with no controlling terminal — so closing the terminal window
    // cannot SIGHUP it, and Ctrl+C in that terminal cannot reach it.
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    // `Command::spawn` reports a failed exec back through its own pipe, so an
    // unlaunchable child is an Err here rather than a silent orphan. The handle
    // is dropped without waiting: `Child::drop` neither kills nor reaps, and the
    // parent is about to exit, so the child is reparented to init.
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::LaunchIntent;
    use std::path::PathBuf;

    fn env(stdout_is_terminal: bool) -> LaunchEnv {
        LaunchEnv {
            stdout_is_terminal,
            askpass_mode: false,
            already_detached: false,
            // A shipped build: the frontend is embedded, so no dev server dies
            // when the launching command returns.
            dev_build: false,
        }
    }

    fn launch() -> Parsed {
        Parsed::Launch(Some(LaunchIntent {
            path: Some(PathBuf::from("/repo")),
            screen: None,
        }))
    }

    #[test]
    fn a_terminal_launch_detaches() {
        assert!(should_detach(&launch(), env(true)));
        assert!(should_detach(&Parsed::Launch(None), env(true)));
    }

    #[test]
    fn a_launch_with_no_terminal_stays_in_the_foreground() {
        // Finder, the Dock, a .desktop entry, and the e2e harness's pipes.
        assert!(!should_detach(&launch(), env(false)));
    }

    #[test]
    fn askpass_never_detaches() {
        // git reads the credential from our stdout, synchronously. Detaching
        // here hands it an empty credential and breaks every authenticated
        // fetch, pull and push with no visible cause.
        let prompt = Parsed::Askpass("Password for 'https://example.invalid': ".into());
        assert!(!should_detach(&prompt, env(true)));
        assert!(!should_detach(&prompt, env(false)));
    }

    #[test]
    fn askpass_mode_never_detaches_even_if_the_prompt_parsed_as_a_launch() {
        // git's prompt is arbitrary text and parse_args reads an unrecognised
        // token as a path, so this is what a reordering would look like.
        let e = LaunchEnv {
            askpass_mode: true,
            ..env(true)
        };
        assert!(!should_detach(&launch(), e));
    }

    #[test]
    fn a_debug_launch_never_detaches() {
        // The whole point of `--debug`: the log has to reach the terminal that
        // asked for it, and a detached child's stdout is /dev/null.
        //
        // Note this needs no change to `should_detach` — it names
        // `Parsed::Launch` and nothing else, so a new variant is refused by
        // construction. That is deliberate: a `debug` *field* on `Launch` would
        // have kept `matches!(parsed, Parsed::Launch { .. })` true and detached
        // anyway.
        let d = Parsed::DebugLaunch(Some(LaunchIntent {
            path: Some(PathBuf::from("/repo")),
            screen: None,
        }));
        assert!(!should_detach(&d, env(true)));
        assert!(!should_detach(&Parsed::DebugLaunch(None), env(true)));
    }

    #[test]
    fn help_never_detaches() {
        // USAGE must reach the terminal that asked for it.
        assert!(!should_detach(&Parsed::Help, env(true)));
        assert!(!should_detach(&Parsed::Help, env(false)));
    }

    #[test]
    fn version_never_detaches() {
        // The version line must reach the terminal that asked for it.
        assert!(!should_detach(&Parsed::Version, env(true)));
        assert!(!should_detach(&Parsed::Version, env(false)));
    }

    #[test]
    fn the_detached_child_does_not_detach_again() {
        let e = LaunchEnv {
            already_detached: true,
            ..env(true)
        };
        assert!(!should_detach(&launch(), e));
    }

    #[test]
    fn a_dev_build_never_detaches() {
        // `tauri dev` inherits the developer's terminal to the app, so the tty
        // gate says yes — and the parent exiting 0 is how the CLI learns the app
        // closed, so it stops the dev server this build's webview loads from.
        // The detached child is then an orphan showing an empty window.
        let e = LaunchEnv {
            dev_build: true,
            ..env(true)
        };
        assert!(!should_detach(&launch(), e));
        assert!(!should_detach(&Parsed::Launch(None), e));
    }
}
