//! A plan the engine cannot execute must be refused before the repository is
//! touched. The bug this pins: a merge commit in the plan used to surface
//! libgit2's "mainline branch is not specified" error on the step that reached
//! it — after earlier picks had already been committed and the branch tip
//! moved.

mod support;

use platypusgit_lib::{
    error::AppError,
    git::{
        types::{RebaseAction, RebaseStep},
        GitBackend,
    },
};

use support::{merge_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
    }
}

/// Every rejection must leave HEAD, the branch ref, and the worktree exactly
/// as they were.
fn assert_untouched(tr: &TempRepo, head_before: &str) {
    let head_now = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();
    assert_eq!(head_now, head_before, "HEAD moved on a rejected plan");
    let branch = tr
        .repo
        .find_reference("refs/heads/main")
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();
    assert_eq!(branch, head_before, "branch ref moved on a rejected plan");
    assert!(
        tr.repo.statuses(None).unwrap().is_empty(),
        "worktree dirtied by a rejected plan"
    );
}

#[test]
fn merge_commit_with_pick_is_rejected_before_anything_moves() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![
        step(&h.a, RebaseAction::Pick),
        step(&h.f, RebaseAction::Pick),
        step(&h.c, RebaseAction::Pick),
        step(&h.m, RebaseAction::Pick), // the merge
    ];

    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    match err {
        AppError::InvalidRebasePlan(msg) => {
            assert!(
                msg.contains(&h.m[..7]),
                "message should name the merge: {msg}"
            );
            assert!(msg.contains("merge"), "message should say why: {msg}");
        }
        other => panic!("expected InvalidRebasePlan, got {other:?}"),
    }
    assert_untouched(&tr, &head_before);
    assert!(!backend.rebase_status(&handle.id).unwrap().in_progress);
}

#[test]
fn merge_commit_may_be_dropped() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let plan = vec![
        step(&h.a, RebaseAction::Pick),
        step(&h.f, RebaseAction::Pick),
        step(&h.c, RebaseAction::Pick),
        step(&h.m, RebaseAction::Drop),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(
        !status.in_progress,
        "flattening plan should run to completion"
    );
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 20)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert!(summaries.iter().any(|s| s == "F on feature"));
    assert!(!summaries.iter().any(|s| s.starts_with("Merge branch")));
}

#[test]
fn duplicate_oid_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![
        step(&h.a, RebaseAction::Pick),
        step(&h.a, RebaseAction::Pick),
    ];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}

#[test]
fn unknown_oid_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![step(
        "0000000000000000000000000000000000000000",
        RebaseAction::Pick,
    )];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}

#[test]
fn all_drop_plan_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let head_before = h.m.clone();

    let plan = vec![step(&h.a, RebaseAction::Drop)];
    let err = backend.rebase_start(&handle.id, plan).unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_untouched(&tr, &head_before);
}
