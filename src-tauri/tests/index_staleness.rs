//! Issue #386 — **the index may have changed since we last read it.**
//!
//! `with_repo` hands out a CACHED `git2::Repository` and libgit2 keeps that
//! repository's index in memory, so `repo.index()` returns whatever snapshot
//! *this process* last saw. Every op below then writes the whole index back, or
//! decides whether to delete a file from it. A snapshot taken before something
//! else staged a file is a snapshot that unstages it again on the next write.
//!
//! The issue was filed as PLAUSIBLE — one call site (`commit`) reloaded, four
//! did not, and whether that was actually observable depended on git2 internals
//! nobody had exercised. **It is observable.** Every test in this file failed
//! before `fresh_index` (`git/libgit2.rs`) and the measured damage was:
//!
//! | op                | before                                      |
//! |-------------------|---------------------------------------------|
//! | `stage`           | `b.txt` back to `??` — staging reverted     |
//! | `unstage`         | `b.txt` back to `??` — staging reverted     |
//! | `unstage` (unborn)| `b.txt` back to `??` — staging reverted     |
//! | `discard`         | `b.txt` **deleted from the worktree**       |
//! | `delete_untracked`| `b.txt` **deleted from the worktree**       |
//!
//! The two deletions are the same root cause wearing its worst face: a path
//! missing from a stale index reads as *untracked*, and untracked is the branch
//! that removes the file rather than restoring it — `delete_untracked` deleting
//! precisely the tracked path it exists to refuse.
//!
//! "Something else" is not hypothetical here. The built-in terminal (#243) sits
//! in the window `cd`-ed to the repository, a `pre-commit` hook that reformats
//! and restages is explicitly supported (`CommitPanel`'s `hookRejection`), and a
//! second window can drive the same repo. So the outside writer in every test is
//! a real `git` invocation against the same worktree — `git_in`, not a second
//! libgit2 handle, because a second handle would not prove anything about the
//! index file that git actually writes.
//!
//! What these tests do NOT claim: that we are safe against a writer racing us
//! *right now*. Nothing short of git's `index.lock` arbitrates that. They pin
//! the window we own — the one that stays open for as long as a tab is.

mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, git_in, TempRepo};

/// `git status --porcelain`, read with the real CLI so the assertion is about
/// the index FILE and not about another cache of it.
fn porcelain(tr: &TempRepo) -> String {
    git_in(tr.path(), &["status", "--porcelain"])
}

/// Staged-by-someone-else, in git's own two-column spelling: index side `A`,
/// worktree side clean.
fn staged_add(status: &str, path: &str) -> bool {
    status.lines().any(|l| l == format!("A  {path}"))
}

#[test]
fn stage_does_not_revert_a_file_staged_outside_this_process() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    write_file(tr.path(), "c.txt", "c\n");
    let (backend, handle) = tr.open_with_backend();

    // Populate the cached index the way the app does — a real staging write.
    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");

    // The terminal in the other pane.
    git_in(tr.path(), &["add", "b.txt"]);

    // Back in the UI: stage a third file. This is a whole-index write.
    backend
        .stage(&handle.id, &[PathBuf::from("c.txt")])
        .expect("stage c.txt");

    let status = porcelain(&tr);
    assert!(
        staged_add(&status, "b.txt"),
        "stage reverted a file staged outside this process:\n{status}"
    );
    assert!(staged_add(&status, "a.txt"), "a.txt lost:\n{status}");
    assert!(staged_add(&status, "c.txt"), "c.txt not staged:\n{status}");
}

#[test]
fn unstage_does_not_revert_a_file_staged_outside_this_process() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");
    git_in(tr.path(), &["add", "b.txt"]);

    backend
        .unstage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("unstage a.txt");

    let status = porcelain(&tr);
    // This is the `reset_default` branch, which reaches for the repository's
    // cached index *internally* — so it also pins that refreshing through a
    // separate `Index` handle reaches the same `git_index`.
    assert!(
        staged_add(&status, "b.txt"),
        "unstage reverted a file staged outside this process:\n{status}"
    );
    assert!(
        status.lines().any(|l| l == "?? a.txt"),
        "a.txt should be unstaged:\n{status}"
    );
}

#[test]
fn unstage_on_an_unborn_head_does_not_revert_an_outside_stage() {
    // No HEAD to reset to, so `unstage` takes its other branch: clear the
    // entries from the index by hand and write it back. Same clobber.
    let tr = TempRepo::fresh();
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");
    git_in(tr.path(), &["add", "b.txt"]);

    backend
        .unstage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("unstage a.txt");

    let status = porcelain(&tr);
    assert!(
        staged_add(&status, "b.txt"),
        "unstage (unborn HEAD) reverted an outside stage:\n{status}"
    );
}

#[test]
fn discard_restores_a_file_staged_outside_this_process_instead_of_deleting_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");
    // b.txt becomes TRACKED outside this process.
    git_in(tr.path(), &["add", "b.txt"]);
    // Now edit it and ask the app to throw the edit away. "Discard" on a
    // tracked path means `git checkout -- b.txt`; it must never mean `rm`.
    write_file(tr.path(), "b.txt", "edited\n");

    backend
        .discard(&handle.id, &[PathBuf::from("b.txt")])
        .expect("discard b.txt");

    assert!(
        tr.path().join("b.txt").exists(),
        "discard DELETED a file that a stale index did not know was tracked"
    );
    assert_eq!(
        std::fs::read_to_string(tr.path().join("b.txt")).unwrap(),
        "b\n",
        "discard should restore the staged content"
    );
}

#[test]
fn discard_of_one_path_does_not_revert_an_outside_stage_of_another() {
    // `checkout_index` writes the index back too, so discarding an unrelated
    // path was enough to unstage someone else's work.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");
    git_in(tr.path(), &["add", "b.txt"]);

    write_file(tr.path(), "README.md", "clobbered\n");
    backend
        .discard(&handle.id, &[PathBuf::from("README.md")])
        .expect("discard README.md");

    let status = porcelain(&tr);
    assert!(
        staged_add(&status, "b.txt"),
        "discarding an unrelated path reverted an outside stage:\n{status}"
    );
}

#[test]
fn delete_untracked_refuses_a_path_staged_outside_this_process() {
    // The refusal this function is built around: a tracked file that slipped
    // into the selection must survive. A stale index cannot refuse what it has
    // never been told about, so this deleted the one path it exists to protect.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.txt", "a\n");
    write_file(tr.path(), "b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("a.txt")])
        .expect("stage a.txt");
    git_in(tr.path(), &["add", "b.txt"]);

    // Its phase 1 validates the whole batch before touching disk, so a tracked
    // path is an outright refusal — not a per-path failure, and not a partial
    // delete. That is only reachable when the check reads the CURRENT index.
    let err = backend
        .delete_untracked(&handle.id, &[PathBuf::from("b.txt")])
        .expect_err("a tracked path must be refused");

    assert!(
        matches!(err, AppError::InvalidPath(ref m) if m.contains("tracked")),
        "wrong refusal for a tracked path: {err:?}"
    );
    assert!(
        tr.path().join("b.txt").exists(),
        "delete_untracked deleted a tracked file"
    );
}
