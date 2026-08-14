//! The execution model: a rebase replays on a detached HEAD and moves the
//! branch ref exactly once, when the plan completes. Anything that fails or
//! pauses mid-way therefore leaves the branch where it was.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{linear_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        message: None,
    }
}

fn branch_tip(tr: &TempRepo, name: &str) -> String {
    tr.repo
        .find_reference(&format!("refs/heads/{name}"))
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string()
}

#[test]
fn paused_rebase_detaches_head_and_leaves_the_branch_alone() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit), // pauses here
        step(&oids[2], RebaseAction::Pick),
    ];

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(status.in_progress, "edit should pause the rebase");
    assert_eq!(status.pause_reason.as_deref(), Some("edit"));

    assert!(
        tr.repo.head_detached().unwrap(),
        "HEAD must be detached while a rebase is replaying"
    );
    assert_eq!(
        branch_tip(&tr, "main"),
        tip_before,
        "the branch ref must not move until the plan completes"
    );

    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress, "rebase should finish after continue");
    assert!(
        !tr.repo.head_detached().unwrap(),
        "HEAD must be back on the branch when the plan completes"
    );
    assert_eq!(
        tr.repo.head().unwrap().name().unwrap(),
        "refs/heads/main",
        "HEAD should be reattached to the original branch"
    );
    // The branch points at the replayed history. Note the oids here are
    // *expected* to match the originals: replaying unchanged commits onto the
    // same base reproduces them byte for byte (same tree, message, author, and
    // same-second committer), so the invariant to assert is that the branch and
    // HEAD agree — not that the tip changed.
    let tip_after = branch_tip(&tr, "main");
    assert_eq!(
        tr.repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string(),
        tip_after,
        "HEAD and the branch must agree once the rebase is done"
    );
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert_eq!(
        summaries,
        vec!["commit 2", "commit 1", "commit 0", "initial"],
        "every planned step must have been replayed onto the branch"
    );
}

#[test]
fn abort_mid_rebase_restores_the_branch_and_reattaches_head() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit),
        step(&oids[2], RebaseAction::Pick),
    ];
    backend.rebase_start(&handle.id, plan).unwrap();

    backend.rebase_abort(&handle.id).unwrap();

    assert!(!tr.repo.head_detached().unwrap(), "abort must reattach HEAD");
    assert_eq!(tr.repo.head().unwrap().name().unwrap(), "refs/heads/main");
    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert_eq!(
        tr.repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string(),
        tip_before
    );
    assert!(
        tr.repo.statuses(None).unwrap().is_empty(),
        "worktree left dirty"
    );
}
