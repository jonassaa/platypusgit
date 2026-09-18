//! The libgit2 fallback still produces correct pages (#483).
//!
//! `build_walk_order` prefers `git rev-list`, and falls back to the libgit2
//! revwalk when git is missing, fails, or prints something unreadable. That
//! path is the one a user with no git installed gets on every single page, and
//! a fallback nobody exercises is a fallback that has rotted — silently, since
//! its only visible symptom is being slow.
//!
//! **This is its own test binary on purpose.** It sets a process-wide
//! environment variable, and Rust runs the tests inside one binary on parallel
//! threads, so a second test here could observe a half-applied world. One test,
//! one process, one variable set before anything opens a repository.

mod support;

use platypusgit_lib::git::GitBackend;
use support::TempRepo;

#[test]
fn pages_are_identical_with_the_git_walk_disabled() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 30);

    // The git-backed order first.
    let (backend, handle) = tr.open_with_backend();
    let with_git = backend.log_page(&handle.id, None, None, 10).expect("page");
    let next = backend
        .log_page(&handle.id, None, with_git.next_cursor.as_deref(), 10)
        .expect("second page");

    // …then the same two pages through the fallback.
    std::env::set_var("PGIT_DISABLE_REV_LIST", "1");
    let (fallback, fallback_handle) = tr.open_with_backend();
    let without_git = fallback
        .log_page(&fallback_handle.id, None, None, 10)
        .expect("page");
    let without_git_next = fallback
        .log_page(
            &fallback_handle.id,
            None,
            without_git.next_cursor.as_deref(),
            10,
        )
        .expect("second page");
    std::env::remove_var("PGIT_DISABLE_REV_LIST");

    let ids = |p: &platypusgit_lib::git::types::LogPage| -> Vec<String> {
        p.commits.iter().map(|c| c.oid.clone()).collect()
    };

    assert_eq!(ids(&with_git), ids(&without_git), "first page must match");
    assert_eq!(
        ids(&next),
        ids(&without_git_next),
        "the continuation must match too — the cursor is the half that breaks",
    );
    assert_eq!(with_git.next_cursor, without_git.next_cursor);
}
