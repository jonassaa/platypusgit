//! Two repositories open at once, and closing one (#90 — multi-repo tabs).
//!
//! The backend was always keyed by `RepoId`, but nothing asserted that two
//! handles from one backend stay independent — the single property the tab model
//! rests on. And `open` mints a fresh UUID with no eviction path, so `close` is
//! what keeps a session that opens twenty repositories from holding twenty
//! `git2::Repository` values (and their file handles) until the process exits.

mod support;

use platypusgit_lib::{
    error::AppError,
    git::{libgit2::Libgit2Backend, types::RepoId, GitBackend},
};
use support::{fs::write_file, TempRepo};

#[test]
fn two_repos_stay_independent() {
    let backend = Libgit2Backend::new();

    let a = TempRepo::with_initial_commit("alpha\n");
    let b = TempRepo::with_initial_commit("beta\n");
    // Dirty only B, so a status leak between the two would be visible.
    write_file(b.path(), "only-in-b.txt", "x\n");

    let ha = backend.open(a.path()).expect("open a");
    let hb = backend.open(b.path()).expect("open b");
    assert_ne!(ha.id, hb.id, "each open must mint its own RepoId");

    let sa = backend.status(&ha.id).expect("status a");
    let sb = backend.status(&hb.id).expect("status b");
    assert!(
        sa.is_empty(),
        "repo A should be clean, got {:?}",
        sa.iter().map(|s| &s.path).collect::<Vec<_>>()
    );
    assert!(
        sb.iter().any(|s| s.path == "only-in-b.txt"),
        "repo B should report its own untracked file, got {:?}",
        sb.iter().map(|s| &s.path).collect::<Vec<_>>()
    );

    // Reading one after the other must not disturb either handle.
    assert_eq!(
        backend.log(&ha.id, None, 10).expect("log a").len(),
        1,
        "repo A log",
    );
    assert_eq!(
        backend.log(&hb.id, None, 10).expect("log b").len(),
        1,
        "repo B log",
    );
}

#[test]
fn close_forgets_the_repo_and_leaves_the_other_usable() {
    let backend = Libgit2Backend::new();

    let a = TempRepo::with_initial_commit("alpha\n");
    let b = TempRepo::with_initial_commit("beta\n");
    let ha = backend.open(a.path()).expect("open a");
    let hb = backend.open(b.path()).expect("open b");

    backend.close(&ha.id).expect("close a");

    match backend.status(&ha.id) {
        Err(AppError::UnknownRepo(id)) => assert_eq!(id, ha.id.0),
        other => panic!("expected UnknownRepo after close, got {other:?}"),
    }
    // Closing one tab must not touch the other.
    backend.status(&hb.id).expect("repo B still open after A closed");
}

#[test]
fn close_is_idempotent_and_unknown_ids_succeed() {
    let backend = Libgit2Backend::new();
    let a = TempRepo::with_initial_commit("alpha\n");
    let ha = backend.open(a.path()).expect("open a");

    backend.close(&ha.id).expect("first close");
    // A tab closed twice, and a tab whose open never completed: both must be
    // silent successes, or the UI would raise a banner for nothing.
    backend.close(&ha.id).expect("second close");
    backend
        .close(&RepoId("never-opened".into()))
        .expect("closing an unknown id");
}

#[test]
fn reopening_a_closed_path_works() {
    let backend = Libgit2Backend::new();
    let a = TempRepo::with_initial_commit("alpha\n");

    let first = backend.open(a.path()).expect("open");
    backend.close(&first.id).expect("close");
    let second = backend.open(a.path()).expect("reopen");

    assert_ne!(first.id, second.id, "a reopen mints a new RepoId");
    backend.status(&second.id).expect("status on the reopened repo");
}
