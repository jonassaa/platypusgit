//! Fast-forwarding a branch that is NOT checked out (#246).
//!
//! `pull <remote> <branch>` merges the fetched head into whatever HEAD is, so it
//! could never advance `main` while you stood on `feat/x`. These pin the op that
//! can: the ancestry check and the ref move, decided on the commit graph.
//!
//! The remote is a local bare repo, so the suite stays offline. The FETCH half
//! lives in `commands::branches` (it needs `run_git_authenticated` and a Tauri
//! `State`); everything below is the half that decides and moves the ref.

mod support;

use platypusgit_lib::{error::AppError, git::GitBackend};
use support::{git_in, BareTempRepo, TempRepo};

/// A work repo whose `origin` is a bare repo, with `main` pushed and tracking.
fn tracked_pair() -> (TempRepo, BareTempRepo) {
    let tr = TempRepo::with_initial_commit("hello\n");
    let bare = BareTempRepo::new();
    git_in(
        tr.path(),
        &["remote", "add", "origin", bare.path.to_str().unwrap()],
    );
    git_in(tr.path(), &["push", "-u", "origin", "main"]);
    (tr, bare)
}

/// Push a commit and rewind the local branch, leaving it one BEHIND its
/// upstream. The remote-tracking ref keeps the pushed tip, so the state is the
/// one a fetch would have produced.
fn make_behind(tr: &TempRepo) {
    tr.add_commit("remote.txt", "remote\n", "remote-only commit");
    git_in(tr.path(), &["push", "origin", "main"]);
    git_in(tr.path(), &["reset", "--hard", "HEAD~1"]);
}

/// One commit on each side of the merge base: behind AND ahead.
fn make_diverged(tr: &TempRepo) {
    make_behind(tr);
    tr.add_commit("local.txt", "local\n", "local-only commit");
}

/// Step off `main` so it is no longer HEAD — the whole point of the op.
fn step_off_main(tr: &TempRepo) {
    git_in(tr.path(), &["checkout", "-b", "feat/x"]);
}

fn oid_of(tr: &TempRepo, refname: &str) -> String {
    git_in(tr.path(), &["rev-parse", refname]).trim().to_string()
}

#[test]
fn a_behind_branch_is_advanced_to_its_upstream() {
    let (tr, _bare) = tracked_pair();
    make_behind(&tr);
    step_off_main(&tr);
    let upstream = oid_of(&tr, "refs/remotes/origin/main");
    let before = oid_of(&tr, "refs/heads/main");
    assert_ne!(before, upstream, "fixture must leave main behind");

    let (backend, handle) = tr.open_with_backend();
    let ff = backend
        .fast_forward_branch(&handle.id, "main")
        .expect("fast-forward");

    assert!(ff.moved, "the ref should have moved");
    assert_eq!(ff.from, before);
    assert_eq!(ff.to, upstream);
    assert_eq!(ff.upstream, "origin/main");
    assert_eq!(oid_of(&tr, "refs/heads/main"), upstream);
}

#[test]
fn the_move_leaves_a_reflog_entry() {
    // A ref that moved with no reflog entry is a ref the user cannot walk back.
    let (tr, _bare) = tracked_pair();
    make_behind(&tr);
    step_off_main(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    backend.fast_forward_branch(&handle.id, "main").expect("ff");

    let reflog = git_in(tr.path(), &["reflog", "show", "main"]);
    assert!(
        reflog.contains(&before[..7]),
        "reflog should still reach the old tip: {reflog}"
    );
}

#[test]
fn a_diverged_branch_is_refused_and_its_ref_does_not_move() {
    let (tr, _bare) = tracked_pair();
    make_diverged(&tr);
    step_off_main(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_branch(&handle.id, "main")
        .expect_err("diverged must be refused");

    match &err {
        AppError::NotFastForward(msg) => {
            assert!(msg.contains("main"), "message names the branch: {msg}");
            assert!(
                msg.contains("origin/main"),
                "message names the upstream: {msg}"
            );
        }
        other => panic!("expected NotFastForward, got {other:?}"),
    }
    assert_eq!(
        oid_of(&tr, "refs/heads/main"),
        before,
        "a refused fast-forward moves nothing"
    );
}

#[test]
fn an_up_to_date_branch_is_a_clean_no_op() {
    let (tr, _bare) = tracked_pair();
    step_off_main(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let ff = backend
        .fast_forward_branch(&handle.id, "main")
        .expect("up to date is not a failure");

    assert!(!ff.moved);
    assert_eq!(ff.from, before);
    assert_eq!(ff.to, before);
    assert_eq!(oid_of(&tr, "refs/heads/main"), before);
}

#[test]
fn a_branch_that_is_ahead_of_its_upstream_is_a_no_op_too() {
    // Strictly ahead is not divergence: there is nothing to fast-forward TO,
    // which `git pull --ff-only` also reports as "Already up to date".
    let (tr, _bare) = tracked_pair();
    tr.add_commit("local.txt", "local\n", "local-only commit");
    step_off_main(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let ff = backend.fast_forward_branch(&handle.id, "main").expect("ahead");

    assert!(!ff.moved);
    assert_eq!(oid_of(&tr, "refs/heads/main"), before);
}

#[test]
fn a_branch_with_no_upstream_says_so() {
    let (tr, _bare) = tracked_pair();
    git_in(tr.path(), &["branch", "orphan"]);

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_branch(&handle.id, "orphan")
        .expect_err("no upstream");
    assert!(
        matches!(&err, AppError::NoUpstream(msg) if msg.contains("orphan")),
        "got {err:?}"
    );
}

#[test]
fn an_unknown_branch_is_an_invalid_ref() {
    let (tr, _bare) = tracked_pair();
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_branch(&handle.id, "nope")
        .expect_err("unknown branch");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

#[test]
fn the_checked_out_branch_is_refused_so_the_caller_pulls_instead() {
    // Moving HEAD's ref without touching the index or worktree would leave the
    // working tree looking like every incoming change had been reverted.
    let (tr, _bare) = tracked_pair();
    make_behind(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_branch(&handle.id, "main")
        .expect_err("HEAD must be refused");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert_eq!(oid_of(&tr, "refs/heads/main"), before);
}

#[test]
fn a_branch_checked_out_in_a_linked_worktree_is_refused() {
    // This project is developed through `.claude/worktrees/`: moving a ref out
    // from under a linked worktree gives that checkout a phantom reverse diff.
    let (tr, _bare) = tracked_pair();
    make_behind(&tr);
    step_off_main(&tr);
    let (_dir, wt_path) = support::worktree_target("wt-main");
    git_in(
        tr.path(),
        &["worktree", "add", wt_path.to_str().unwrap(), "main"],
    );
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_branch(&handle.id, "main")
        .expect_err("checked out elsewhere");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert_eq!(oid_of(&tr, "refs/heads/main"), before);
}

#[test]
fn the_remote_to_fetch_comes_from_the_branchs_own_config() {
    // Not `upstream.split('/')[0]`: a remote name may itself contain a slash.
    let (tr, _bare) = tracked_pair();
    git_in(tr.path(), &["remote", "rename", "origin", "team/fork"]);
    step_off_main(&tr);

    let (backend, handle) = tr.open_with_backend();
    assert_eq!(
        backend.fast_forward_remote(&handle.id, "main").expect("remote"),
        "team/fork"
    );
}

#[test]
fn the_remote_lookup_refuses_head_before_any_network_happens() {
    let (tr, _bare) = tracked_pair();
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_remote(&handle.id, "main")
        .expect_err("HEAD must be refused up front");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
}

#[test]
fn the_remote_lookup_refuses_a_branch_with_no_upstream() {
    let (tr, _bare) = tracked_pair();
    git_in(tr.path(), &["branch", "orphan"]);
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .fast_forward_remote(&handle.id, "orphan")
        .expect_err("no upstream");
    assert!(matches!(err, AppError::NoUpstream(_)), "got {err:?}");
}

#[test]
fn bulk_advances_every_behind_branch_and_reports_the_rest() {
    let (tr, _bare) = tracked_pair();

    // `main`: behind by one, a clean fast-forward.
    make_behind(&tr);
    // `topic`: pushed, then rewound AND given a local commit — diverged.
    git_in(tr.path(), &["checkout", "-b", "topic"]);
    tr.add_commit("topic.txt", "topic\n", "topic base");
    git_in(tr.path(), &["push", "-u", "origin", "topic"]);
    tr.add_commit("topic2.txt", "topic2\n", "remote-only on topic");
    git_in(tr.path(), &["push", "origin", "topic"]);
    git_in(tr.path(), &["reset", "--hard", "HEAD~1"]);
    tr.add_commit("topic-local.txt", "l\n", "local-only on topic");
    // `orphan`: no upstream at all.
    git_in(tr.path(), &["branch", "orphan"]);
    // Stand somewhere that is neither.
    git_in(tr.path(), &["checkout", "-b", "feat/x"]);

    let main_upstream = oid_of(&tr, "refs/remotes/origin/main");
    let topic_before = oid_of(&tr, "refs/heads/topic");

    let (backend, handle) = tr.open_with_backend();
    let report = backend.fast_forward_all(&handle.id).expect("bulk");

    let advanced: Vec<_> = report.advanced.iter().map(|f| f.branch.as_str()).collect();
    assert_eq!(advanced, ["main"], "only main could fast-forward");
    assert_eq!(oid_of(&tr, "refs/heads/main"), main_upstream);

    assert_eq!(report.diverged, ["topic"]);
    assert_eq!(
        oid_of(&tr, "refs/heads/topic"),
        topic_before,
        "a diverged branch is left exactly where it was"
    );

    assert!(
        report.checked_out.is_empty(),
        "feat/x has no upstream, so it is not reportable"
    );
    // A branch with no upstream is simply not part of the answer.
    assert!(!report.diverged.iter().any(|b| b == "orphan"));
}

#[test]
fn bulk_leaves_the_checked_out_branch_for_pull_and_names_it() {
    let (tr, _bare) = tracked_pair();
    make_behind(&tr);
    let before = oid_of(&tr, "refs/heads/main");

    let (backend, handle) = tr.open_with_backend();
    let report = backend.fast_forward_all(&handle.id).expect("bulk");

    assert!(report.advanced.is_empty());
    assert_eq!(report.checked_out, ["main"]);
    assert_eq!(
        oid_of(&tr, "refs/heads/main"),
        before,
        "HEAD's branch is never moved from under the working tree"
    );
}

#[test]
fn bulk_on_an_already_current_repo_reports_nothing() {
    let (tr, _bare) = tracked_pair();
    step_off_main(&tr);
    let (backend, handle) = tr.open_with_backend();
    let report = backend.fast_forward_all(&handle.id).expect("bulk");
    assert!(report.advanced.is_empty());
    assert!(report.diverged.is_empty());
    assert!(report.checked_out.is_empty());
}

#[test]
fn a_checked_out_branch_with_no_upstream_is_told_about_the_upstream() {
    // Both refusals apply; the one the user can act on wins. "Pull it instead"
    // is useless advice for a branch that tracks nothing.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    for err in [
        backend.fast_forward_branch(&handle.id, "main").unwrap_err(),
        backend.fast_forward_remote(&handle.id, "main").unwrap_err(),
    ] {
        assert!(matches!(err, AppError::NoUpstream(_)), "got {err:?}");
    }
}
