mod support;

use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// A truly-unborn repo (fresh `git init`, no commits) reports an EMPTY log,
/// not an error — HEAD points at a branch that doesn't exist yet.
#[test]
fn unborn_head_yields_empty_log() {
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert!(out.is_empty(), "unborn repo should have an empty log");
}

/// A missing/corrupt HEAD must NOT be masked as an empty log — it's a broken
/// repo and the History screen should surface the error. Regression guard for
/// push_log_start swallowing NotFound alongside UnbornBranch.
#[test]
fn corrupt_head_errors_instead_of_empty_log() {
    let tr = TempRepo::with_initial_commit("hello\n");
    // Open (and cache) the repo BEFORE corrupting — open validates HEAD.
    let (backend, handle) = tr.open_with_backend();

    // Remove HEAD so `repo.head()` resolves to NotFound rather than the
    // UnbornBranch code a fresh repo would give.
    let head_path = tr.path().join(".git").join("HEAD");
    std::fs::remove_file(&head_path).expect("remove .git/HEAD");

    let err = backend.log(&handle.id, None, 100);
    assert!(
        err.is_err(),
        "log of a repo with a missing HEAD must error, got {err:?}"
    );
}
