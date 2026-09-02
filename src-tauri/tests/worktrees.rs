//! Linked-worktree integration tests (#93).
//!
//! **Every worktree here lives in its own tempdir.** This project is developed
//! through `.claude/worktrees/`, so a test that pointed `worktree_remove` at a real
//! path would delete a live checkout of the repository. `worktree_target` exists to
//! make that impossible to do by accident.

mod support;

use std::path::PathBuf;

use tempfile::TempDir;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::types::{RepoId, WorktreeBranch};
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
        .checkout_branch(&handle.id, "held", false)
        .expect_err("a branch held by a linked worktree cannot be checked out here");
    match &err {
        AppError::BranchHeldByWorktree(held) => {
            assert_eq!(held.branch, "held");
            assert_eq!(held.worktree, "held-elsewhere");
        }
        other => panic!("expected BranchHeldByWorktree, got {other:?}"),
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
        .checkout_branch(&handle.id, &current, false)
        .expect("checking out the current branch is a no-op, not an error");
}

// ─────────────────────────────────────────────────────────────────────────────
// Taking a held branch (#358)
//
// The refusal above tells the user where the branch is, but the answer they
// usually want is "bring it here". A worktree can RELEASE a branch without
// being removed: it is already standing on the branch's tip, so releasing is a
// rewrite of its HEAD to the same oid — `set_head_detached`, no checkout, no
// index write. That is why its uncommitted work survives, and these tests are
// what pin that.
// ─────────────────────────────────────────────────────────────────────────────

/// Build the shape every test below needs: `held` forked at the initial commit
/// and checked out in a linked worktree, `main` one commit ahead. Returns the
/// holder's path.
fn with_holder(tr: &TempRepo, backend: &Libgit2Backend, id: &RepoId) -> (TempDir, PathBuf) {
    backend.create_branch(id, "held", None).expect("create_branch");
    tr.add_commit(
        "only-on-main.txt",
        "main moved on\n",
        "feat: a commit only main has",
    );
    let (hold, path) = worktree_target("holder");
    backend
        .worktree_add(id, &path, WorktreeBranch::Existing("held".to_string()))
        .expect("worktree_add");
    (hold, path)
}

#[test]
fn taking_a_held_branch_checks_it_out_here_and_leaves_the_holder_detached() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);

    let tip = git_in(&holder, &["rev-parse", "HEAD"]).trim().to_string();

    backend
        .checkout_branch(&handle.id, "held", true)
        .expect("taking the branch should succeed");

    // Here: actually on the branch.
    assert_eq!(
        git_in(tr.path(), &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "held"
    );
    // There: same commit, no longer on the branch, directory still a worktree.
    assert_eq!(
        git_in(&holder, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "HEAD",
        "the holder should be detached"
    );
    assert_eq!(
        git_in(&holder, &["rev-parse", "HEAD"]).trim(),
        tip,
        "the holder must not move off the commit it was on"
    );
    assert!(
        holder.join("README.md").exists(),
        "releasing a branch must not touch the holder's files"
    );
}

#[test]
fn taking_a_held_branch_leaves_the_holders_uncommitted_work_alone() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);

    // Someone is mid-thought in that worktree.
    std::fs::write(holder.join("README.md"), "half-finished edit\n").expect("write");
    std::fs::write(holder.join("scratch.txt"), "untracked notes\n").expect("write");

    backend
        .checkout_branch(&handle.id, "held", true)
        .expect("a dirty holder is still releasable — its files are never written");

    let status = git_in(&holder, &["status", "--porcelain"]);
    assert!(
        status.contains("README.md"),
        "the holder's modification must survive:\n{status}"
    );
    assert!(
        status.contains("scratch.txt"),
        "the holder's untracked file must survive:\n{status}"
    );
    assert_eq!(
        std::fs::read_to_string(holder.join("README.md")).expect("read"),
        "half-finished edit\n",
        "the holder's working tree is never written to"
    );
}

#[test]
fn taking_is_refused_while_the_holder_is_locked() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);

    backend
        .worktree_lock(&handle.id, "holder", Some("do not touch"))
        .expect("worktree_lock");

    let err = backend
        .checkout_branch(&handle.id, "held", true)
        .expect_err("a lock is an explicit 'leave me alone'");
    match &err {
        AppError::InvalidArgument(m) => {
            assert!(m.contains("locked"), "the refusal should say it is locked: {m}")
        }
        other => panic!("expected InvalidArgument, got {other:?}"),
    }
    assert_eq!(
        git_in(&holder, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "held",
        "a refused take must leave the holder on its branch"
    );
}

#[test]
fn taking_is_refused_while_the_holder_is_mid_operation() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);

    // A merge left half-done in the holder. Detaching HEAD under an in-progress
    // operation abandons it in a state neither git nor the user can explain.
    backend
        .create_branch(&handle.id, "other", None)
        .expect("create_branch");
    git_in(&holder, &["merge", "--no-commit", "--no-ff", "main"]);
    assert!(
        holder.join(".git").exists(),
        "sanity: the holder is a linked worktree"
    );

    let err = backend
        .checkout_branch(&handle.id, "held", true)
        .expect_err("a half-finished operation must block the take");
    match &err {
        AppError::InvalidArgument(m) => assert!(
            m.contains("in progress"),
            "the refusal should name the unfinished operation: {m}"
        ),
        other => panic!("expected InvalidArgument, got {other:?}"),
    }
    assert_eq!(
        git_in(&holder, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "held",
        "a refused take must leave the holder on its branch"
    );
}

#[test]
fn a_take_whose_checkout_fails_puts_the_holder_back_on_its_branch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);

    // Give `held` a file main does not have...
    std::fs::write(holder.join("f.txt"), "from held\n").expect("write");
    git_in(&holder, &["add", "f.txt"]);
    git_in(&holder, &["commit", "-m", "add f"]);
    // ...and put an untracked one of the same name here, so the checkout that
    // follows the release is refused rather than overwriting it.
    support::fs::write_file(tr.path(), "f.txt", "mine, untracked\n");

    let err = backend
        .checkout_branch(&handle.id, "held", true)
        .expect_err("an untracked file in the way must still refuse the checkout");
    assert!(
        matches!(err, AppError::DirtyWorktree(_)),
        "expected DirtyWorktree, got {err:?}"
    );

    // The release must be undone: leaving the holder detached would have cost it
    // its branch for a checkout that never happened.
    assert_eq!(
        git_in(&holder, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "held",
        "the holder must be back on its branch"
    );
    assert_eq!(
        std::fs::read_to_string(tr.path().join("f.txt")).expect("read"),
        "mine, untracked\n",
        "and our untracked file must be untouched"
    );
}

#[test]
fn the_refusal_names_the_branch_the_worktree_and_its_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, _holder) = with_holder(&tr, &backend, &handle.id);

    let err = backend
        .checkout_branch(&handle.id, "held", false)
        .expect_err("without `take`, a held branch is still refused");
    match &err {
        AppError::BranchHeldByWorktree(held) => {
            assert_eq!(held.branch, "held");
            assert_eq!(held.worktree, "holder");
            // The PATH is what the dialog needs: it is the only thing that tells
            // two identically-named checkouts apart, and it is what "Open that
            // one" opens.
            assert!(
                held.path.contains("holder"),
                "the payload should carry the holder's path: {}",
                held.path
            );
            assert!(
                held.blocked.is_none(),
                "a clean, unlocked holder is takeable: {:?}",
                held.blocked
            );
            assert!(!held.dirty, "this holder has no uncommitted work");
        }
        other => panic!("expected BranchHeldByWorktree, got {other:?}"),
    }
}

#[test]
fn the_refusal_reports_a_blocked_holder_so_the_ui_can_hide_the_offer() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let (_hold, holder) = with_holder(&tr, &backend, &handle.id);
    std::fs::write(holder.join("README.md"), "edited\n").expect("write");
    backend
        .worktree_lock(&handle.id, "holder", Some("do not touch"))
        .expect("worktree_lock");

    let err = backend
        .checkout_branch(&handle.id, "held", false)
        .expect_err("still refused");
    match &err {
        AppError::BranchHeldByWorktree(held) => {
            assert!(
                held.blocked.as_deref().is_some_and(|b| b.contains("locked")),
                "a locked holder must be reported as blocked: {:?}",
                held.blocked
            );
            assert!(held.dirty, "and its uncommitted work must be reported");
        }
        other => panic!("expected BranchHeldByWorktree, got {other:?}"),
    }
}
