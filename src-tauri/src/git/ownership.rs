//! Everything about libgit2's "dubious ownership" refusal.
//!
//! libgit2 1.9.2 validates that a repository's working directory (and its
//! gitdir, and any gitlink) is owned by the current user before opening it —
//! git's CVE-2022-24765 check. On a WSL `/mnt/c` drvfs mount the reported
//! owner routinely disagrees with the WSL uid even for the user's own
//! repository, so here the refusal is an ordinary condition, not an attack.
//!
//! Three details of the vendored implementation shape everything below, and
//! were read out of `repository.c` rather than assumed:
//!
//! - the config key is `validation_paths[0]` — the **working directory** when
//!   there is one, the gitdir for a bare repo
//! - `validate_ownership_config` reads the **global** config only; the
//!   repository's own config is never consulted (it cannot be — the
//!   repository is not open yet)
//! - `validate_ownership_cb` accepts the literal `*`, or a value that equals
//!   the workdir once normalised to a trailing slash. The `dir/*` suffix glob
//!   newer git supports is **not** implemented, so exceptions are per-repo.

use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The path as libgit2 would spell it: symlinks resolved, no trailing slash,
/// no `.` or `..`. `safe.directory` matching is exact, so the string handed to
/// the user to trust has to be the resolved one. Falls back to the input when
/// the path cannot be canonicalised — it may not exist.
pub fn canonical_string(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

/// Classify a failure from `Repository::open`.
///
/// `ErrorCode::Owner` is the one that must not fall through to the generic
/// arm: it is remediable, and only a distinct variant lets the frontend offer
/// the remedy instead of printing libgit2's sentence at the user.
pub fn map_open_error(path: &Path, e: &git2::Error) -> AppError {
    match e.code() {
        git2::ErrorCode::Owner => AppError::DubiousOwnership(canonical_string(path)),
        git2::ErrorCode::NotFound => AppError::NotARepo(path.display().to_string()),
        _ => AppError::Git(e.message().to_string()),
    }
}

/// Map only the ownership refusal, leaving every other failure to the usual
/// conversion.
///
/// `map_open_error`'s `NotFound` → `NotARepo` arm is right for opening an
/// existing repository and wrong for anything else: an `init` that fails with
/// `NotFound` has not discovered that the path "is not a git repository" —
/// that was the whole point of the call.
pub fn map_ownership_error(path: &Path, e: git2::Error) -> AppError {
    if e.code() == git2::ErrorCode::Owner {
        return AppError::DubiousOwnership(canonical_string(path));
    }
    AppError::from(e)
}

/// What is actually at a path, for the call sites that only need to know
/// whether a repository is there.
///
/// The distinction matters: `Repository::open(p).is_ok()` answers "no" both
/// when there is no repository *and* when there is one we are not allowed to
/// open. Collapsing those is what makes an ownership refusal quietly disable
/// the embedded-repo and clone-target guards.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepoPresence {
    /// A repository is there and openable.
    Present,
    /// Nothing repository-shaped is there.
    Absent,
    /// A repository is there, but libgit2 refused it on ownership grounds.
    Refused,
}

impl RepoPresence {
    /// True when a repository exists at the path, openable or not. Guards that
    /// refuse to act on top of an existing repository want this, not
    /// `Present` — a refused repository is still a repository.
    pub fn exists(self) -> bool {
        matches!(self, RepoPresence::Present | RepoPresence::Refused)
    }
}

/// Probe `path` for a repository, without walking up to its ancestors.
pub fn repo_presence(path: &Path) -> RepoPresence {
    match git2::Repository::open(path) {
        Ok(_) => RepoPresence::Present,
        Err(e) if e.code() == git2::ErrorCode::Owner => RepoPresence::Refused,
        Err(_) => RepoPresence::Absent,
    }
}

/// The repository root at or above `path`, found without opening anything.
///
/// `Repository::discover` would be the obvious tool, but it opens what it
/// finds and so fails on exactly the repositories this module exists for.
/// Looking for `.git` — a directory for a normal repo, a file for a worktree
/// or submodule — needs no open at all.
pub fn repo_root_for(path: &Path) -> Option<PathBuf> {
    let start = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    start
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .map(PathBuf::from)
}

/// How one `safe.directory` value moves the running verdict, mirroring
/// libgit2's `validate_ownership_cb`.
///
/// The verdict is a fold over the entries in file order, not a search: an
/// empty value *clears* everything accumulated before it (same as git), so
/// `directory = /x` followed by `directory =` leaves `/x` untrusted. Treating
/// this as "find any matching entry" would report a path as already trusted
/// when it is not, and then decline to write the exception the user just
/// asked for.
fn apply_value(trusted: bool, value: &str, path: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    if value == "*" {
        return true;
    }
    fn strip(s: &str) -> &str {
        s.trim_end_matches('/')
    }
    if strip(value) == strip(path) {
        return true;
    }
    trusted
}

/// A value pattern no real `safe.directory` entry can equal, so
/// `set_multivar` finds nothing to replace and appends instead — git's
/// `--add`. The obvious `^$` is wrong here: it matches an empty value, and an
/// empty value is a meaningful "reset" entry that must not be overwritten.
const NEVER_MATCHES: &str = "^platypusgit-never-matches-a-config-value$";

/// Add `path` to `cfg`'s `safe.directory` multivar, exactly as
/// `git config --global --add safe.directory <path>` would.
///
/// Returns `false` when an entry already covers the path — re-trusting is a
/// no-op rather than a growing pile of duplicates, since the user can reach
/// this from any entry point and the same repository is opened many times.
pub fn add_safe_directory(cfg: &mut git2::Config, path: &str) -> AppResult<bool> {
    // Scoped: `entries` borrows `cfg` immutably for as long as it lives, and
    // the write below needs it mutably.
    let already_trusted = {
        let mut entries = cfg.entries(Some("safe.directory"))?;
        let mut trusted = false;
        while let Some(entry) = entries.next() {
            let entry = entry?;
            trusted = apply_value(trusted, entry.value().unwrap_or_default(), path);
        }
        trusted
    };
    if already_trusted {
        return Ok(false);
    }
    cfg.set_multivar("safe.directory", NEVER_MATCHES, path)?;
    Ok(true)
}

/// Where libgit2 would read the global config, whether or not the file is
/// there yet.
///
/// Deliberately not `$HOME/.gitconfig`: libgit2's global search path is
/// configurable, and writing anywhere it does not read would leave the
/// exception invisible to the very check we are trying to satisfy — a silent
/// no-op that looks like success.
fn global_config_path() -> AppResult<PathBuf> {
    if let Ok(path) = git2::Config::find_global() {
        return Ok(path);
    }
    // No file yet, so `find_global` has nothing to report. Ask libgit2 where
    // it looks instead. The list is separator-joined, highest priority first.
    //
    // SAFETY: reads a libgit2 global option. Unsound only against a
    // concurrent `set_search_path`, which nothing in this app calls.
    let raw = unsafe { git2::opts::get_search_path(git2::ConfigLevel::Global) }
        .map_err(|e| AppError::Git(e.message().to_string()))?;
    let raw = raw.to_string_lossy().to_string();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let dir = raw
        .split(separator)
        .find(|s| !s.is_empty())
        .ok_or_else(|| AppError::Internal("git has no global config location".into()))?;
    Ok(PathBuf::from(dir).join(".gitconfig"))
}

/// The global config file, creating it when the user has none yet.
///
/// Writes must land at the *global* level specifically: libgit2 reads
/// `safe.directory` from global config only.
fn global_config() -> AppResult<git2::Config> {
    if let Ok(cfg) =
        git2::Config::open_default().and_then(|c| c.open_level(git2::ConfigLevel::Global))
    {
        return Ok(cfg);
    }
    let path = global_config_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, "")?;
    }
    Ok(git2::Config::open(&path)?)
}

/// Trust `path` for this user, so libgit2 will open it despite the ownership
/// mismatch. The user-facing half of the CVE-2022-24765 escape hatch — only
/// ever call it behind an explicit confirmation.
pub fn trust_path(path: &Path) -> AppResult<()> {
    let canonical = canonical_string(path);
    let mut cfg = global_config()?;
    add_safe_directory(&mut cfg, &canonical)?;
    Ok(())
}
