mod support;

use platypusgit_lib::git::{
    types::{ReflogOp, ResetMode},
    GitBackend,
};
use support::TempRepo;

#[test]
fn read_reflog_returns_newest_first_after_commits() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("two.txt", "two\n", "second");
    tr.add_commit("three.txt", "three\n", "third");
    let (backend, handle) = tr.open_with_backend();

    let entries = backend.read_reflog(&handle.id).unwrap();

    assert!(entries.len() >= 3, "expected at least 3 entries, got {}", entries.len());
    // Newest first — the top entry is the most recent commit.
    assert_eq!(entries[0].op, ReflogOp::Commit);
    assert!(entries[0].message.contains("third"));
    // Timestamps are non-decreasing as we go back in time (older entries later in Vec).
    for pair in entries.windows(2) {
        assert!(pair[0].timestamp >= pair[1].timestamp);
    }
}

#[test]
fn read_reflog_classifies_reset_op() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("two.txt", "two\n", "second");
    let (backend, handle) = tr.open_with_backend();

    // Reset to HEAD~1 — produces a "reset:" reflog entry.
    let head_parent = {
        let commits = backend.log(&handle.id, 10).unwrap();
        commits[1].oid.clone()
    };
    backend
        .reset(&handle.id, &head_parent, ResetMode::Hard)
        .unwrap();

    let entries = backend.read_reflog(&handle.id).unwrap();
    assert_eq!(entries[0].op, ReflogOp::Reset);
}

#[test]
fn read_reflog_returns_empty_for_fresh_repo() {
    let tr = TempRepo::fresh();
    let backend = platypusgit_lib::git::libgit2::Libgit2Backend::new();
    let handle = backend.open(tr.path()).unwrap();

    let entries = backend.read_reflog(&handle.id).unwrap();
    assert!(entries.is_empty(), "fresh repo should have no reflog entries");
}

#[test]
fn read_reflog_short_oid_is_seven_chars() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let entries = backend.read_reflog(&handle.id).unwrap();
    assert_eq!(entries[0].short_oid.len(), 7);
    assert!(entries[0].oid.starts_with(&entries[0].short_oid));
}
