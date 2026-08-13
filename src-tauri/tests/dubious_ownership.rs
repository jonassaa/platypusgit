//! libgit2 refuses to open a repository whose working directory is owned by
//! another user — git's CVE-2022-24765 check, surfacing as `GIT_EOWNER`.
//! Under WSL, every repository on a `/mnt/c` drvfs mount can trip it, because
//! the mount's reported ownership need not match the WSL uid.
//!
//! The refusal itself cannot be provoked here: it needs a directory owned by
//! a different uid, i.e. root. So the mapping is tested against a synthetic
//! `GIT_EOWNER` error — exactly the shape libgit2 returns — and everything
//! downstream of it (the `safe.directory` writer, the presence probe, the
//! non-opening root walk) is tested for real.

mod support;

use std::path::Path;
use std::sync::Mutex;

use git2::{ErrorClass, ErrorCode};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::ownership::{self, RepoPresence};

use support::TempRepo;

/// libgit2's config search path is process-global; serialise the tests that
/// move it so they cannot observe each other's temp home.
static SEARCH_PATH: Mutex<()> = Mutex::new(());

/// Values of every `safe.directory` entry in `file`, in order.
fn safe_dirs(file: &Path) -> Vec<String> {
    let cfg = git2::Config::open(file).unwrap();
    let mut out = Vec::new();
    let mut entries = cfg.entries(Some("safe.directory")).unwrap();
    while let Some(entry) = entries.next() {
        let entry = entry.unwrap();
        out.push(entry.value().unwrap_or_default().to_string());
    }
    out
}

/// An empty config file in a fresh tempdir, plus a handle to it.
fn temp_config(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("gitconfig");
    std::fs::write(&file, contents).unwrap();
    (dir, file)
}

// === error mapping ===

#[test]
fn eowner_maps_to_dubious_ownership() {
    let err = git2::Error::new(
        ErrorCode::Owner,
        ErrorClass::Config,
        "repository path '/mnt/c/dev/reponame' is not owned by current user",
    );
    let mapped = ownership::map_open_error(Path::new("/mnt/c/dev/reponame"), &err);
    match mapped {
        AppError::DubiousOwnership(p) => assert!(p.ends_with("reponame"), "got {p}"),
        other => panic!("expected DubiousOwnership, got {other:?}"),
    }
}

#[test]
fn missing_repo_still_maps_to_not_a_repo() {
    let err = git2::Error::new(ErrorCode::NotFound, ErrorClass::Repository, "not found");
    assert!(matches!(
        ownership::map_open_error(Path::new("/tmp/nope"), &err),
        AppError::NotARepo(_)
    ));
}

#[test]
fn ownership_only_mapping_leaves_not_found_generic() {
    // `init` uses this instead of `map_open_error`: a NotFound out of init has
    // not established that the path "is not a git repository".
    let err = git2::Error::new(ErrorCode::NotFound, ErrorClass::Repository, "not found");
    assert!(matches!(
        ownership::map_ownership_error(Path::new("/tmp/nope"), err),
        AppError::Git(_)
    ));
}

#[test]
fn ownership_only_mapping_still_catches_eowner() {
    let err = git2::Error::new(ErrorCode::Owner, ErrorClass::Config, "not owned");
    assert!(matches!(
        ownership::map_ownership_error(Path::new("/mnt/c/dev/reponame"), err),
        AppError::DubiousOwnership(_)
    ));
}

#[test]
fn other_failures_stay_generic() {
    let err = git2::Error::new(ErrorCode::Invalid, ErrorClass::Repository, "broken");
    assert!(matches!(
        ownership::map_open_error(Path::new("/tmp/x"), &err),
        AppError::Git(_)
    ));
}

// === the safe.directory writer ===

#[test]
fn add_safe_directory_writes_the_exact_path() {
    let (_dir, file) = temp_config("");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());

    assert_eq!(safe_dirs(&file), vec!["/mnt/c/dev/reponame".to_string()]);
}

#[test]
fn add_safe_directory_is_idempotent() {
    let (_dir, file) = temp_config("");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
    // Second call reports "already trusted" and writes nothing — the user can
    // reach this from any entry point, many times, for the same repo.
    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());

    assert_eq!(safe_dirs(&file).len(), 1);
}

#[test]
fn add_safe_directory_keeps_existing_entries() {
    let (_dir, file) = temp_config("[safe]\n\tdirectory = /home/me/other\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap();

    assert_eq!(
        safe_dirs(&file),
        vec![
            "/home/me/other".to_string(),
            "/mnt/c/dev/reponame".to_string()
        ]
    );
}

#[test]
fn add_safe_directory_accepts_a_trailing_slash_match() {
    // libgit2 normalises config values to a trailing slash before comparing,
    // so `/x/y/` already trusts `/x/y` — adding a duplicate would be noise.
    let (_dir, file) = temp_config("[safe]\n\tdirectory = /mnt/c/dev/reponame/\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
    assert_eq!(safe_dirs(&file).len(), 1);
}

#[test]
fn add_safe_directory_respects_a_wildcard() {
    let (_dir, file) = temp_config("[safe]\n\tdirectory = *\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
}

#[test]
fn add_safe_directory_ignores_a_reset_entry() {
    // An empty value resets the accumulated list (same as git) — it trusts
    // nothing, so it must not be mistaken for a match.
    let (_dir, file) = temp_config("[safe]\n\tdirectory =\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
}

#[test]
fn a_later_reset_entry_cancels_an_earlier_match() {
    // libgit2 folds the entries in order: `directory = /x` then `directory =`
    // leaves /x UNtrusted. Searching for any matching entry instead would
    // report "already trusted" and silently decline to write the exception
    // the user just asked for — a dead end with no error.
    let (_dir, file) = temp_config("[safe]\n\tdirectory = /mnt/c/dev/reponame\n\tdirectory =\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
}

#[test]
fn add_safe_directory_appends_past_a_reset_entry() {
    // The append must not consume the empty entry. `set_multivar` replaces
    // values its pattern matches, so a pattern of `^$` would overwrite the
    // reset and silently re-trust everything listed before it.
    let (_dir, file) = temp_config("[safe]\n\tdirectory = /home/me/other\n\tdirectory =\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap();

    assert_eq!(
        safe_dirs(&file),
        vec![
            "/home/me/other".to_string(),
            String::new(),
            "/mnt/c/dev/reponame".to_string()
        ]
    );
}

#[test]
fn a_wildcard_after_a_reset_still_trusts() {
    let (_dir, file) = temp_config("[safe]\n\tdirectory =\n\tdirectory = *\n");
    let mut cfg = git2::Config::open(&file).unwrap();

    assert!(!ownership::add_safe_directory(&mut cfg, "/mnt/c/dev/reponame").unwrap());
}

#[test]
fn trust_path_writes_to_the_global_config() {
    let _lock = SEARCH_PATH.lock().unwrap();
    let home = tempfile::tempdir().unwrap();
    // Redirect libgit2's *global* config search at a temp home, so the test
    // can never touch the developer's real ~/.gitconfig.
    unsafe {
        git2::opts::set_search_path(git2::ConfigLevel::Global, home.path()).unwrap();
    }

    let repo = tempfile::tempdir().unwrap();
    let result = ownership::trust_path(repo.path());

    let written = safe_dirs(&home.path().join(".gitconfig"));
    unsafe {
        git2::opts::reset_search_path(git2::ConfigLevel::Global).unwrap();
    }

    result.unwrap();
    assert_eq!(written, vec![ownership::canonical_string(repo.path())]);
}

#[test]
fn trust_path_creates_a_global_config_when_there_is_none() {
    let _lock = SEARCH_PATH.lock().unwrap();
    let home = tempfile::tempdir().unwrap();
    unsafe {
        git2::opts::set_search_path(git2::ConfigLevel::Global, home.path()).unwrap();
    }

    let repo = tempfile::tempdir().unwrap();
    let result = ownership::trust_path(repo.path());

    let config_path = home.path().join(".gitconfig");
    let exists = config_path.exists();
    let written = exists.then(|| safe_dirs(&config_path)).unwrap_or_default();
    unsafe {
        git2::opts::reset_search_path(git2::ConfigLevel::Global).unwrap();
    }

    result.unwrap();
    assert!(exists, "expected a global config to be created");
    assert_eq!(written, vec![ownership::canonical_string(repo.path())]);
}

// === presence probe and root walk ===

#[test]
fn repo_presence_finds_a_real_repo() {
    let tr = TempRepo::with_initial_commit("hi\n");
    assert_eq!(ownership::repo_presence(tr.path()), RepoPresence::Present);
}

#[test]
fn repo_presence_reports_a_plain_directory_absent() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(ownership::repo_presence(dir.path()), RepoPresence::Absent);
}

#[test]
fn presence_exists_covers_present_and_refused() {
    // The whole point of the enum: guards ask `exists()`, not `== Present`.
    assert!(RepoPresence::Present.exists());
    assert!(RepoPresence::Refused.exists());
    assert!(!RepoPresence::Absent.exists());
}

#[test]
fn repo_root_for_walks_up_from_a_subdirectory() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let nested = tr.path().join("a/b/c");
    std::fs::create_dir_all(&nested).unwrap();

    let found = ownership::repo_root_for(&nested).expect("root");
    assert_eq!(
        ownership::canonical_string(&found),
        ownership::canonical_string(tr.path())
    );
}

#[test]
fn repo_root_for_finds_the_root_itself() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let found = ownership::repo_root_for(tr.path()).expect("root");
    assert_eq!(
        ownership::canonical_string(&found),
        ownership::canonical_string(tr.path())
    );
}

#[test]
fn repo_root_for_returns_none_outside_a_repo() {
    let dir = tempfile::tempdir().unwrap();
    assert!(ownership::repo_root_for(dir.path()).is_none());
}
