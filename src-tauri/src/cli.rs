use std::path::{Path, PathBuf};

use serde::Serialize;

/// What a CLI invocation asked for. `path` is absolute (resolved against the
/// invoking shell's cwd); `screen` is a frontend ScreenId string.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchIntent {
    pub path: Option<PathBuf>,
    pub screen: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Parsed {
    Help,
    /// Invoked as GIT_ASKPASS / SSH_ASKPASS with git's prompt string (#61 D5).
    /// Internal contract between the app and its own subprocesses — deliberately
    /// absent from USAGE.
    Askpass(String),
    /// `None` = plain app launch (no CLI args at all).
    Launch(Option<LaunchIntent>),
}

/// Env vars the parent process sets so the askpass shim can answer without any
/// IPC back to the app.
///
/// Values travel in the environment rather than argv: argv is world-readable
/// via `ps` on macOS and Linux, a process's environment is not (#61 D5).
pub const ASKPASS_USERNAME_ENV: &str = "PLATYPUSGIT_ASKPASS_USERNAME";
pub const ASKPASS_SECRET_ENV: &str = "PLATYPUSGIT_ASKPASS_SECRET";

/// Presence of this var puts the process into askpass-shim mode, with git's
/// prompt as the first argument.
///
/// This exists because **`GIT_ASKPASS` is exec'd directly, not run through a
/// shell**: verified experimentally, `GIT_ASKPASS="<exe> --askpass"` fails with
/// `cannot exec '<exe> --askpass'`. The alternatives were writing a wrapper
/// script to disk or installing an argv[0] symlink; both need a writable
/// directory and would be one more thing an attacker could replace before we
/// exec it. An env flag needs neither, so `GIT_ASKPASS` can point at the bare
/// executable.
pub const ASKPASS_MODE_ENV: &str = "PLATYPUSGIT_ASKPASS";

/// Which answer a git/ssh askpass prompt is asking for.
#[derive(Debug, PartialEq)]
pub enum AskpassWant {
    Username,
    Secret,
}

/// Classify an askpass prompt. `None` for anything unrecognized — the shim must
/// never guess at a prompt it does not understand.
pub fn askpass_want(prompt: &str) -> Option<AskpassWant> {
    let p = prompt.to_lowercase();
    if p.contains("username") {
        return Some(AskpassWant::Username);
    }
    if p.contains("password") || p.contains("passphrase") {
        return Some(AskpassWant::Secret);
    }
    None
}

/// The value the shim should print, or `None` to print nothing and exit
/// non-zero.
///
/// An absent value is never substituted with an empty string: git would take
/// that as a real (wrong) credential and burn an authentication attempt.
pub fn askpass_answer(
    prompt: &str,
    username: Option<&str>,
    secret: Option<&str>,
) -> Option<String> {
    match askpass_want(prompt)? {
        AskpassWant::Username => username.map(str::to_string),
        AskpassWant::Secret => secret.map(str::to_string),
    }
}

pub const USAGE: &str = "\
PlatypusGit

Usage: pgit [subcommand] [path]

Subcommands:
  commit | status           open the Commit panel
  log | history             open the History screen
  branches | branch         open the Branches screen
  files | browse | tree     open the Files screen
  rebase                    open the Rebase screen
  remote | remotes          open the Remotes screen
  pr | prs | pulls          open the Pull requests screen
  reflog                    open the Reflog screen
  submodules                open the Submodules screen
  worktrees                 open the Worktrees screen
  settings | config         open Settings

With a path and no subcommand, opens the repo containing that path.
With a subcommand and no path, uses the current directory.
With no arguments, performs a plain app launch.
";

fn screen_for(token: &str) -> Option<&'static str> {
    match token {
        "commit" | "status" => Some("commit"),
        "log" | "history" => Some("history"),
        "branches" | "branch" => Some("branches"),
        "files" | "browse" | "tree" => Some("repo"),
        "rebase" => Some("rebase"),
        "remote" | "remotes" => Some("remote"),
        "pr" | "prs" | "pulls" => Some("pulls"),
        "reflog" => Some("reflog"),
        "submodules" => Some("submodules"),
        "worktrees" => Some("worktrees"),
        "settings" | "config" => Some("settings"),
        _ => None,
    }
}

fn resolve_path(arg: &str, cwd: &Path) -> PathBuf {
    let p = PathBuf::from(arg);
    if p.is_absolute() {
        p
    } else {
        cwd.join(p)
    }
}

/// Parse CLI args (argv without the binary name). Pure — no filesystem
/// access; relative paths resolve against `cwd`.
pub fn parse_args(args: &[String], cwd: &Path) -> Parsed {
    // Askpass first: the remaining argument is an arbitrary prompt string from
    // git and must not be scanned for our own flags (a prompt could contain
    // "-h" and would otherwise print USAGE to git as the credential).
    if args.first().map(String::as_str) == Some("--askpass") {
        return Parsed::Askpass(args.get(1).cloned().unwrap_or_default());
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Parsed::Help;
    }
    let mut screen: Option<String> = None;
    let mut path: Option<PathBuf> = None;
    for (i, arg) in args.iter().enumerate() {
        if i == 0 {
            if let Some(s) = screen_for(arg) {
                screen = Some(s.to_string());
                continue;
            }
        }
        if path.is_none() {
            path = Some(resolve_path(arg, cwd));
        }
    }
    if screen.is_some() && path.is_none() {
        path = Some(cwd.to_path_buf());
    }
    match (path, &screen) {
        (None, None) => Parsed::Launch(None),
        (path, _) => Parsed::Launch(Some(LaunchIntent { path, screen })),
    }
}

/// Widen a CLI path to its repo workdir root (backend `open` requires the
/// root, CLI users sit in subdirectories). Non-repo paths pass through so
/// the normal open_repo error path reports NotARepo.
pub fn resolve_repo_root(intent: LaunchIntent) -> LaunchIntent {
    let path = intent.path.map(|p| {
        git2::Repository::discover(&p)
            .ok()
            // Through `repo_path_key`, because `workdir()` carries a trailing
            // separator and this path crosses IPC as a STRING that the frontend
            // compares against the one `open` returns. Spelled `/repo/` here it
            // matches no open tab, so a launch with a path already in the
            // restored open set opens the repository a second time and orphans
            // one of the two `RepoId`s (#177). `PathBuf`'s own `==` is
            // component-based and hides this — only the string form shows it.
            .and_then(|r| r.workdir().map(crate::git::repo_path_key))
            // `discover` opens what it finds, so it fails outright on a
            // repository refused for ownership. The walk opens nothing, which
            // is what lets a `pgit` launch from a subdirectory of such a repo
            // still name the root — and the root is the only path a
            // `safe.directory` entry can match.
            .or_else(|| crate::git::ownership::repo_root_for(&p))
            .unwrap_or(p)
    });
    LaunchIntent { path, ..intent }
}

// ─── the `pgit` shim: who owns it (#144) ─────────────────────────────────────
//
// Three parties can put a `pgit` on the user's PATH — a package (Homebrew cask,
// `.deb`, `.msi`), this app's Settings screen, and somebody else — and they must
// not fight. `shim_status` therefore answers "is `pgit` present and does it
// launch THIS app", not "is <one dir>/pgit a symlink to me", and `install_shim`
// refuses to write a second copy when a package already ships one. See
// `docs/superpowers/specs/2026-08-17-pgit-cli-packaging-spec.md` §A.

/// The file name a `pgit` entry point has. Windows has no symlink without
/// elevation or Developer Mode, so the shim is a `.cmd` there and a symlink
/// everywhere else — which is also why `install_shim_at` has two `cfg`
/// implementations rather than one with a branch inside it.
#[cfg(windows)]
pub const SHIM_NAME: &str = "pgit.cmd";
#[cfg(not(windows))]
pub const SHIM_NAME: &str = "pgit";

/// The app binary's name, as every channel installs it. Taken from Cargo rather
/// than written out: the classifier greps for it, so a drift here would silently
/// stop recognising a package-managed shim.
pub const MAIN_BINARY: &str = env!("CARGO_PKG_NAME");

/// A shim file that is text (a wrapper script) is read to see whether it names
/// our binary. Capped, and non-UTF-8 reads as "no" — this must never become a
/// reason to slurp an arbitrary file found on PATH.
const MAX_SHIM_TEXT: u64 = 4096;

/// Who put the `pgit` we found there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CliShimSource {
    /// Nothing found.
    None,
    /// One of *our* shim dirs, referencing this app. Settings offers Reinstall.
    App,
    /// Outside our dirs, referencing this app — a package manager or installer
    /// owns the file. Settings offers no install, and `install_shim` is a no-op
    /// success, so the contract holds even for a caller that forgets.
    Package,
    /// A `pgit` exists but does not launch this app. We never touch it.
    Foreign,
}

/// Whether the directory holding (or about to hold) the shim is reachable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CliPathState {
    /// On the PATH this process sees.
    OnPath,
    /// Not on it, and nothing was done about that.
    OffPath,
    /// Just added to the user's persistent PATH; already-open shells still need
    /// a restart. Only ever produced by an install, never by a status read.
    PathAdded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliShimStatus {
    /// `pgit` is present and launches this app — `App` or `Package`.
    pub installed: bool,
    /// The shim we found, or (when none was) where an install would put one.
    pub shim_path: String,
    pub target: String,
    pub source: CliShimSource,
    /// For `App`/`Package`, the found shim's directory. For `Foreign`/`None`,
    /// the directory an install would target.
    pub path_state: CliPathState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallOutcome {
    pub installed: bool,
    pub path: String,
    /// Set when we couldn't write the shim at all (permissions): the command the
    /// user should run themselves. Not an error — Settings renders it.
    pub manual_command: Option<String>,
    pub path_state: CliPathState,
}

/// The OS whose shim-directory table applies. Explicit rather than `cfg!` at the
/// point of use so all three tables are testable from any host — two of the
/// three cannot otherwise be exercised at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShimOs {
    Macos,
    Linux,
    Windows,
    Other,
}

pub const CURRENT_SHIM_OS: ShimOs = if cfg!(target_os = "macos") {
    ShimOs::Macos
} else if cfg!(target_os = "linux") {
    ShimOs::Linux
} else if cfg!(windows) {
    ShimOs::Windows
} else {
    ShimOs::Other
};

/// Directories the app itself may write the shim into, most preferred first.
///
/// macOS leads with `/usr/local/bin` because it is the only entry on the default
/// PATH and where every existing install already is — but it is *tried*, not
/// assumed: `install_shim` walks this list and takes the first one it can write,
/// so a machine where it is root-owned (any stock Apple Silicon Mac) falls
/// through to `~/.local/bin` with no sudo. That fallback is usually off PATH,
/// which is reported rather than hidden.
pub fn shim_dirs_for(
    os: ShimOs,
    home: Option<&Path>,
    local_app_data: Option<&Path>,
) -> Vec<PathBuf> {
    match os {
        ShimOs::Macos => {
            let mut dirs = vec![PathBuf::from("/usr/local/bin")];
            if let Some(home) = home {
                dirs.push(home.join(".local/bin"));
                dirs.push(home.join("bin"));
            }
            dirs
        }
        ShimOs::Linux | ShimOs::Other => home
            .map(|home| vec![home.join(".local/bin"), home.join("bin")])
            .unwrap_or_default(),
        // Per-user, no admin, and the directory `add_user_path` appends.
        ShimOs::Windows => local_app_data
            .map(|dir| vec![dir.join("PlatypusGit").join("bin")])
            .unwrap_or_default(),
    }
}

/// Paths a package or installer owns. We never write these, only recognise them.
///
/// `exe_dir` covers the MSI (`<INSTALLDIR>\pgit.cmd`) and is probed directly
/// rather than via PATH, because the MSI's machine-PATH entry may not have
/// reached this process's environment yet.
pub fn package_shim_paths_for(os: ShimOs, exe_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = exe_dir {
        paths.push(dir.join(SHIM_NAME));
    }
    if matches!(os, ShimOs::Linux | ShimOs::Other) {
        paths.push(PathBuf::from("/usr/bin").join(SHIM_NAME));
    }
    paths
}

/// PATH entries in order, empty entries dropped (an empty entry means "cwd",
/// which is never where a shim lives and would make the scan order nonsense).
pub fn path_dirs(path_var: Option<&std::ffi::OsStr>) -> Vec<PathBuf> {
    match path_var {
        Some(value) => std::env::split_paths(value)
            .filter(|p| !p.as_os_str().is_empty())
            .collect(),
        None => Vec::new(),
    }
}

/// Every place to look, in the order it is looked at: our own dirs, then known
/// package paths, then PATH. Ours comes first because "did *we* install this" is
/// what the Reinstall button depends on; what a shell would actually run is
/// reported separately as `path_state` rather than by reordering this.
pub fn shim_scan_order(
    app_dirs: &[PathBuf],
    package_paths: &[PathBuf],
    path_dirs: &[PathBuf],
) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let push = |out: &mut Vec<PathBuf>, candidate: PathBuf| {
        if !out.contains(&candidate) {
            out.push(candidate);
        }
    };
    for dir in app_dirs {
        push(&mut out, dir.join(SHIM_NAME));
    }
    for path in package_paths {
        push(&mut out, path.clone());
    }
    for dir in path_dirs {
        push(&mut out, dir.join(SHIM_NAME));
    }
    out
}

/// Does this shim launch our app? Three probes, because the three channels ship
/// three different kinds of file: a symlink to us (self-install, Homebrew cask),
/// a symlink whose name is our binary (a cask symlink surviving an app move),
/// and a wrapper script mentioning our binary (the deb wrapper, the MSI `.cmd`).
pub fn references_app(
    link: Option<&Path>,
    text: Option<&str>,
    exe: &Path,
    main_binary: &str,
) -> bool {
    if let Some(link) = link {
        if link == exe {
            return true;
        }
        if link
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.eq_ignore_ascii_case(main_binary))
        {
            return true;
        }
    }
    text.is_some_and(|text| text.contains(main_binary))
}

/// `App` when the shim sits in a directory we write, `Package` when it launches
/// us from anywhere else, `Foreign` when it does not launch us at all.
pub fn classify_sighting(
    path: &Path,
    app_dirs: &[PathBuf],
    link: Option<&Path>,
    text: Option<&str>,
    exe: &Path,
    main_binary: &str,
) -> CliShimSource {
    if !references_app(link, text, exe, main_binary) {
        return CliShimSource::Foreign;
    }
    let ours = path
        .parent()
        .is_some_and(|parent| app_dirs.iter().any(|dir| dir == parent));
    if ours {
        CliShimSource::App
    } else {
        CliShimSource::Package
    }
}

/// Exact directory match, never a prefix: `/usr/local/binaries` is not
/// `/usr/local/bin`.
pub fn dir_on_path(dir: &Path, path_dirs: &[PathBuf]) -> CliPathState {
    if path_dirs.iter().any(|entry| entry == dir) {
        CliPathState::OnPath
    } else {
        CliPathState::OffPath
    }
}

/// What we could read about a shim file. `None` means "nothing is there".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShimSighting {
    pub path: PathBuf,
    /// Symlink target, absolutised against the link's own directory (a relative
    /// symlink would otherwise never compare equal to `current_exe()`).
    pub link: Option<PathBuf>,
    pub text: Option<String>,
}

fn probe_shim(path: &Path) -> Option<ShimSighting> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        let link = std::fs::read_link(path).ok().map(|target| {
            if target.is_absolute() {
                target
            } else {
                path.parent().map(|dir| dir.join(&target)).unwrap_or(target)
            }
        });
        return Some(ShimSighting {
            path: path.to_path_buf(),
            link,
            text: None,
        });
    }
    let text = if meta.is_file() && meta.len() <= MAX_SHIM_TEXT {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    } else {
        None
    };
    Some(ShimSighting {
        path: path.to_path_buf(),
        link: None,
        text,
    })
}

/// Directories this app may write the shim into, for the running platform.
pub fn app_shim_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    shim_dirs_for(CURRENT_SHIM_OS, home.as_deref(), local_app_data.as_deref())
}

fn current_path_dirs() -> Vec<PathBuf> {
    path_dirs(std::env::var_os("PATH").as_deref())
}

#[cfg(unix)]
pub fn install_shim_at(dir: &Path, exe: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let link = dir.join(SHIM_NAME);
    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(&link)?;
    }
    std::os::unix::fs::symlink(exe, &link)?;
    Ok(link)
}

/// The `pgit.cmd` body. Pure, and deliberately not `cfg`-gated so it is testable
/// on any host.
pub fn shim_cmd_body(exe: &Path) -> String {
    format!("@echo off\r\n\"{}\" %*\r\n", exe.display())
}

#[cfg(windows)]
pub fn install_shim_at(dir: &Path, exe: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let shim = dir.join(SHIM_NAME);
    std::fs::write(&shim, shim_cmd_body(exe))?;
    Ok(shim)
}

#[cfg(unix)]
pub fn shim_installed_at(dir: &Path, exe: &Path) -> bool {
    std::fs::read_link(dir.join(SHIM_NAME))
        .map(|target| target == exe)
        .unwrap_or(false)
}

#[cfg(windows)]
pub fn shim_installed_at(dir: &Path, exe: &Path) -> bool {
    std::fs::read_to_string(dir.join(SHIM_NAME))
        .map(|body| body == shim_cmd_body(exe))
        .unwrap_or(false)
}

/// The PATH-appending half of a Windows install. See the script's own header for
/// why it is PowerShell and not `setx` or a bare
/// `[Environment]::SetEnvironmentVariable`.
pub const WINDOWS_PATH_SCRIPT: &str = include_str!("../windows/add-user-path.ps1");

/// Append `dir` to the user's persistent PATH. Best effort: a failure means the
/// file half still succeeded and the caller reports `OffPath`.
#[cfg(windows)]
fn add_user_path(dir: &Path) -> bool {
    use std::io::Write;
    use std::process::Stdio;

    // The directory travels in the environment, not argv: `-Command` takes a
    // script, and a path is user-controlled text.
    //
    // CREATE_NO_WINDOW comes from `proc::program` — this call site had it
    // hand-rolled first, and its comment named the failure mode that then went
    // ungeneralised across the other 19 spawn sites (issue 172).
    let child = crate::proc::program("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "-"])
        .env("PGIT_BIN_DIR", dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return false;
    };
    if let Some(stdin) = child.stdin.as_mut() {
        if stdin.write_all(WINDOWS_PATH_SCRIPT.as_bytes()).is_err() {
            return false;
        }
    }
    drop(child.stdin.take());
    child.wait().map(|status| status.success()).unwrap_or(false)
}

pub fn shim_status() -> CliShimStatus {
    let exe = std::env::current_exe().unwrap_or_default();
    let app_dirs = app_shim_dirs();
    let package_paths = package_shim_paths_for(CURRENT_SHIM_OS, exe.parent());
    let path_dirs = current_path_dirs();

    let mut foreign: Option<PathBuf> = None;
    for candidate in shim_scan_order(&app_dirs, &package_paths, &path_dirs) {
        let Some(sighting) = probe_shim(&candidate) else {
            continue;
        };
        match classify_sighting(
            &sighting.path,
            &app_dirs,
            sighting.link.as_deref(),
            sighting.text.as_deref(),
            &exe,
            MAIN_BINARY,
        ) {
            source @ (CliShimSource::App | CliShimSource::Package) => {
                let path_state = sighting
                    .path
                    .parent()
                    .map(|dir| dir_on_path(dir, &path_dirs))
                    .unwrap_or(CliPathState::OffPath);
                return CliShimStatus {
                    installed: true,
                    shim_path: sighting.path.display().to_string(),
                    target: exe.display().to_string(),
                    source,
                    path_state,
                };
            }
            // Remember the first stranger but keep looking: ours may be further
            // down the order.
            CliShimSource::Foreign => foreign = foreign.or(Some(sighting.path)),
            CliShimSource::None => {}
        }
    }

    // Nothing of ours. Report where an install would go, so Settings can warn
    // about an off-PATH target before the click rather than after it.
    let target_dir = app_dirs.first().cloned();
    let path_state = target_dir
        .as_deref()
        .map(|dir| dir_on_path(dir, &path_dirs))
        .unwrap_or(CliPathState::OffPath);
    let (shim_path, source) = match foreign {
        Some(path) => (path, CliShimSource::Foreign),
        None => (
            target_dir.map(|dir| dir.join(SHIM_NAME)).unwrap_or_default(),
            CliShimSource::None,
        ),
    };
    CliShimStatus {
        installed: false,
        shim_path: shim_path.display().to_string(),
        target: exe.display().to_string(),
        source,
        path_state,
    }
}

/// What an install should do about a `pgit` that is already there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallPlan {
    /// Report the existing shim and touch nothing.
    KeepExisting,
    /// Write our own shim.
    Write,
}

/// The install decision, pure — so "a package-managed `pgit` is never
/// overwritten" is testable without a filesystem or a real installation.
///
/// `existing_matches_exe` only matters for `App`: on an Intel Mac Homebrew's
/// prefix IS `/usr/local/bin`, which is also our first shim dir, so a cask
/// symlink classifies `App`. Skipping the rewrite when the link already points
/// at us is what keeps Reinstall from touching a brew-managed link.
pub fn plan_install(source: CliShimSource, existing_matches_exe: bool) -> InstallPlan {
    match source {
        CliShimSource::Package => InstallPlan::KeepExisting,
        CliShimSource::App if existing_matches_exe => InstallPlan::KeepExisting,
        _ => InstallPlan::Write,
    }
}

pub fn install_shim() -> CliInstallOutcome {
    let status = shim_status();

    // Without our own path there's nothing to point the shim at — but a package
    // shim needs no path of ours, so answer that first.
    let exe = std::env::current_exe().ok();
    let existing_matches_exe = exe.as_deref().is_some_and(|exe| {
        Path::new(&status.shim_path)
            .parent()
            .is_some_and(|dir| shim_installed_at(dir, exe))
    });

    if plan_install(status.source, existing_matches_exe) == InstallPlan::KeepExisting {
        return CliInstallOutcome {
            installed: true,
            path: status.shim_path,
            manual_command: None,
            path_state: status.path_state,
        };
    }

    let Some(exe) = exe else {
        return CliInstallOutcome {
            installed: false,
            path: String::new(),
            manual_command: None,
            path_state: CliPathState::OffPath,
        };
    };

    let dirs = app_shim_dirs();
    let path_dirs = current_path_dirs();
    for dir in &dirs {
        // Attempting the write IS the writability test — a separate probe would
        // only add a TOCTOU between probe and write.
        if let Ok(shim) = install_shim_at(dir, &exe) {
            #[allow(unused_mut)]
            let mut path_state = dir_on_path(dir, &path_dirs);
            #[cfg(windows)]
            if path_state == CliPathState::OffPath && add_user_path(dir) {
                path_state = CliPathState::PathAdded;
            }
            return CliInstallOutcome {
                installed: true,
                path: shim.display().to_string(),
                manual_command: None,
                path_state,
            };
        }
    }

    // Nothing writable anywhere. On unix that is now a genuine edge case (no
    // `$HOME`), so the sudo line stays as the last resort it always was.
    let fallback = dirs.first().map(|dir| dir.join(SHIM_NAME));
    let path = fallback
        .as_deref()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let manual_command = if cfg!(unix) && !path.is_empty() {
        Some(format!("sudo ln -sf \"{}\" \"{}\"", exe.display(), path))
    } else {
        None
    };
    let path_state = dirs
        .first()
        .map(|dir| dir_on_path(dir, &path_dirs))
        .unwrap_or(CliPathState::OffPath);
    CliInstallOutcome {
        installed: false,
        path,
        manual_command,
        path_state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn bare_launch_has_no_intent() {
        assert_eq!(parse_args(&[], Path::new("/w")), Parsed::Launch(None));
    }

    #[test]
    fn help_flag_wins() {
        assert_eq!(parse_args(&s(&["--help"]), Path::new("/w")), Parsed::Help);
        assert_eq!(parse_args(&s(&["commit", "-h"]), Path::new("/w")), Parsed::Help);
    }

    #[test]
    fn path_only_opens_repo_without_screen() {
        assert_eq!(
            parse_args(&s(&["/abs/repo"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/abs/repo")),
                screen: None,
            }))
        );
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        assert_eq!(
            parse_args(&s(&["sub/dir"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/sub/dir")),
                screen: None,
            }))
        );
    }

    #[test]
    fn subcommand_without_path_uses_cwd() {
        for (cmd, screen) in [
            ("commit", "commit"),
            ("status", "commit"),
            ("log", "history"),
            ("history", "history"),
            ("branches", "branches"),
            ("branch", "branches"),
            ("files", "repo"),
            ("browse", "repo"),
            ("tree", "repo"),
            ("rebase", "rebase"),
            ("remote", "remote"),
            ("remotes", "remote"),
            ("pr", "pulls"),
            ("prs", "pulls"),
            ("pulls", "pulls"),
            ("reflog", "reflog"),
            ("submodules", "submodules"),
            ("worktrees", "worktrees"),
            ("settings", "settings"),
            ("config", "settings"),
        ] {
            assert_eq!(
                parse_args(&s(&[cmd]), Path::new("/w")),
                Parsed::Launch(Some(LaunchIntent {
                    path: Some(PathBuf::from("/w")),
                    screen: Some(screen.to_string()),
                })),
                "subcommand {cmd}"
            );
        }
    }

    #[test]
    fn subcommand_with_path() {
        assert_eq!(
            parse_args(&s(&["log", "src"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/src")),
                screen: Some("history".to_string()),
            }))
        );
    }

    #[test]
    fn unknown_first_token_is_a_path() {
        assert_eq!(
            parse_args(&s(&["foo"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/foo")),
                screen: None,
            }))
        );
    }

    #[test]
    fn resolve_repo_root_finds_workdir_from_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        git2::Repository::init(&root).unwrap();
        let sub = root.join("a/b");
        std::fs::create_dir_all(&sub).unwrap();
        let out = resolve_repo_root(LaunchIntent {
            path: Some(sub),
            screen: None,
        });
        assert_eq!(out.path, Some(root));
    }

    #[test]
    fn resolve_repo_root_spells_the_root_exactly_as_open_does() {
        // libgit2's `workdir()` returns a path WITH a trailing separator, and a
        // `LaunchIntent.path` crosses IPC as a STRING — so the frontend would
        // compare "/repo/" against the "/repo" `open` hands back and conclude the
        // repository is not open yet (#177). `PathBuf`'s own `==` is
        // component-based and reports the two equal, which is why this has to
        // assert on the string form.
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        git2::Repository::init(&root).unwrap();
        let sub = root.join("a/b");
        std::fs::create_dir_all(&sub).unwrap();
        let out = resolve_repo_root(LaunchIntent {
            path: Some(sub),
            screen: None,
        });
        let spelled = out.path.unwrap().to_string_lossy().to_string();
        assert_eq!(spelled, root.to_string_lossy());
    }

    #[test]
    fn resolve_repo_root_passes_non_repo_through() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("nowhere");
        let out = resolve_repo_root(LaunchIntent {
            path: Some(p.clone()),
            screen: Some("commit".into()),
        });
        assert_eq!(out.path, Some(p));
        assert_eq!(out.screen, Some("commit".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn install_shim_creates_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("platypusgit");
        std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
        let link = install_shim_at(dir.path(), &exe).unwrap();
        assert_eq!(link, dir.path().join("pgit"));
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        assert!(shim_installed_at(dir.path(), &exe));
    }

    #[cfg(unix)]
    #[test]
    fn install_shim_replaces_stale_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old-exe");
        let new = dir.path().join("new-exe");
        std::fs::write(&old, b"x").unwrap();
        std::fs::write(&new, b"x").unwrap();
        install_shim_at(dir.path(), &old).unwrap();
        assert!(!shim_installed_at(dir.path(), &new));
        install_shim_at(dir.path(), &new).unwrap();
        assert_eq!(std::fs::read_link(dir.path().join("pgit")).unwrap(), new);
        assert!(shim_installed_at(dir.path(), &new));
    }

    #[cfg(unix)]
    #[test]
    fn shim_not_installed_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!shim_installed_at(dir.path(), Path::new("/x")));
    }

    // ─── askpass shim (#61 D5) ───────────────────────────────────────────────

    #[test]
    fn askpass_prompt_kinds_are_recognized() {
        assert_eq!(
            askpass_want("Username for 'https://github.com': "),
            Some(AskpassWant::Username)
        );
        assert_eq!(
            askpass_want("Password for 'https://u@github.com': "),
            Some(AskpassWant::Secret)
        );
        assert_eq!(
            askpass_want("Enter passphrase for key '/home/u/.ssh/id_ed25519': "),
            Some(AskpassWant::Secret)
        );
        assert_eq!(
            askpass_want("Are you sure you want to continue connecting?"),
            None
        );
    }

    #[test]
    fn askpass_answers_from_the_matching_env_value() {
        assert_eq!(
            askpass_answer("Username for 'https://github.com': ", Some("ada"), Some("tok")),
            Some("ada".to_string())
        );
        assert_eq!(
            askpass_answer(
                "Password for 'https://ada@github.com': ",
                Some("ada"),
                Some("tok")
            ),
            Some("tok".to_string())
        );
    }

    #[test]
    fn askpass_refuses_when_the_value_is_absent() {
        // Never fall back to an empty string: git would take it as a real
        // (wrong) credential and burn an authentication attempt.
        assert_eq!(askpass_answer("Password for 'https://x': ", None, None), None);
        assert_eq!(
            askpass_answer("Username for 'https://x': ", None, Some("tok")),
            None
        );
    }

    #[test]
    fn askpass_refuses_an_unrecognized_prompt() {
        assert_eq!(
            askpass_answer("Please confirm the fingerprint", Some("ada"), Some("tok")),
            None
        );
    }

    #[test]
    fn parse_args_recognizes_askpass() {
        let cwd = Path::new("/tmp");
        assert_eq!(
            parse_args(
                &["--askpass".to_string(), "Password for 'x': ".to_string()],
                cwd
            ),
            Parsed::Askpass("Password for 'x': ".to_string())
        );
    }

    #[test]
    fn askpass_without_a_prompt_is_still_askpass_and_answers_nothing() {
        let cwd = Path::new("/tmp");
        assert_eq!(
            parse_args(&["--askpass".to_string()], cwd),
            Parsed::Askpass(String::new())
        );
        assert_eq!(askpass_answer("", Some("a"), Some("b")), None);
    }

    #[test]
    fn a_prompt_containing_a_flag_is_not_read_as_that_flag() {
        // A prompt is arbitrary text from git; it must not be able to make the
        // shim print USAGE (which git would then use as the credential).
        let cwd = Path::new("/tmp");
        assert_eq!(
            parse_args(
                &["--askpass".to_string(), "Password -h for 'x': ".to_string()],
                cwd
            ),
            Parsed::Askpass("Password -h for 'x': ".to_string())
        );
    }
    // ─── the ownership contract (#144) ───────────────────────────────────────
    //
    // Every table below is exercised for all three OSes from whatever host runs
    // the suite: two of the three cannot be exercised any other way.

    fn dirs(v: &[&str]) -> Vec<PathBuf> {
        v.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn macos_prefers_usr_local_bin_then_falls_back_under_home() {
        assert_eq!(
            shim_dirs_for(ShimOs::Macos, Some(Path::new("/Users/ada")), None),
            dirs(&["/usr/local/bin", "/Users/ada/.local/bin", "/Users/ada/bin"])
        );
    }

    #[test]
    fn macos_still_offers_usr_local_bin_without_a_home() {
        assert_eq!(
            shim_dirs_for(ShimOs::Macos, None, None),
            dirs(&["/usr/local/bin"])
        );
    }

    #[test]
    fn linux_stays_under_home_and_never_names_a_root_owned_dir() {
        let out = shim_dirs_for(ShimOs::Linux, Some(Path::new("/home/ada")), None);
        assert_eq!(out, dirs(&["/home/ada/.local/bin", "/home/ada/bin"]));
        assert!(
            !out.iter().any(|d| d.starts_with("/usr")),
            "a sudo-requiring dir must never be an app shim dir on Linux"
        );
    }

    #[test]
    fn windows_uses_a_per_user_dir_and_nothing_without_localappdata() {
        // Compared against the same `join` the table uses: a host running this
        // test joins with `/`, and the point of the assertion is the SHAPE
        // (LOCALAPPDATA/PlatypusGit/bin, and never a Program Files path that
        // would need admin), not the separator.
        let local = Path::new("C:\\Users\\ada\\AppData\\Local");
        assert_eq!(
            shim_dirs_for(ShimOs::Windows, None, Some(local)),
            vec![local.join("PlatypusGit").join("bin")]
        );
        assert!(shim_dirs_for(ShimOs::Windows, Some(Path::new("C:\\Users\\ada")), None).is_empty());
    }

    #[test]
    fn package_paths_cover_the_deb_on_linux_and_the_install_dir_everywhere() {
        let exe_dir = PathBuf::from("/opt/pg");
        let linux = package_shim_paths_for(ShimOs::Linux, Some(&exe_dir));
        assert!(linux.contains(&PathBuf::from("/usr/bin").join(SHIM_NAME)));
        assert!(linux.contains(&exe_dir.join(SHIM_NAME)));
        // macOS has no packaged path of its own — Homebrew's prefix varies by
        // architecture, so it is found through PATH instead.
        assert_eq!(
            package_shim_paths_for(ShimOs::Macos, Some(&exe_dir)),
            vec![exe_dir.join(SHIM_NAME)]
        );
        assert!(package_shim_paths_for(ShimOs::Macos, None).is_empty());
    }

    #[test]
    fn path_dirs_drops_empty_entries() {
        let joined = std::env::join_paths([Path::new("/a"), Path::new("/b")]).unwrap();
        assert_eq!(path_dirs(Some(&joined)), dirs(&["/a", "/b"]));
        assert!(path_dirs(None).is_empty());
        // An empty entry means "cwd", which is never where a shim lives.
        let sep = if cfg!(windows) { ";;" } else { "::" };
        let raw = std::ffi::OsString::from(format!("/a{sep}/b"));
        assert_eq!(path_dirs(Some(&raw)), dirs(&["/a", "/b"]));
    }

    #[test]
    fn scan_order_is_ours_then_package_then_path_and_deduplicates() {
        let app = dirs(&["/home/ada/.local/bin", "/home/ada/bin"]);
        let pkg = dirs(&["/usr/bin/pgit"]);
        let path = dirs(&["/usr/bin", "/home/ada/.local/bin"]);
        let order = shim_scan_order(&app, &pkg, &path);
        assert_eq!(
            order,
            vec![
                PathBuf::from("/home/ada/.local/bin").join(SHIM_NAME),
                PathBuf::from("/home/ada/bin").join(SHIM_NAME),
                PathBuf::from("/usr/bin/pgit"),
                PathBuf::from("/usr/bin").join(SHIM_NAME),
            ]
            .into_iter()
            // On Windows `/usr/bin/pgit` and `/usr/bin/pgit.cmd` differ, on unix
            // they collapse — assert the shape, not the platform's arithmetic.
            .fold(Vec::new(), |mut acc: Vec<PathBuf>, p| {
                if !acc.contains(&p) {
                    acc.push(p);
                }
                acc
            })
        );
    }

    #[test]
    fn a_symlink_to_us_in_our_own_dir_is_ours() {
        let app = dirs(&["/home/ada/.local/bin"]);
        let exe = Path::new("/opt/pg/platypusgit");
        assert_eq!(
            classify_sighting(
                Path::new("/home/ada/.local/bin/pgit"),
                &app,
                Some(exe),
                None,
                exe,
                "platypusgit"
            ),
            CliShimSource::App
        );
    }

    #[test]
    fn a_symlink_to_us_from_a_brew_prefix_is_package_managed() {
        // The Homebrew cask's `binary` stanza symlinks the app binary into
        // `$(brew --prefix)/bin`, which is not a dir we ever write.
        let app = dirs(&["/usr/local/bin", "/Users/ada/.local/bin"]);
        let exe = Path::new("/Applications/PlatypusGit.app/Contents/MacOS/platypusgit");
        assert_eq!(
            classify_sighting(
                Path::new("/opt/homebrew/bin/pgit"),
                &app,
                Some(exe),
                None,
                exe,
                "platypusgit"
            ),
            CliShimSource::Package
        );
    }

    #[test]
    fn the_deb_wrapper_script_is_package_managed() {
        // What `src-tauri/deb/pgit` actually contains. It names the binary
        // absolutely on purpose — this probe is why.
        let wrapper = "#!/bin/sh\nexec /usr/bin/platypusgit \"$@\"\n";
        let app = dirs(&["/home/ada/.local/bin"]);
        assert_eq!(
            classify_sighting(
                Path::new("/usr/bin/pgit"),
                &app,
                None,
                Some(wrapper),
                Path::new("/usr/bin/platypusgit"),
                "platypusgit"
            ),
            CliShimSource::Package
        );
    }

    #[test]
    fn the_msi_cmd_shim_is_package_managed() {
        let body = shim_cmd_body(Path::new("C:\\Program Files\\PlatypusGit\\platypusgit.exe"));
        let app = dirs(&["C:\\Users\\ada\\AppData\\Local\\PlatypusGit\\bin"]);
        assert_eq!(
            classify_sighting(
                Path::new("C:\\Program Files\\PlatypusGit\\pgit.cmd"),
                &app,
                None,
                Some(&body),
                Path::new("C:\\Program Files\\PlatypusGit\\platypusgit.exe"),
                "platypusgit"
            ),
            CliShimSource::Package
        );
    }

    #[test]
    fn a_stranger_is_foreign_and_is_never_claimed() {
        let app = dirs(&["/home/ada/.local/bin"]);
        let exe = Path::new("/opt/pg/platypusgit");
        // Someone else's script...
        assert_eq!(
            classify_sighting(
                Path::new("/usr/local/bin/pgit"),
                &app,
                None,
                Some("#!/bin/sh\nexec /usr/bin/gitk \"$@\"\n"),
                exe,
                "platypusgit"
            ),
            CliShimSource::Foreign
        );
        // ...and someone else's symlink, even inside a dir we write.
        assert_eq!(
            classify_sighting(
                Path::new("/home/ada/.local/bin/pgit"),
                &app,
                Some(Path::new("/usr/bin/gitk")),
                None,
                exe,
                "platypusgit"
            ),
            CliShimSource::Foreign
        );
    }

    #[test]
    fn a_binary_or_oversized_shim_reads_as_foreign_not_a_panic() {
        // `text: None` is what `probe_shim` yields for non-UTF-8 or >4 KiB.
        assert_eq!(
            classify_sighting(
                Path::new("/usr/local/bin/pgit"),
                &dirs(&["/home/ada/.local/bin"]),
                None,
                None,
                Path::new("/opt/pg/platypusgit"),
                "platypusgit"
            ),
            CliShimSource::Foreign
        );
    }

    #[test]
    fn a_relative_symlink_still_resolves_to_us() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let exe = dir.join("platypusgit");
        std::fs::write(&exe, b"x").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("platypusgit", dir.join(SHIM_NAME)).unwrap();
            let sighting = probe_shim(&dir.join(SHIM_NAME)).unwrap();
            assert_eq!(sighting.link.as_deref(), Some(exe.as_path()));
            assert!(references_app(
                sighting.link.as_deref(),
                None,
                &exe,
                "platypusgit"
            ));
        }
    }

    #[test]
    fn dir_on_path_is_exact_not_a_prefix() {
        let path = dirs(&["/usr/local/binaries", "/opt/bin"]);
        assert_eq!(
            dir_on_path(Path::new("/usr/local/bin"), &path),
            CliPathState::OffPath
        );
        assert_eq!(dir_on_path(Path::new("/opt/bin"), &path), CliPathState::OnPath);
    }

    #[test]
    fn the_cmd_shim_quotes_the_exe_and_forwards_every_argument() {
        let body = shim_cmd_body(Path::new("C:\\Program Files\\PlatypusGit\\platypusgit.exe"));
        assert!(body.starts_with("@echo off\r\n"));
        assert!(body.contains("\"C:\\Program Files\\PlatypusGit\\platypusgit.exe\" %*"));
    }

    #[test]
    fn the_windows_path_script_is_embedded_and_reads_its_dir_from_the_environment() {
        // `include_str!` silently succeeding on the wrong file would leave the
        // Windows PATH half dead; and the directory must never reach argv.
        assert!(WINDOWS_PATH_SCRIPT.contains("PGIT_BIN_DIR"));
        assert!(WINDOWS_PATH_SCRIPT.contains("Add-UserPathEntry"));
        // The registry kind is preserved and the value read unexpanded, or a
        // REG_EXPAND_SZ PATH containing %USERPROFILE% is destroyed on write.
        assert!(WINDOWS_PATH_SCRIPT.contains("DoNotExpandEnvironmentNames"));
        assert!(WINDOWS_PATH_SCRIPT.contains("GetValueKind"));
        // `setx` truncates at 1024 chars and merges the machine PATH into the
        // user PATH — it may be named in the rationale, never invoked.
        assert!(!WINDOWS_PATH_SCRIPT
            .lines()
            .any(|line| line.trim_start().starts_with("setx")));
    }

    #[test]
    fn a_package_managed_pgit_is_never_overwritten() {
        // The whole point of #144's last note: a shim shipped by Homebrew, dpkg
        // or the MSI is reported as installed, not offered for replacement.
        assert_eq!(
            plan_install(CliShimSource::Package, false),
            InstallPlan::KeepExisting
        );
        assert_eq!(
            plan_install(CliShimSource::Package, true),
            InstallPlan::KeepExisting
        );
    }

    #[test]
    fn our_own_correct_shim_is_left_byte_identical() {
        assert_eq!(plan_install(CliShimSource::App, true), InstallPlan::KeepExisting);
    }

    #[test]
    fn a_stale_absent_or_foreign_shim_is_written() {
        // A stale link of ours, nothing at all, and a stranger all mean "write
        // ours" — the stranger's file is in a directory we do not write, so
        // ours goes somewhere else rather than over it.
        assert_eq!(plan_install(CliShimSource::App, false), InstallPlan::Write);
        assert_eq!(plan_install(CliShimSource::None, false), InstallPlan::Write);
        assert_eq!(plan_install(CliShimSource::Foreign, false), InstallPlan::Write);
    }

    #[test]
    fn the_main_binary_name_matches_the_installed_binary() {
        // Every channel installs the Cargo bin name: /usr/bin/platypusgit,
        // <INSTALLDIR>\platypusgit.exe, PlatypusGit.app/Contents/MacOS/platypusgit.
        assert_eq!(MAIN_BINARY, "platypusgit");
    }
}
