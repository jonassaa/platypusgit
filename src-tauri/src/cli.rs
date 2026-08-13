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
  commit | status    open the Commit panel
  log | history      open the History screen
  branches           open the Branches screen

With a path and no subcommand, opens the repo containing that path.
With a subcommand and no path, uses the current directory.
With no arguments, performs a plain app launch.
";

fn screen_for(token: &str) -> Option<&'static str> {
    match token {
        "commit" | "status" => Some("commit"),
        "log" | "history" => Some("history"),
        "branches" => Some("branches"),
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
            .and_then(|r| r.workdir().map(PathBuf::from))
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliShimStatus {
    pub installed: bool,
    pub shim_path: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallOutcome {
    pub installed: bool,
    pub path: String,
    /// Set when we couldn't write the symlink (permissions): the command the
    /// user should run themselves. Not an error — Settings renders it.
    pub manual_command: Option<String>,
}

/// Where the `pgit` shim goes. None on unsupported platforms (Windows).
pub fn default_shim_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from("/usr/local/bin"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/bin"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

#[cfg(unix)]
pub fn install_shim_at(dir: &Path, exe: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let link = dir.join("pgit");
    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(&link)?;
    }
    std::os::unix::fs::symlink(exe, &link)?;
    Ok(link)
}

#[cfg(unix)]
pub fn shim_installed_at(dir: &Path, exe: &Path) -> bool {
    std::fs::read_link(dir.join("pgit"))
        .map(|target| target == exe)
        .unwrap_or(false)
}

pub fn shim_status() -> CliShimStatus {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = default_shim_dir();
    let shim_path = dir
        .as_deref()
        .map(|d| d.join("pgit").display().to_string())
        .unwrap_or_default();
    #[cfg(unix)]
    let installed = dir.as_deref().is_some_and(|d| shim_installed_at(d, &exe));
    #[cfg(not(unix))]
    let installed = false;
    CliShimStatus {
        installed,
        shim_path,
        target: exe.display().to_string(),
    }
}

pub fn install_shim() -> CliInstallOutcome {
    // Without our own path there's nothing to point the shim at — report
    // not-installed rather than linking an empty path and claiming success.
    let Ok(exe) = std::env::current_exe() else {
        return CliInstallOutcome {
            installed: false,
            path: String::new(),
            manual_command: None,
        };
    };
    let Some(dir) = default_shim_dir() else {
        return CliInstallOutcome {
            installed: false,
            path: String::new(),
            manual_command: None,
        };
    };
    let link_display = dir.join("pgit").display().to_string();
    #[cfg(unix)]
    {
        match install_shim_at(&dir, &exe) {
            Ok(link) => CliInstallOutcome {
                installed: true,
                path: link.display().to_string(),
                manual_command: None,
            },
            Err(_) => CliInstallOutcome {
                installed: false,
                path: link_display.clone(),
                manual_command: Some(format!(
                    "sudo ln -sf \"{}\" \"{}\"",
                    exe.display(),
                    link_display
                )),
            },
        }
    }
    #[cfg(not(unix))]
    {
        CliInstallOutcome {
            installed: false,
            path: link_display,
            manual_command: None,
        }
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
}
