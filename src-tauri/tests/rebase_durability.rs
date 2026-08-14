//! The execution model: a rebase replays on a detached HEAD and moves the
//! branch ref exactly once, when the plan completes. Anything that fails or
//! pauses mid-way therefore leaves the branch where it was.

mod support;

use platypusgit_lib::git::{
    libgit2::Libgit2Backend,
    types::{RebaseAction, RebaseStep, RepoState},
    GitBackend,
};

use support::{linear_history, TempRepo};

fn step(oid: &str, action: RebaseAction) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
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

// ─── on-disk state ───────────────────────────────────────────────────────────

#[test]
fn a_paused_rebase_is_visible_on_disk_and_reports_as_a_rebase() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);

    let (backend, handle) = tr.open_with_backend();
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit),
        step(&oids[2], RebaseAction::Pick),
    ];
    backend.rebase_start(&handle.id, plan).unwrap();

    let state_file = tr.path().join(".git").join("platypusgit-rebase.json");
    assert!(
        state_file.exists(),
        "a paused rebase must be recorded on disk"
    );
    assert!(
        tr.path().join(".git").join("ORIG_HEAD").exists(),
        "ORIG_HEAD is the CLI escape hatch and must be written"
    );
    assert_eq!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::RebaseInteractive,
        "a paused rebase must report as a rebase, not as Clean or CherryPick"
    );

    backend.rebase_continue(&handle.id).unwrap();
    assert!(
        !state_file.exists(),
        "the state file must be swept when the plan completes"
    );
    assert_eq!(backend.repo_state(&handle.id).unwrap(), RepoState::Clean);
}

#[test]
fn a_restarted_app_can_still_abort() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");

    {
        let (backend, handle) = tr.open_with_backend();
        let plan = vec![
            step(&oids[0], RebaseAction::Pick),
            step(&oids[1], RebaseAction::Edit),
            step(&oids[2], RebaseAction::Pick),
        ];
        backend.rebase_start(&handle.id, plan).unwrap();
    } // backend dropped — every trace of the in-memory RebaseState is gone

    // A fresh backend is what the app has after a restart.
    let backend = Libgit2Backend::new();
    let handle = backend.open(tr.path()).unwrap();

    let status = backend.rebase_status(&handle.id).unwrap();
    assert!(
        status.in_progress,
        "the rebase must still be reported as in progress after a restart"
    );
    assert_eq!(status.total, 3);
    assert_eq!(
        status.next_index, 2,
        "the pick and the edit both landed their commits before the pause — an \
         edit pauses *after* committing, so it counts as completed"
    );

    backend.rebase_abort(&handle.id).unwrap();
    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert!(!tr.repo.head_detached().unwrap());
    assert!(!tr
        .path()
        .join(".git")
        .join("platypusgit-rebase.json")
        .exists());
}

#[test]
fn a_restarted_app_can_still_continue() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);

    {
        let (backend, handle) = tr.open_with_backend();
        backend
            .rebase_start(
                &handle.id,
                vec![
                    step(&oids[0], RebaseAction::Pick),
                    step(&oids[1], RebaseAction::Edit),
                    step(&oids[2], RebaseAction::Pick),
                ],
            )
            .unwrap();
    } // restart

    let backend = Libgit2Backend::new();
    let handle = backend.open(tr.path()).unwrap();

    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(
        !done.in_progress,
        "the rehydrated plan should run to completion"
    );
    assert_eq!(done.total, 3);
    assert!(
        !tr.repo.head_detached().unwrap(),
        "HEAD reattached on completion"
    );
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert_eq!(
        summaries[0], "commit 2",
        "the last step must have been replayed"
    );
}

// ─── one engine behind both Continue and Abort ────────────────────────────────

/// main's two commits both touch `shared.txt`, so replaying the second on a
/// rewritten first conflicts.
fn conflicting_plan_repo() -> (TempRepo, Vec<String>) {
    let tr = TempRepo::with_initial_commit("root\n");
    let mut oids = Vec::new();
    for (body, msg) in [("one\n", "first"), ("two\n", "second")] {
        support::fs::write_file(tr.path(), "shared.txt", body);
        oids.push(tr.commit_all(msg).to_string());
    }
    (tr, oids)
}

#[test]
fn continue_operation_during_a_rebase_advances_the_plan() {
    let (tr, oids) = conflicting_plan_repo();
    let (backend, handle) = tr.open_with_backend();

    // Pause on the first commit, rewrite its content so replaying the second
    // conflicts.
    let plan = vec![
        step(&oids[0], RebaseAction::Edit),
        step(&oids[1], RebaseAction::Pick),
    ];
    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert_eq!(status.pause_reason.as_deref(), Some("edit"));

    // What the UI does during an edit pause: amend the step's commit. Leaving
    // changes merely staged is not a resolution — the next cherry-pick would
    // refuse to overwrite them.
    support::fs::write_file(tr.path(), "shared.txt", "diverged\n");
    {
        let mut index = tr.repo.index().unwrap();
        index
            .add_path(std::path::Path::new("shared.txt"))
            .unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        head.amend(Some("HEAD"), None, None, None, None, Some(&tree))
            .unwrap();
    }

    let status = backend.rebase_continue(&handle.id).unwrap();
    assert_eq!(
        status.pause_reason.as_deref(),
        Some("conflict"),
        "replaying the second commit should conflict"
    );

    // The user resolves in the Conflict screen and presses ITS Continue, which
    // calls continue_operation — not rebase_continue.
    support::fs::write_file(tr.path(), "shared.txt", "resolved\n");
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("shared.txt")])
        .unwrap();
    backend.continue_operation(&handle.id).unwrap();

    let status = backend.rebase_status(&handle.id).unwrap();
    assert!(
        !status.in_progress,
        "the Conflict screen's Continue must advance the plan, not just commit"
    );
    assert!(
        !tr.repo.head_detached().unwrap(),
        "HEAD should be reattached once the plan completes"
    );
    assert!(
        !tr.path()
            .join(".git")
            .join("platypusgit-rebase.json")
            .exists(),
        "a completed rebase must leave no state file behind"
    );
    let summaries: Vec<String> = backend
        .log(&handle.id, None, 10)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert_eq!(summaries[0], "second", "the last step must have landed");
}

#[test]
fn abort_operation_during_a_rebase_restores_the_branch() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let tip_before = branch_tip(&tr, "main");
    let (backend, handle) = tr.open_with_backend();

    backend
        .rebase_start(
            &handle.id,
            vec![
                step(&oids[0], RebaseAction::Pick),
                step(&oids[1], RebaseAction::Edit),
                step(&oids[2], RebaseAction::Pick),
            ],
        )
        .unwrap();

    backend.abort_operation(&handle.id).unwrap();

    assert_eq!(branch_tip(&tr, "main"), tip_before);
    assert!(!tr.repo.head_detached().unwrap());
    assert!(!backend.rebase_status(&handle.id).unwrap().in_progress);
    assert!(!tr
        .path()
        .join(".git")
        .join("platypusgit-rebase.json")
        .exists());
}
