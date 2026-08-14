use std::path::PathBuf;

use platypusgit_lib::git::{libgit2::Libgit2Backend, GitBackend};

fn repo_root() -> PathBuf {
    // This crate lives at <repo_root>/src-tauri, so one level up is the repo itself.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p
}

#[test]
fn opens_this_repo_and_lists_status() {
    let backend = Libgit2Backend::new();
    let root = repo_root();

    let handle = backend
        .open(&root)
        .unwrap_or_else(|e| panic!("open({}) failed: {:?}", root.display(), e));

    // The workdir should be the same path we opened from (canonicalized may
    // differ by trailing slash, so compare the file name component).
    assert_eq!(
        handle.path.file_name(),
        root.file_name(),
        "workdir name should match the opened dir",
    );
    // We committed everything before running this; HEAD should exist.
    assert!(handle.head.is_some(), "expected head branch, got None");

    let status = backend
        .status(&handle.id)
        .expect("status() failed on a freshly opened repo");

    // status may be empty (clean tree) or contain entries — both are valid.
    // We only assert that it returned a Vec without panicking.
    println!("status entries: {}", status.len());
    for entry in status.iter().take(5) {
        println!("  {} worktree={:?} index={:?}", entry.path, entry.worktree, entry.index);
    }
}

#[test]
fn rejects_non_repo_path() {
    let backend = Libgit2Backend::new();
    let result = backend.open(std::path::Path::new("/tmp"));
    match result {
        Err(platypusgit_lib::error::AppError::NotARepo(_)) => {}
        other => panic!("expected NotARepo error, got {:?}", other),
    }
}

#[test]
fn rejects_missing_path() {
    let backend = Libgit2Backend::new();
    let result = backend.open(std::path::Path::new("/definitely/does/not/exist/anywhere"));
    match result {
        Err(platypusgit_lib::error::AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath error, got {:?}", other),
    }
}

/// `Repository::workdir()` returns a path WITH a trailing separator, so the
/// handle used to carry `/repo/` while every caller that asked for the repo
/// said `/repo`. Anything keying on the handle's path then saw two different
/// repositories: repository tabs (#90) dedupe by path, recents store it, and a
/// `pgit <path>` launch forwards the slashless form — so the same repository
/// could open twice under two spellings, and an e2e selector matching on the
/// path's tail could not match at all.
#[test]
fn open_returns_a_workdir_without_a_trailing_separator() {
    let backend = Libgit2Backend::new();
    let root = repo_root();

    let handle = backend.open(&root).expect("open failed");

    let as_string = handle.path.to_string_lossy().into_owned();
    assert!(
        !as_string.ends_with('/') && !as_string.ends_with('\\'),
        "handle path should carry no trailing separator, got {as_string:?}",
    );
    assert_eq!(handle.path, root, "handle path should equal the opened dir");
}

/// The dedupe property that normalization exists for: asking with a trailing
/// separator and without must produce the same key.
#[test]
fn open_with_and_without_a_trailing_separator_agree() {
    let backend = Libgit2Backend::new();
    let root = repo_root();
    let slashed = PathBuf::from(format!("{}/", root.display()));

    let bare = backend.open(&root).expect("open(bare) failed");
    let with_slash = backend.open(&slashed).expect("open(slashed) failed");

    assert_eq!(
        bare.path, with_slash.path,
        "both spellings should resolve to one path",
    );
}
