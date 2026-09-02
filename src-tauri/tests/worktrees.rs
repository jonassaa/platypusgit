//! Linked-worktree integration tests (#93).
//!
//! **Every worktree here lives in its own tempdir.** This project is developed
//! through `.claude/worktrees/`, so a test that pointed `worktree_remove` at a real
//! path would delete a live checkout of the repository. `worktree_target` exists to
//! make that impossible to do by accident.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::WorktreeBranch;
use platypusgit_lib::git::GitBackend;
use support::{git_in, worktree_target, TempRepo};

#[test]
fn a_repo_with_no_linked_worktrees_lists_none() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // The MAIN worktree is the repository itself and is deliberately not listed.
    assert!(backend.worktrees(&handle.id).expect("worktrees").is_empty());
}

#[test]
fn add_on_a_new_branch_creates_the_worktree_and_the_branch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, path) = worktree_target("feature-x");

    let info = backend
        .worktree_add(
            &handle.id,
            &path,
            WorktreeBranch::New("feature/x".to_string()),
        )
        .expect("worktree_add");

    // The git-visible name is the directory basename, as `git worktree add` derives.
    assert_eq!(info.name, "feature-x");
    // The BRANCH is the one that was asked for, not the worktree name — libgit2's
    // reference-less default would have created a branch called "feature-x".
    assert_eq!(info.branch.as_deref(), Some("feature/x"));
    assert!(!info.locked);
    assert!(!info.prunable);
    assert!(!info.is_current);

    // Repo truth.
    let listed = git_in(tr.path(), &["worktree", "list", "--porcelain"]);
    assert!(
        listed.contains("branch refs/heads/feature/x"),
        "git should report the new worktree on feature/x:\n{listed}"
    );
    assert!(path.join("README.md").exists(), "the worktree is checked out");

    let ours = backend.worktrees(&handle.id).expect("worktrees");
    assert_eq!(ours.len(), 1);
    assert_eq!(ours[0].name, "feature-x");
}

#[test]
fn add_on_an_existing_branch_checks_that_branch_out() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .create_branch(&handle.id, "already-there", None)
        .expect("create_branch");
    let (_hold, path) = worktree_target("existing");

    let info = backend
        .worktree_add(
            &handle.id,
            &path,
            WorktreeBranch::Existing("already-there".to_string()),
        )
        .expect("worktree_add on an existing branch");
    assert_eq!(info.branch.as_deref(), Some("already-there"));
}

#[test]
fn add_refuses_an_unknown_branch_and_an_existing_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let (_hold, path) = worktree_target("nope");
    let err = backend
        .worktree_add(
            &handle.id,
            &path,
            WorktreeBranch::Existing("no-such-branch".to_string()),
        )
        .expect_err("an unknown branch must be refused");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");

    // A path that already exists is refused BEFORE anything is created, so a typo
    // cannot scribble into a directory that has something in it.
    let (_hold2, taken) = worktree_target("taken");
    std::fs::create_dir_all(&taken).expect("mkdir");
    let err = backend
        .worktree_add(&handle.id, &taken, WorktreeBranch::New("wt".to_string()))
        .expect_err("an existing path must be refused");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
}

#[test]
fn lock_records_its_reason_and_unlock_clears_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, path) = worktree_target("locked-one");
    backend
        .worktree_add(&handle.id, &path, WorktreeBranch::New("wt".to_string()))
        .expect("worktree_add");

    backend
        .worktree_lock(&handle.id, "locked-one", Some("on a USB drive"))
        .expect("worktree_lock");
    let listed = backend.worktrees(&handle.id).expect("worktrees");
    assert!(listed[0].locked);
    assert_eq!(listed[0].lock_reason.as_deref(), Some("on a USB drive"));

    backend
        .worktree_unlock(&handle.id, "locked-one")
        .expect("worktree_unlock");
    let listed = backend.worktrees(&handle.id).expect("worktrees");
    assert!(!listed[0].locked);
    assert!(listed[0].lock_reason.is_none());
}

#[test]
fn remove_deletes_the_directory_and_the_admin_files() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, path) = worktree_target("goner");
    backend
        .worktree_add(&handle.id, &path, WorktreeBranch::New("wt".to_string()))
        .expect("worktree_add");

    backend
        .worktree_remove(&handle.id, "goner", false)
        .expect("worktree_remove");

    assert!(!path.exists(), "the working directory should be gone");
    assert!(backend.worktrees(&handle.id).expect("worktrees").is_empty());
    let listed = git_in(tr.path(), &["worktree", "list", "--porcelain"]);
    assert!(
        !listed.contains("goner"),
        "git should no longer know the worktree:\n{listed}"
    );
}

#[test]
fn remove_refuses_a_dirty_worktree_until_forced() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, path) = worktree_target("dirty");
    backend
        .worktree_add(&handle.id, &path, WorktreeBranch::New("wt".to_string()))
        .expect("worktree_add");
    // Uncommitted work in the worktree. THIS is why remove shells out to git
    // instead of using libgit2's prune-with-WORKING_TREE, which has no such check.
    std::fs::write(path.join("scratch.txt"), "unsaved work\n").expect("write");

    let err = backend
        .worktree_remove(&handle.id, "dirty", false)
        .expect_err("a dirty worktree must not be removed silently");
    assert!(matches!(err, AppError::DirtyWorktree(_)), "got {err:?}");
    assert!(path.exists(), "nothing may be deleted by the refused call");

    backend
        .worktree_remove(&handle.id, "dirty", true)
        .expect("forced remove");
    assert!(!path.exists());
}

#[test]
fn prune_takes_only_the_worktree_whose_directory_vanished() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let (hold_gone, gone) = worktree_target("vanished");
    backend
        .worktree_add(&handle.id, &gone, WorktreeBranch::New("wt-a".to_string()))
        .expect("worktree_add");
    let (_hold_keep, keep) = worktree_target("still-here");
    backend
        .worktree_add(&handle.id, &keep, WorktreeBranch::New("wt-b".to_string()))
        .expect("worktree_add");

    // Delete one behind git's back — the situation `git worktree prune` exists for.
    drop(hold_gone);
    assert!(!gone.exists());

    let listed = backend.worktrees(&handle.id).expect("worktrees");
    assert!(
        listed.iter().any(|w| w.name == "vanished" && w.prunable),
        "the deleted worktree should be reported prunable: {listed:?}"
    );

    let pruned = backend.worktree_prune(&handle.id).expect("worktree_prune");
    assert_eq!(pruned, ["vanished"]);
    let remaining = backend.worktrees(&handle.id).expect("worktrees");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].name, "still-here");
    assert!(keep.exists(), "prune must never delete a valid working tree");
}

#[test]
fn prune_leaves_a_locked_worktree_alone_even_when_its_directory_is_gone() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (hold, path) = worktree_target("locked-and-gone");
    backend
        .worktree_add(&handle.id, &path, WorktreeBranch::New("wt".to_string()))
        .expect("worktree_add");
    backend
        .worktree_lock(&handle.id, "locked-and-gone", Some("removable drive"))
        .expect("worktree_lock");
    drop(hold);

    // A lock is a promise that the absence is expected (an unmounted drive), and
    // `git worktree prune` honours it. Ours must too.
    assert!(backend.worktree_prune(&handle.id).expect("prune").is_empty());
    assert_eq!(backend.worktrees(&handle.id).expect("worktrees").len(), 1);
}

#[test]
fn an_unknown_worktree_name_is_an_argument_error_not_a_panic() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    for err in [
        backend.worktree_remove(&handle.id, "ghost", false).unwrap_err(),
        backend.worktree_lock(&handle.id, "ghost", None).unwrap_err(),
        backend.worktree_unlock(&handle.id, "ghost").unwrap_err(),
    ] {
        assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    }
}

/// Checking out a branch that a LINKED worktree is standing on (#356).
///
/// libgit2's `set_head` refuses this — "cannot set HEAD to reference '…' as it
/// is the current HEAD of a linked repository" — but `checkout_branch` used to
/// run `checkout_tree` FIRST, so the refusal arrived after the index and the
/// working tree had already been rewritten to the target's tree. HEAD never
/// moved, which left every difference between the two branches sitting in the
/// index as staged changes. git validates this before it touches anything, and
/// so must we.
#[test]
fn checkout_refuses_a_branch_held_by_a_linked_worktree_and_touches_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // `held` is the OLDER branch: forked at the initial commit, while the main
    // worktree moves on. That gap is what showed up staged in the bug report.
    backend
        .create_branch(&handle.id, "held", None)
        .expect("create_branch");
    tr.add_commit(
        "only-on-main.txt",
        "main moved on\n",
        "feat: a commit only main has",
    );

    let (_hold, path) = worktree_target("held-elsewhere");
    backend
        .worktree_add(
            &handle.id,
            &path,
            WorktreeBranch::Existing("held".to_string()),
        )
        .expect("worktree_add");

    let head_before = git_in(tr.path(), &["rev-parse", "HEAD"]);

    let err = backend
        .checkout_branch(&handle.id, "held")
        .expect_err("a branch held by a linked worktree cannot be checked out here");
    match &err {
        AppError::InvalidArgument(m) => assert!(
            m.contains("held") && m.contains("worktree"),
            "the refusal should name the branch and where it is checked out: {m}"
        ),
        other => panic!("expected InvalidArgument, got {other:?}"),
    }

    // The whole point: a refused checkout is a no-op.
    assert_eq!(
        head_before,
        git_in(tr.path(), &["rev-parse", "HEAD"]),
        "HEAD must not move"
    );
    let status = git_in(tr.path(), &["status", "--porcelain"]);
    assert!(
        status.trim().is_empty(),
        "a refused checkout must leave the index and working tree untouched:\n{status}"
    );
    assert!(
        tr.path().join("only-on-main.txt").exists(),
        "main's own file must still be in the working tree"
    );
}

/// The guard is about LINKED worktrees only. Re-checking-out the branch this
/// repository is already on is what `git checkout <current>` does every day, and
/// `checked_out_at` would otherwise report "this worktree" and refuse it.
#[test]
fn checkout_still_accepts_the_branch_this_worktree_is_already_on() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let current = git_in(tr.path(), &["rev-parse", "--abbrev-ref", "HEAD"])
        .trim()
        .to_string();

    backend
        .checkout_branch(&handle.id, &current)
        .expect("checking out the current branch is a no-op, not an error");
}
