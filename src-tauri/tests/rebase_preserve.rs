//! Topology-aware replay. A step may name the original commit it must be
//! applied onto; the engine resolves that through the rewritten map and resets
//! the detached HEAD there first. That is what lets a side branch be replayed
//! at its own branch point instead of being flattened onto the mainline.

mod support;

use platypusgit_lib::{
    error::AppError,
    git::{
        types::{RebaseAction, RebaseStep},
        GitBackend,
    },
};

use support::{merge_history, TempRepo};

fn pick(oid: &str) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Pick,
        message: None,
        onto: None,
        merge_parents: Vec::new(),
    }
}

fn pick_onto(oid: &str, onto: &str) -> RebaseStep {
    RebaseStep {
        onto: Some(onto.to_string()),
        ..pick(oid)
    }
}

#[test]
fn onto_replays_a_step_at_its_own_branch_point() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    // A, then F on top of A, then C back on top of A — a fork, no merge yet.
    // Without `onto`, C would land on top of F (the previous step's result).
    let status = backend
        .rebase_start(&handle.id, vec![pick(&h.a), pick(&h.f), pick_onto(&h.c, &h.a)])
        .unwrap();
    assert!(!status.in_progress);

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.summary().unwrap(), "C on main");
    assert_eq!(
        head.parent(0).unwrap().summary().unwrap(),
        "A on main",
        "C must sit on the rewritten A, not on F"
    );
    // F was replayed on a fork the final HEAD does not descend from, so its
    // file is not in the checked-out tree.
    assert!(
        !tr.path().join("f.txt").exists(),
        "F's fork is not checked out at HEAD"
    );
}

#[test]
fn onto_naming_an_unknown_commit_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let tip_before = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    let err = backend
        .rebase_start(
            &handle.id,
            vec![pick_onto(&h.a, "0000000000000000000000000000000000000000")],
        )
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
    assert_eq!(
        tr.repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string(),
        tip_before,
        "a rejected plan must not move anything"
    );
}
