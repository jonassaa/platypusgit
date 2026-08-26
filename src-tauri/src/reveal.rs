//! "Reveal in Finder / Explorer" and "Open in terminal" (issue 215).
//!
//! Companion to `opener.rs` (which hands a path to the app that OWNS the
//! file) — this hands it to the OS's shell chrome instead: the file manager
//! or a terminal emulator. No shell interpreter is ever involved, matching
//! `opener.rs`'s own rule; every argv is built as a `Vec<OsString>` and passed
//! straight to `Command`, never joined into a string.
//!
//! Every `Command`/spawn goes through `proc::program_async` (issue 172): the
//! console-flashing bug that module exists to prevent applies here exactly as
//! much as anywhere else that shells out on Windows.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The three platforms this module has a story for, decoupled from the
/// actual host. `HostPlatform::current()` is the only place `cfg!(target_os =
/// …)` is read here, so [`reveal_plan`] and [`terminal_plan`] are pure
/// functions of their arguments and are exercised for all three platforms
/// from any host — the same reasoning `opener.rs::opener_program`'s runtime
/// `cfg!()` check already uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostPlatform {
    MacOs,
    Windows,
    Linux,
}

impl HostPlatform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            HostPlatform::MacOs
        } else if cfg!(target_os = "windows") {
            HostPlatform::Windows
        } else {
            HostPlatform::Linux
        }
    }
}

/// One process to spawn: a program and its argv, nothing else.
#[derive(Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    pub program: OsString,
    pub args: Vec<OsString>,
}

/// Build the argv that reveals `path` in the platform's file manager.
///
/// `is_dir` distinguishes the two jobs a caller means: reveal a FILE (select
/// it inside its parent's window) or reveal a DIRECTORY (open a window on it
/// directly — the repo-tab menu's case, which has no file to select).
///
/// Linux has no portable "select this entry" verb — `xdg-open` only opens a
/// directory — so a file target opens its PARENT directory instead of
/// failing outright; worse than a selection, still strictly better than an
/// error for a command whose whole point is "get me there".
pub fn reveal_plan(platform: HostPlatform, path: &Path, is_dir: bool) -> SpawnPlan {
    match platform {
        HostPlatform::MacOs => SpawnPlan {
            program: OsString::from("open"),
            args: vec![OsString::from("-R"), path.as_os_str().to_owned()],
        },
        HostPlatform::Windows => {
            let args = if is_dir {
                vec![path.as_os_str().to_owned()]
            } else {
                // `/select,<path>` is ONE argument — anything after the comma,
                // including a space, is part of the path being selected.
                let mut arg = OsString::from("/select,");
                arg.push(path.as_os_str());
                vec![arg]
            };
            SpawnPlan {
                program: OsString::from("explorer.exe"),
                args,
            }
        }
        HostPlatform::Linux => {
            let target: PathBuf = if is_dir {
                path.to_path_buf()
            } else {
                path.parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| path.to_path_buf())
            };
            SpawnPlan {
                program: OsString::from("xdg-open"),
                args: vec![target.into_os_string()],
            }
        }
    }
}

/// Build the ordered list of terminal-launch candidates for `dir`.
///
/// macOS and Windows each have exactly one command worth trying. Linux has
/// none that is reliably present, so this is a short ordered fallback list —
/// [`open_terminal`] spawns each in turn, moving on only when a program is
/// genuinely missing. `env_terminal` is `$TERMINAL` — threaded in as a
/// parameter rather than read here, so this stays a pure function testable
/// without mutating process-global environment state.
///
/// Every candidate is spawned with `dir` set as its OWN current directory
/// (see `open_terminal`), not baked into argv, so a terminal that ignores its
/// own argv (`xterm`) still lands in the right place. macOS and the Windows
/// Terminal are the two exceptions: `open -a Terminal` and `wt -d` both
/// require the directory spelled out as an argument to land there at all.
pub fn terminal_plan(platform: HostPlatform, dir: &Path, env_terminal: Option<&OsStr>) -> Vec<SpawnPlan> {
    match platform {
        HostPlatform::MacOs => vec![SpawnPlan {
            program: OsString::from("open"),
            args: vec![
                OsString::from("-a"),
                OsString::from("Terminal"),
                dir.as_os_str().to_owned(),
            ],
        }],
        HostPlatform::Windows => vec![
            SpawnPlan {
                program: OsString::from("wt.exe"),
                args: vec![OsString::from("-d"), dir.as_os_str().to_owned()],
            },
            // Every Windows install has `cmd.exe`, even with no Windows
            // Terminal — the fallback of last resort. `start` detaches the
            // new window; the empty title argument is `start`'s own syntax
            // for "no window title", required whenever the target might
            // contain characters `start` would otherwise read as its title.
            SpawnPlan {
                program: OsString::from("cmd.exe"),
                args: vec![
                    OsString::from("/C"),
                    OsString::from("start"),
                    OsString::new(),
                    OsString::from("cmd.exe"),
                ],
            },
        ],
        HostPlatform::Linux => {
            let mut plans = Vec::new();
            if let Some(term) = env_terminal {
                if !term.is_empty() {
                    plans.push(SpawnPlan {
                        program: term.to_owned(),
                        args: Vec::new(),
                    });
                }
            }
            for prog in [
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "xterm",
            ] {
                plans.push(SpawnPlan {
                    program: OsString::from(prog),
                    args: Vec::new(),
                });
            }
            plans
        }
    }
}

/// Reveal `path` in the platform's file manager (`is_dir`: see
/// [`reveal_plan`]).
pub async fn reveal(path: &Path, is_dir: bool) -> AppResult<()> {
    let plan = reveal_plan(HostPlatform::current(), path, is_dir);
    let shown = plan.program.to_string_lossy().to_string();
    let status = crate::proc::program_async(&plan.program)
        .args(&plan.args)
        .status()
        .await
        .map_err(|e| AppError::Io(format!("failed to run {shown}: {e}")))?;
    // `explorer.exe /select,<path>` exits 1 on SUCCESS — Explorer's own
    // documented behaviour, not a failure. Every other launcher here follows
    // the ordinary 0-is-success convention.
    if !status.success() && shown != "explorer.exe" {
        return Err(AppError::Io(format!(
            "{shown} exited with {status} while revealing {}",
            path.to_string_lossy()
        )));
    }
    Ok(())
}

/// Open a terminal at `dir`, trying [`terminal_plan`]'s candidates in order
/// and moving to the next on a "program not found" error. Every other spawn
/// failure is returned immediately; running out of candidates (only reachable
/// on Linux — macOS and Windows always have their one candidate) raises a
/// clear error naming what was tried, rather than doing nothing silently.
///
/// Deliberately `spawn()`, not `status().await`: a terminal is a long-running
/// program, and waiting for it to exit would block the app until the user
/// closes the window.
pub async fn open_terminal(dir: &Path) -> AppResult<()> {
    let env_terminal = std::env::var_os("TERMINAL");
    let plans = terminal_plan(HostPlatform::current(), dir, env_terminal.as_deref());
    let mut tried = Vec::new();
    for plan in &plans {
        let shown = plan.program.to_string_lossy().to_string();
        let mut cmd = crate::proc::program_async(&plan.program);
        cmd.args(&plan.args).current_dir(dir);
        match cmd.spawn() {
            Ok(_) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                tried.push(shown);
            }
            Err(e) => return Err(AppError::Io(format!("failed to run {shown}: {e}"))),
        }
    }
    Err(AppError::Io(format!(
        "no terminal emulator found (tried: {})",
        tried.join(", ")
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveal_macos_selects_the_file() {
        let plan = reveal_plan(HostPlatform::MacOs, Path::new("/tmp/repo/a.txt"), false);
        assert_eq!(plan.program, "open");
        assert_eq!(
            plan.args,
            vec![OsString::from("-R"), OsString::from("/tmp/repo/a.txt")]
        );
    }

    #[test]
    fn reveal_macos_opens_a_directory_the_same_way() {
        let plan = reveal_plan(HostPlatform::MacOs, Path::new("/tmp/repo"), true);
        assert_eq!(
            plan.args,
            vec![OsString::from("-R"), OsString::from("/tmp/repo")]
        );
    }

    #[test]
    fn reveal_windows_selects_the_file_as_one_argument() {
        let plan = reveal_plan(HostPlatform::Windows, Path::new(r"C:\repo\a.txt"), false);
        assert_eq!(plan.program, "explorer.exe");
        assert_eq!(plan.args, vec![OsString::from(r"/select,C:\repo\a.txt")]);
    }

    #[test]
    fn reveal_windows_opens_a_directory_plainly() {
        let plan = reveal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), true);
        assert_eq!(plan.args, vec![OsString::from(r"C:\repo")]);
    }

    #[test]
    fn reveal_linux_opens_the_parent_of_a_file() {
        let plan = reveal_plan(HostPlatform::Linux, Path::new("/tmp/repo/a.txt"), false);
        assert_eq!(plan.program, "xdg-open");
        assert_eq!(plan.args, vec![OsString::from("/tmp/repo")]);
    }

    #[test]
    fn reveal_linux_opens_a_directory_directly() {
        let plan = reveal_plan(HostPlatform::Linux, Path::new("/tmp/repo"), true);
        assert_eq!(plan.args, vec![OsString::from("/tmp/repo")]);
    }

    #[test]
    fn terminal_macos_opens_terminal_app_at_dir() {
        let plans = terminal_plan(HostPlatform::MacOs, Path::new("/tmp/repo"), None);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].program, "open");
        assert_eq!(
            plans[0].args,
            vec![
                OsString::from("-a"),
                OsString::from("Terminal"),
                OsString::from("/tmp/repo"),
            ]
        );
    }

    #[test]
    fn terminal_windows_tries_windows_terminal_then_falls_back_to_cmd() {
        let plans = terminal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), None);
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].program, "wt.exe");
        assert_eq!(
            plans[0].args,
            vec![OsString::from("-d"), OsString::from(r"C:\repo")]
        );
        assert_eq!(plans[1].program, "cmd.exe");
    }

    #[test]
    fn terminal_linux_prefers_the_env_terminal_when_set() {
        let plans = terminal_plan(
            HostPlatform::Linux,
            Path::new("/tmp/repo"),
            Some(OsStr::new("alacritty")),
        );
        assert_eq!(plans[0].program, "alacritty");
        assert!(plans[0].args.is_empty());
        // The rest of the fallback list still follows.
        assert!(plans.iter().any(|p| p.program == "xterm"));
    }

    #[test]
    fn terminal_linux_falls_back_through_a_fixed_list_with_no_env_terminal() {
        let plans = terminal_plan(HostPlatform::Linux, Path::new("/tmp/repo"), None);
        let progs: Vec<_> = plans.iter().map(|p| p.program.to_string_lossy().to_string()).collect();
        assert_eq!(
            progs,
            vec![
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "xterm",
            ]
        );
    }

    #[test]
    fn terminal_linux_ignores_an_empty_env_terminal() {
        let plans = terminal_plan(HostPlatform::Linux, Path::new("/tmp/repo"), Some(OsStr::new("")));
        assert_eq!(plans[0].program, "x-terminal-emulator");
    }
}
