//! Live progress from a rebase replay (#296).
//!
//! `rebase_start` runs the entire plan inside one call and returns a
//! `RebaseStatus` only when it finishes or pauses, so the operation bar's
//! "step N of M" could only ever render at a pause — never during the replay,
//! which is the part that takes the time on a long plan. These tests pin the
//! sink that fixes that:
//!
//! - one tick per step, in plan order, before the step is applied;
//! - `next_index` counts steps ALREADY done, matching `RebaseStatus.next_index`,
//!   so the same `+ 1` arithmetic renders both;
//! - drops tick too — they are part of `total`, and skipping them would make the
//!   counter appear to stall;
//! - a pause stops the ticks where the replay stopped, and `rebase_continue`
//!   resumes them rather than restarting from zero;
//! - the plain `rebase_start` still works, because every test and internal
//!   resume in the codebase calls it.

mod support;

use std::sync::Mutex;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseProgress, RebaseStep, RepoId},
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

/// Collects every tick a replay publishes. A `Mutex` because the sink is
/// `Fn + Send + Sync` — it has to be, since it runs inside `spawn_blocking` in
/// the real command.
#[derive(Default)]
struct Ticks(Mutex<Vec<RebaseProgress>>);

impl Ticks {
    fn sink(&self) -> impl Fn(RebaseProgress) + Send + Sync + '_ {
        move |p| self.0.lock().unwrap().push(p)
    }
    fn taken(&self) -> Vec<RebaseProgress> {
        self.0.lock().unwrap().clone()
    }
}

#[test]
fn every_step_ticks_once_in_plan_order_before_it_is_applied() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    let ticks = Ticks::default();
    let done = backend
        .rebase_start_with_progress(&handle.id, pick_all(&oids), &ticks.sink())
        .unwrap();
    assert!(!done.in_progress, "a plain pick plan runs to completion");

    let seen = ticks.taken();
    assert_eq!(seen.len(), 3, "one tick per step, no more");

    // `next_index` is how many steps are DONE, so the first step reports 0 —
    // the same value `RebaseStatus.next_index` carries, which is what lets the
    // operation bar render both with one `+ 1`.
    assert_eq!(
        seen.iter().map(|p| p.next_index).collect::<Vec<_>>(),
        [0, 1, 2],
        "the counter advances one step at a time, starting at zero"
    );
    assert!(
        seen.iter().all(|p| p.total == 3),
        "every tick knows the size of the whole plan"
    );
    assert!(
        seen.iter().all(|p| p.repo_id == handle.id.0),
        "every tick names its repository — the event is app-global, the bar is not"
    );

    // Plan order, and the oid is the PRE-rebase one the plan named: the frontend
    // built the plan from those oids and has nothing else to match against.
    for (tick, oid) in seen.iter().zip(oids.iter()) {
        assert_eq!(tick.short_oid, oid[..7], "tick names the commit it replays");
        assert_eq!(tick.action, RebaseAction::Pick);
        assert!(
            !tick.subject.is_empty(),
            "the subject is what makes the status line readable, not the oid"
        );
    }
}

#[test]
fn a_dropped_step_still_ticks() {
    // A Drop never reaches a cherry-pick, but it IS one of `total`'s steps.
    // Skipping its tick would freeze the counter at N-1 of N for the rest of a
    // plan that is in fact progressing.
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Drop),
        step(&oids[2], RebaseAction::Pick),
    ];
    let ticks = Ticks::default();
    backend
        .rebase_start_with_progress(&handle.id, plan, &ticks.sink())
        .unwrap();

    let seen = ticks.taken();
    assert_eq!(
        seen.iter()
            .map(|p| (p.next_index, p.action))
            .collect::<Vec<_>>(),
        [
            (0, RebaseAction::Pick),
            (1, RebaseAction::Drop),
            (2, RebaseAction::Pick)
        ],
    );
}

#[test]
fn a_pause_stops_the_ticks_and_continue_resumes_them() {
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    // Edit on the second step: the replay applies step 1, announces step 2, and
    // parks there.
    let plan = vec![
        step(&oids[0], RebaseAction::Pick),
        step(&oids[1], RebaseAction::Edit),
        step(&oids[2], RebaseAction::Pick),
    ];
    let start = Ticks::default();
    let paused = backend
        .rebase_start_with_progress(&handle.id, plan, &start.sink())
        .unwrap();
    assert!(paused.in_progress, "an Edit step pauses the replay");

    let before = start.taken();
    assert_eq!(
        before.iter().map(|p| p.next_index).collect::<Vec<_>>(),
        [0, 1],
        "the third step is never announced, because it never started"
    );

    // Resuming picks the counter up where it stopped rather than restarting it —
    // the status line must not jump back to "step 1 of 3" halfway through.
    //
    // Only the third step is announced: an `Edit` pause happens AFTER its commit
    // is made and counted, so there is nothing to re-announce. (A conflict pause
    // parks its step in `conflict_step` instead and does re-announce it at the
    // same index on resume — which is also right: the counter holds rather than
    // going backwards.)
    let resume = Ticks::default();
    let done = backend
        .rebase_continue_with_progress(&handle.id, &resume.sink())
        .unwrap();
    assert!(!done.in_progress, "the rest of the plan runs to completion");
    assert_eq!(
        resume
            .taken()
            .iter()
            .map(|p| p.next_index)
            .collect::<Vec<_>>(),
        [2],
        "the resume continues the count instead of restarting it"
    );
}

#[test]
fn the_sinkless_entry_points_still_replay() {
    // Every existing caller — all the other rebase tests, and the conflict
    // resolver's internal `rebase_continue` — goes through the default methods.
    // They must stay a plain delegation, not a second engine.
    let tr = TempRepo::with_initial_commit("root\n");
    let oids = linear_history(&tr, 2);
    let (backend, handle) = tr.open_with_backend();

    let done = backend.rebase_start(&handle.id, pick_all(&oids)).unwrap();
    assert!(!done.in_progress);
    assert_eq!(done.total, 2);
}

#[test]
fn an_unknown_repository_reports_no_ticks() {
    // The sink must not be called on a failure path — a tick for a rebase that
    // never began would leave the status line lit with nothing behind it.
    let tr = TempRepo::with_initial_commit("root\n");
    let (backend, _handle) = tr.open_with_backend();

    let ticks = Ticks::default();
    let err = backend.rebase_continue_with_progress(
        &RepoId("nope".to_string()),
        &ticks.sink(),
    );
    assert!(err.is_err());
    assert!(ticks.taken().is_empty());
}
