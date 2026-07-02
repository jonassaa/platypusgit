mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::DiffKind;
use platypusgit_lib::git::GitBackend;

use support::TempRepo;

/// An untracked directory that is itself a git repo (e.g. a dependency
/// vendored with its own `.git`, never registered as a submodule) shows up
/// in status as a single entry with a trailing slash, since libgit2 won't
/// recurse across the nested repo boundary. Diffing or staging it as if it
/// were a regular file must fail with a clear, dedicated error rather than
/// silently no-op-ing (diff) or bubbling up a cryptic libgit2 message (stage).
fn make_nested_repo(tr: &TempRepo) -> String {
    let nested_dir = tr.path().join("vendor/lib");
    std::fs::create_dir_all(&nested_dir).unwrap();
    git2::Repository::init(&nested_dir).unwrap();
    std::fs::write(nested_dir.join("file.txt"), "content\n").unwrap();
    "vendor/lib/".to_string()
}

#[test]
fn status_reports_nested_repo_with_trailing_slash() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let expected_path = make_nested_repo(&tr);

    let statuses = backend.status(&handle.id).unwrap();
    assert!(statuses.iter().any(|s| s.path == expected_path));
}

#[test]
fn diff_on_embedded_repo_returns_dedicated_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let path = make_nested_repo(&tr);

    let err = backend
        .diff(&handle.id, &PathBuf::from(&path), DiffKind::WorktreeToIndex)
        .unwrap_err();
    assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
}

#[test]
fn stage_on_embedded_repo_returns_dedicated_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let path = make_nested_repo(&tr);

    let err = backend
        .stage(&handle.id, &[PathBuf::from(&path)])
        .unwrap_err();
    assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
}
