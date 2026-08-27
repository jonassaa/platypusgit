//! "Reveal in Finder / Explorer" and "Open in terminal" (issue 215).
//!
//! Companion to `opener.rs` (which hands a path to the app that OWNS the
//! file) — this hands it to the OS's shell chrome instead: the file manager
//! or a terminal emulator. No path or filename ever reaches a shell
//! interpreter; every argv is built as a `Vec<OsString>` and passed straight
//! to `Command`, never joined into a string.
//!
//! Every `Command`/spawn goes through `proc::program_async` (issue 172): the
//! console-flashing bug that module exists to prevent applies here exactly as
//! much as anywhere else that shells out on Windows.
//!
//! # Why the environment is a parameter, not a global read
//!
//! `HostPlatform::current()` and `HostEnv::current()` are the only places this
//! module reads the actual host. Everything else — [`reveal_plan`],
//! [`terminal_plan`] — is a pure function of its arguments, so all three
//! platforms' argv (and the Windows path pinning below, which depends on
//! `%SystemRoot%`) are unit-tested from any host with nothing spawned. Same
//! reasoning as `opener.rs::opener_program`'s runtime `cfg!()` check.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The three platforms this module has a story for, decoupled from the
/// actual host.
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

/// The pieces of the host environment the plans need, threaded in rather than
/// read inside them so the planners stay pure (see the module doc).
#[derive(Debug, Clone, Default)]
pub struct HostEnv {
    /// `%SystemRoot%` — where `System32` lives. Windows only.
    pub system_root: Option<OsString>,
    /// `%LOCALAPPDATA%` — where the Windows Terminal execution alias lives.
    /// Windows only.
    pub local_app_data: Option<OsString>,
    /// `$TERMINAL`, the de-facto "my terminal emulator" variable. Linux only.
    pub terminal: Option<OsString>,
}

impl HostEnv {
    pub fn current() -> Self {
        HostEnv {
            system_root: std::env::var_os("SystemRoot"),
            local_app_data: std::env::var_os("LOCALAPPDATA"),
            terminal: std::env::var_os("TERMINAL"),
        }
    }
}

/// Absolute path to a Windows **system** executable.
///
/// SECURITY: `CreateProcess` searches the **current directory before the
/// system directory**, so spawning a bare `explorer.exe` / `cmd.exe` is a
/// binary-planting hole — a cloned repository containing its own `cmd.exe`
/// would be run instead of the real one. That is not hypothetical here: the
/// app's cwd *is* a repository whenever the `pgit` shim launched it from
/// inside one, and [`open_terminal`] additionally sets the repository as the
/// child's `current_dir`. `opener.rs::opener_program` pins `rundll32.exe` for
/// exactly this reason; the same pin applies to every launcher below.
///
/// `C:\Windows` is the fallback when `%SystemRoot%` is somehow unset — a fixed
/// absolute path is still infinitely better than a relative lookup.
fn system32_exe(env: &HostEnv, exe: &str) -> OsString {
    let root = env
        .system_root
        .clone()
        .unwrap_or_else(|| OsString::from(r"C:\Windows"));
    Path::new(&root).join("System32").join(exe).into_os_string()
}

/// Absolute path to the Windows Terminal execution alias.
///
/// `wt.exe` is not in `System32` — it is an App Execution Alias the Store
/// install drops in `%LOCALAPPDATA%\Microsoft\WindowsApps`. Same planting
/// argument as [`system32_exe`], so it is pinned there rather than looked up
/// on `PATH`. `None` when `%LOCALAPPDATA%` is unset: the candidate is then
/// skipped entirely and the `cmd.exe` fallback takes over, which is the right
/// trade — an unresolvable terminal costs a nicer window, a planted one costs
/// the machine.
fn windows_terminal_exe(env: &HostEnv) -> Option<OsString> {
    let local = env.local_app_data.as_ref()?;
    Some(
        Path::new(local)
            .join("Microsoft")
            .join("WindowsApps")
            .join("wt.exe")
            .into_os_string(),
    )
}

/// One process to spawn: a program and its argv.
#[derive(Debug, PartialEq, Eq)]
pub struct SpawnPlan {
    pub program: OsString,
    pub args: Vec<OsString>,
    /// This launcher's exit code carries no information about success.
    ///
    /// `explorer.exe` is the only one: it exits **1 on success** — its own
    /// documented behaviour, not a failure. Carried as a flag on the plan
    /// rather than recovered by comparing `program` against `"explorer.exe"`,
    /// because `program` is an absolute pinned path (see [`system32_exe`]) and
    /// a name comparison would silently stop matching, turning every
    /// successful reveal on Windows into a reported error.
    pub exit_status_meaningless: bool,
}

impl SpawnPlan {
    fn new(program: impl Into<OsString>, args: Vec<OsString>) -> Self {
        SpawnPlan {
            program: program.into(),
            args,
            exit_status_meaningless: false,
        }
    }
}

/// Build the argv that reveals `path` in the platform's file manager.
///
/// `is_dir` distinguishes the two jobs a caller means: reveal a FILE (select
/// it inside its parent's window) or reveal a DIRECTORY (open a window on it
/// directly — the repo-tab menu's case, which has no file to select). All
/// three platforms honour that distinction, so the repo tab behaves the same
/// everywhere.
///
/// Linux has no portable "select this entry" verb — `xdg-open` only opens a
/// directory — so a file target opens its PARENT directory instead of
/// failing outright; worse than a selection, still strictly better than an
/// error for a command whose whole point is "get me there".
pub fn reveal_plan(platform: HostPlatform, path: &Path, is_dir: bool, env: &HostEnv) -> SpawnPlan {
    match platform {
        // `open -R` reveals a file by SELECTING it in its parent window; for a
        // directory the useful answer is a window on the directory itself, which
        // is plain `open`. Without this split the repo tab's "Reveal in Finder"
        // would select the repo in its parent while Windows and Linux opened it.
        HostPlatform::MacOs => {
            let args = if is_dir {
                vec![path.as_os_str().to_owned()]
            } else {
                vec![OsString::from("-R"), path.as_os_str().to_owned()]
            };
            SpawnPlan::new("open", args)
        }
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
            let mut plan = SpawnPlan::new(system32_exe(env, "explorer.exe"), args);
            plan.exit_status_meaningless = true;
            plan
        }
        HostPlatform::Linux => {
            let target: PathBuf = if is_dir {
                path.to_path_buf()
            } else {
                path.parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| path.to_path_buf())
            };
            SpawnPlan::new("xdg-open", vec![target.into_os_string()])
        }
    }
}

/// Build the ordered list of terminal-launch candidates for `dir`.
///
/// macOS and Windows each have one or two commands worth trying. Linux has
/// none that is reliably present, so this is a short ordered fallback list —
/// [`open_terminal`] spawns each in turn, moving on only when a program is
/// genuinely missing.
///
/// Every candidate is spawned with `dir` set as its OWN current directory
/// (see `open_terminal`), not baked into argv, so a terminal that ignores its
/// own argv (`xterm`) still lands in the right place. macOS and the Windows
/// Terminal are the two exceptions: `open -a Terminal` and `wt -d` both
/// require the directory spelled out as an argument to land there at all.
pub fn terminal_plan(platform: HostPlatform, dir: &Path, env: &HostEnv) -> Vec<SpawnPlan> {
    match platform {
        HostPlatform::MacOs => vec![SpawnPlan::new(
            "open",
            vec![
                OsString::from("-a"),
                OsString::from("Terminal"),
                dir.as_os_str().to_owned(),
            ],
        )],
        HostPlatform::Windows => {
            let mut plans = Vec::new();
            if let Some(wt) = windows_terminal_exe(env) {
                plans.push(SpawnPlan::new(
                    wt,
                    vec![OsString::from("-d"), dir.as_os_str().to_owned()],
                ));
            }
            // Every Windows install has `cmd.exe`, even with no Windows
            // Terminal — the fallback of last resort. `start` is what gives the
            // new `cmd.exe` a console of its own; spawning it directly would
            // leave an invisible shell nobody can type into. The empty title
            // argument is `start`'s own syntax for "no window title".
            //
            // No path or filename is interpolated here — every element is a
            // literal, and the directory arrives via `current_dir`, not argv —
            // so this is not the `cmd /C start "" <target>` injection
            // `opener.rs`'s module doc describes.
            plans.push(SpawnPlan::new(
                system32_exe(env, "cmd.exe"),
                vec![
                    OsString::from("/C"),
                    OsString::from("start"),
                    OsString::new(),
                    system32_exe(env, "cmd.exe"),
                ],
            ));
            plans
        }
        HostPlatform::Linux => {
            let mut plans = Vec::new();
            if let Some(term) = env.terminal.as_ref() {
                if !term.is_empty() {
                    plans.push(SpawnPlan::new(term.clone(), Vec::new()));
                }
            }
            for prog in [
                "x-terminal-emulator",
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "xterm",
            ] {
                plans.push(SpawnPlan::new(prog, Vec::new()));
            }
            plans
        }
    }
}

/// What a reveal of `relative` inside `workdir` should actually target:
/// `(path, is_dir)` for [`reveal_plan`].
///
/// `None` or `""` means the repository itself — the repo tab's menu, which has
/// no entry to select.
///
/// **`is_dir` is read from the filesystem, not passed in.** A directory row and
/// a file row want the two different jobs `reveal_plan` describes, and the
/// filesystem is the only authority on which one a path is: a caller-supplied
/// flag is a second source of truth that can disagree (libgit2 spells an
/// embedded repository with a trailing slash, a folder row in the tree carries
/// no status entry at all), and being wrong means selecting a directory in its
/// parent instead of opening it. Reading it here also means every existing call
/// site got directory rows right the moment this landed, with no signature
/// change (#245).
pub fn reveal_target(workdir: &Path, relative: Option<&str>) -> AppResult<(PathBuf, bool)> {
    match relative {
        Some(rel) if !rel.is_empty() => {
            let abs = crate::opener::safe_workdir_path(workdir, rel)?;
            let is_dir = abs.is_dir();
            Ok((abs, is_dir))
        }
        _ => Ok((workdir.to_path_buf(), true)),
    }
}

/// Which directory a terminal for `relative` should open in.
///
/// A FILE reveals where it lives, so its containing directory is the answer; a
/// DIRECTORY is already the answer and must not be replaced by its parent —
/// same filesystem-is-the-authority reasoning as [`reveal_target`], and the same
/// bug if it is skipped (a terminal for `src/` landing in the repo root).
pub fn terminal_target(workdir: &Path, relative: Option<&str>) -> AppResult<PathBuf> {
    let (abs, is_dir) = reveal_target(workdir, relative)?;
    if is_dir {
        return Ok(abs);
    }
    Ok(abs
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| workdir.to_path_buf()))
}

/// Reveal `path` in the platform's file manager (`is_dir`: see
/// [`reveal_plan`]).
pub async fn reveal(path: &Path, is_dir: bool) -> AppResult<()> {
    let plan = reveal_plan(
        HostPlatform::current(),
        path,
        is_dir,
        &HostEnv::current(),
    );
    let shown = plan.program.to_string_lossy().to_string();
    let status = crate::proc::program_async(&plan.program)
        .args(&plan.args)
        .status()
        .await
        .map_err(|e| AppError::Io(format!("failed to run {shown}: {e}")))?;
    if !status.success() && !plan.exit_status_meaningless {
        return Err(AppError::Io(format!(
            "{shown} exited with {status} while revealing {}",
            path.to_string_lossy()
        )));
    }
    Ok(())
}

/// Open a terminal at `dir`, trying [`terminal_plan`]'s candidates in order
/// and moving to the next on a "program not found" error. Every other spawn
/// failure is returned immediately; running out of candidates raises a clear
/// error naming what was tried, rather than doing nothing silently.
///
/// Deliberately `spawn()`, not `status().await`: a terminal is a long-running
/// program, and waiting for it to exit would block the app until the user
/// closes the window.
///
/// Deliberately the *silenced* `proc::program_async` rather than
/// `program_async_keeping_console`, even though a terminal is the archetypal
/// interactive console program: the two Windows candidates do not need an
/// inherited console. `wt.exe` is a GUI application, so `CREATE_NO_WINDOW` is
/// documented as ignored for it, and the `cmd.exe` fallback gets its window
/// from `start`, which creates a fresh console regardless of what the parent
/// has. So no exception to `proc.rs`'s rule is needed here.
pub async fn open_terminal(dir: &Path) -> AppResult<()> {
    let plans = terminal_plan(HostPlatform::current(), dir, &HostEnv::current());
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

    /// The pinned paths are built with `Path::join`, which uses the HOST's
    /// separator — these planners are pure and run on any host, so the
    /// expectation has to be built the same way rather than hard-coding `\\`.
    /// What the assertions pin is that the program is absolute and under the
    /// right system directory, not which slash this machine happens to use.
    fn win_path(parts: &[&str]) -> OsString {
        let mut p = PathBuf::from(parts[0]);
        for part in &parts[1..] {
            p.push(part);
        }
        p.into_os_string()
    }

    /// A Windows host with the two variables the pinning depends on.
    fn win_env() -> HostEnv {
        HostEnv {
            system_root: Some(OsString::from(r"C:\Windows")),
            local_app_data: Some(OsString::from(r"C:\Users\dev\AppData\Local")),
            terminal: None,
        }
    }

    fn linux_env(terminal: Option<&str>) -> HostEnv {
        HostEnv {
            terminal: terminal.map(OsString::from),
            ..HostEnv::default()
        }
    }

    #[test]
    fn reveal_macos_selects_the_file() {
        let plan = reveal_plan(
            HostPlatform::MacOs,
            Path::new("/tmp/repo/a.txt"),
            false,
            &HostEnv::default(),
        );
        assert_eq!(plan.program, "open");
        assert_eq!(
            plan.args,
            vec![OsString::from("-R"), OsString::from("/tmp/repo/a.txt")]
        );
    }

    #[test]
    fn reveal_macos_opens_a_directory_rather_than_selecting_it() {
        // `open -R <dir>` would select the repo in its PARENT window, which is
        // not what the repo tab's "Reveal in Finder" means — and would differ
        // from what Windows and Linux do for the same click.
        let plan = reveal_plan(
            HostPlatform::MacOs,
            Path::new("/tmp/repo"),
            true,
            &HostEnv::default(),
        );
        assert_eq!(plan.args, vec![OsString::from("/tmp/repo")]);
    }

    #[test]
    fn reveal_windows_selects_the_file_as_one_argument() {
        let plan = reveal_plan(
            HostPlatform::Windows,
            Path::new(r"C:\repo\a.txt"),
            false,
            &win_env(),
        );
        assert_eq!(plan.args, vec![OsString::from(r"/select,C:\repo\a.txt")]);
    }

    #[test]
    fn reveal_windows_opens_a_directory_plainly() {
        let plan = reveal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), true, &win_env());
        assert_eq!(plan.args, vec![OsString::from(r"C:\repo")]);
    }

    #[test]
    fn reveal_windows_pins_explorer_to_system32() {
        // The binary-planting guard: a repository containing its own
        // `explorer.exe` must never be the thing that runs.
        let plan = reveal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), true, &win_env());
        assert_eq!(plan.program, win_path(&[r"C:\Windows", "System32", "explorer.exe"]));
    }

    #[test]
    fn reveal_windows_falls_back_to_a_fixed_windows_dir_without_systemroot() {
        let plan = reveal_plan(
            HostPlatform::Windows,
            Path::new(r"C:\repo"),
            true,
            &HostEnv::default(),
        );
        assert_eq!(plan.program, win_path(&[r"C:\Windows", "System32", "explorer.exe"]));
    }

    #[test]
    fn only_explorer_has_a_meaningless_exit_status() {
        // explorer.exe exits 1 on success; nothing else here does, and the flag
        // must not be recovered by comparing the (now absolute) program name.
        assert!(
            reveal_plan(HostPlatform::Windows, Path::new(r"C:\r"), true, &win_env())
                .exit_status_meaningless
        );
        for p in [HostPlatform::MacOs, HostPlatform::Linux] {
            assert!(
                !reveal_plan(p, Path::new("/r"), true, &HostEnv::default())
                    .exit_status_meaningless
            );
        }
    }

    #[test]
    fn reveal_linux_opens_the_parent_of_a_file() {
        let plan = reveal_plan(
            HostPlatform::Linux,
            Path::new("/tmp/repo/a.txt"),
            false,
            &HostEnv::default(),
        );
        assert_eq!(plan.program, "xdg-open");
        assert_eq!(plan.args, vec![OsString::from("/tmp/repo")]);
    }

    #[test]
    fn reveal_linux_opens_a_directory_directly() {
        let plan = reveal_plan(
            HostPlatform::Linux,
            Path::new("/tmp/repo"),
            true,
            &HostEnv::default(),
        );
        assert_eq!(plan.args, vec![OsString::from("/tmp/repo")]);
    }

    #[test]
    fn terminal_macos_opens_terminal_app_at_dir() {
        let plans = terminal_plan(HostPlatform::MacOs, Path::new("/tmp/repo"), &HostEnv::default());
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
        let plans = terminal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), &win_env());
        assert_eq!(plans.len(), 2);
        assert_eq!(
            plans[0].program,
            win_path(&[r"C:\Users\dev\AppData\Local", "Microsoft", "WindowsApps", "wt.exe"])
        );
        assert_eq!(
            plans[0].args,
            vec![OsString::from("-d"), OsString::from(r"C:\repo")]
        );
        // The fallback is pinned too, and so is the shell `start` launches.
        assert_eq!(plans[1].program, win_path(&[r"C:\Windows", "System32", "cmd.exe"]));
        assert_eq!(
            plans[1].args.last().unwrap(),
            &win_path(&[r"C:\Windows", "System32", "cmd.exe"])
        );
    }

    #[test]
    fn terminal_windows_skips_windows_terminal_when_localappdata_is_unset() {
        // Unresolvable beats relative: a bare `wt.exe` would be planting-prone.
        let env = HostEnv {
            system_root: Some(OsString::from(r"C:\Windows")),
            ..HostEnv::default()
        };
        let plans = terminal_plan(HostPlatform::Windows, Path::new(r"C:\repo"), &env);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].program, win_path(&[r"C:\Windows", "System32", "cmd.exe"]));
    }

    #[test]
    fn terminal_linux_prefers_the_env_terminal_when_set() {
        let plans = terminal_plan(
            HostPlatform::Linux,
            Path::new("/tmp/repo"),
            &linux_env(Some("alacritty")),
        );
        assert_eq!(plans[0].program, "alacritty");
        assert!(plans[0].args.is_empty());
        assert!(plans.iter().any(|p| p.program == "xterm"));
    }

    #[test]
    fn terminal_linux_falls_back_through_a_fixed_list_with_no_env_terminal() {
        let plans = terminal_plan(HostPlatform::Linux, Path::new("/tmp/repo"), &linux_env(None));
        let progs: Vec<_> = plans
            .iter()
            .map(|p| p.program.to_string_lossy().to_string())
            .collect();
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
        let plans = terminal_plan(HostPlatform::Linux, Path::new("/tmp/repo"), &linux_env(Some("")));
        assert_eq!(plans[0].program, "x-terminal-emulator");
    }

    // ── reveal_target / terminal_target (#245) ───────────────────────────────
    //
    // These DO touch the filesystem (that is the whole point — the filesystem
    // decides whether a path is a directory), so they run against a tempdir
    // rather than being pure like the planners above.

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/a.txt"), "a").unwrap();
        std::fs::write(dir.path().join("top.txt"), "t").unwrap();
        dir
    }

    #[test]
    fn reveal_target_treats_a_file_as_a_file() {
        let dir = tree();
        let (path, is_dir) = reveal_target(dir.path(), Some("src/a.txt")).unwrap();
        assert_eq!(path, dir.path().join("src/a.txt"));
        assert!(!is_dir, "a file must be SELECTED in its parent, not opened");
    }

    #[test]
    fn reveal_target_treats_a_directory_as_a_directory() {
        // The bug this fixes: the command hard-coded `is_dir: false`, so a
        // folder row ran `open -R src` and selected the folder in the repo root
        // instead of opening a window on it.
        let dir = tree();
        let (path, is_dir) = reveal_target(dir.path(), Some("src")).unwrap();
        assert_eq!(path, dir.path().join("src"));
        assert!(is_dir);
    }

    #[test]
    fn reveal_target_falls_back_to_the_repo_root() {
        let dir = tree();
        for rel in [None, Some("")] {
            let (path, is_dir) = reveal_target(dir.path(), rel).unwrap();
            assert_eq!(path, dir.path());
            assert!(is_dir, "the repo root is a directory target");
        }
    }

    #[test]
    fn reveal_target_treats_a_path_that_does_not_exist_as_a_file() {
        // `is_dir()` answers false for a missing path, which is the right guess:
        // a file target degrades to "open the parent" on Linux and to a failed
        // selection elsewhere, where a directory target would open a window on
        // nothing.
        let dir = tree();
        let (_, is_dir) = reveal_target(dir.path(), Some("gone.txt")).unwrap();
        assert!(!is_dir);
    }

    #[test]
    fn reveal_target_refuses_a_path_outside_the_worktree() {
        let dir = tree();
        assert!(reveal_target(dir.path(), Some("../../etc/passwd")).is_err());
        assert!(reveal_target(dir.path(), Some("/etc/passwd")).is_err());
    }

    #[test]
    fn terminal_target_opens_a_files_parent_but_a_directory_itself() {
        let dir = tree();
        assert_eq!(
            terminal_target(dir.path(), Some("src/a.txt")).unwrap(),
            dir.path().join("src")
        );
        // Not the parent: a terminal asked for `src/` must land in `src/`.
        assert_eq!(
            terminal_target(dir.path(), Some("src")).unwrap(),
            dir.path().join("src")
        );
        assert_eq!(terminal_target(dir.path(), None).unwrap(), dir.path());
    }

    #[test]
    fn terminal_target_for_a_top_level_file_is_the_repo_root() {
        let dir = tree();
        assert_eq!(
            terminal_target(dir.path(), Some("top.txt")).unwrap(),
            dir.path()
        );
    }
}
