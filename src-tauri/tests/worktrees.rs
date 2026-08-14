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
