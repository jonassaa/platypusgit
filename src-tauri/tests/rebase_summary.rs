//! The completed-rebase summary the backend retains until acknowledged (#47).
//!
//! The engine sweeps its `RebaseState` the moment a plan finishes, so a
//! `rebase_status` poll one tick later has nothing left to describe. The
//! frontend used to cache the final status for its "N steps completed" line,
//! which put the burden of invalidating that cache on every abort and start
//! path. These tests pin the replacement contract:
//!
//! - completion records a summary, and it survives repeated polls;
//! - a NEW rebase start drops it (it describes a superseded operation);
//! - an abort drops it (there is no outcome to report);
//! - `rebase_acknowledge` drops it, and only once it is asked to;
//! - it lives in its own file, so nothing that asks "is a rebase in progress?"
//!   mistakes a finished rebase for a live one.

mod support;

use platypusgit_lib::git::{
    rebase_state,
    types::{RebaseAction, RebaseStep, RebaseSummary, RepoState},
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

fn pick_all(oids: &[String]) -> Vec<RebaseStep> {
    oids.iter().map(|o| step(o, RebaseAction::Pick)).collect()
}

#[test]
fn a_completed_rebase_leaves_a_summary_that_survives_polling() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    let done = backend.rebase_start(&handle.id, pick_all(&oids)).unwrap();
    assert!(!done.in_progress, "a plain pick plan runs to completion");
    assert_eq!(
        done.last_completed,
        Some(RebaseSummary {
            total: 3,
            completed: 3
        }),
        "the call that finished the rebase reports its own summary"
    );

    // The engine's state is gone — total is back to 0 — but the summary is not.
    for _ in 0..3 {
        let polled = backend.rebase_status(&handle.id).unwrap();
        assert!(!polled.in_progress);
        assert_eq!(polled.total, 0, "RebaseState really was swept");
        assert_eq!(
            polled.last_completed,
            Some(RebaseSummary {
                total: 3,
                completed: 3
            }),
            "the summary must outlive the state it summarises"
        );
    }
}

#[test]
fn acknowledging_drops_the_summary_and_nothing_else_does() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2);
    let (backend, handle) = tr.open_with_backend();

    backend.rebase_start(&handle.id, pick_all(&oids)).unwrap();
    assert!(backend
        .rebase_status(&handle.id)
        .unwrap()
        .last_completed
        .is_some());

    backend.rebase_acknowledge(&handle.id).unwrap();
    assert_eq!(
        backend.rebase_status(&handle.id).unwrap().last_completed,
        None,
        "acknowledging is what spends the summary"
    );

    // Idempotent: a second acknowledge (double refresh, second window) is fine.
    backend.rebase_acknowledge(&handle.id).unwrap();
    assert_eq!(backend.rebase_status(&handle.id).unwrap().last_completed, None);
}

#[test]
fn starting_a_new_rebase_drops_the_previous_summary() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    backend
        .rebase_start(&handle.id, pick_all(&oids[..2]))
        .unwrap();
    assert!(backend
        .rebase_status(&handle.id)
        .unwrap()
        .last_completed
        .is_some());

    // A rebase that PAUSES: the previous summary must be gone from the moment
    // the new operation begins, not merely once it finishes.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    let paused = backend
        .rebase_start(&handle.id, vec![step(&head, RebaseAction::Edit)])
        .unwrap();
    assert!(paused.in_progress, "an edit step pauses");
    assert_eq!(
        paused.last_completed, None,
        "a new rebase supersedes the last one's summary"
    );
    assert_eq!(
        backend.rebase_status(&handle.id).unwrap().last_completed,
        None
    );

    // ...and finishing this one records its own.
    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress);
    assert_eq!(
        done.last_completed,
        Some(RebaseSummary {
            total: 1,
            completed: 1
        })
    );
}

#[test]
fn aborting_drops_the_summary() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    // One completed rebase, so there is a summary to be wrongly kept.
    backend
        .rebase_start(&handle.id, pick_all(&oids[..2]))
        .unwrap();
    assert!(backend
        .rebase_status(&handle.id)
        .unwrap()
        .last_completed
        .is_some());

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    backend
        .rebase_start(&handle.id, vec![step(&head, RebaseAction::Edit)])
        .unwrap();
    backend.rebase_abort(&handle.id).unwrap();

    let after = backend.rebase_status(&handle.id).unwrap();
    assert!(!after.in_progress, "the abort ended the rebase");
    assert_eq!(
        after.last_completed, None,
        "an abort has no outcome to report, and must not leave the earlier one \
         standing as if it were this rebase's"
    );

    // Aborting with a fresh summary and nothing in progress clears it too.
    backend
        .rebase_start(&handle.id, vec![step(&oids[2], RebaseAction::Pick)])
        .unwrap();
    assert!(backend
        .rebase_status(&handle.id)
        .unwrap()
        .last_completed
        .is_some());
    backend.rebase_abort(&handle.id).unwrap();
    assert_eq!(
        backend.rebase_status(&handle.id).unwrap().last_completed,
        None
    );
}

#[test]
fn the_summary_lives_beside_the_state_file_not_inside_it() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2);
    let (backend, handle) = tr.open_with_backend();

    backend.rebase_start(&handle.id, pick_all(&oids)).unwrap();

    assert!(
        rebase_state::summary_path(&tr.repo).exists(),
        "completion writes the summary file"
    );
    assert!(
        !rebase_state::path(&tr.repo).exists(),
        "the in-progress state file is swept on completion"
    );
    // Everything that asks "is a rebase in progress?" answers by the existence
    // of the in-progress file, so the summary must not be able to trip it.
    assert!(
        rebase_state::load(&tr.repo).unwrap().is_none(),
        "no in-progress rebase is on disk"
    );
    assert_eq!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Clean,
        "a retained summary must not read as an open operation"
    );

    backend.rebase_acknowledge(&handle.id).unwrap();
    assert!(!rebase_state::summary_path(&tr.repo).exists());
}

#[test]
fn a_summary_survives_a_backend_restart() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2);
    {
        let (backend, handle) = tr.open_with_backend();
        backend.rebase_start(&handle.id, pick_all(&oids)).unwrap();
    }

    // A fresh backend has no in-memory rebase map at all: the summary is on
    // disk for the same reason the in-progress state is.
    let (backend, handle) = tr.open_with_backend();
    assert_eq!(
        backend.rebase_status(&handle.id).unwrap().last_completed,
        Some(RebaseSummary {
            total: 2,
            completed: 2
        })
    );
}

#[test]
fn an_unreadable_summary_is_forgotten_rather_than_failing_the_status_poll() {
    let tr = TempRepo::with_initial_commit("root\n");
    let (backend, handle) = tr.open_with_backend();

    // A summary describes an operation that already finished, so nothing is at
    // risk in forgetting it — unlike the in-progress state, where guessing
    // would strand a half-replayed branch. Failing here would instead break
    // every refresh until the user deleted the file by hand.
    std::fs::write(rebase_state::summary_path(&tr.repo), b"{ not json").unwrap();
    let status = backend.rebase_status(&handle.id).unwrap();
    assert_eq!(status.last_completed, None);
    assert!(!status.in_progress);
}
