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

// ─── recreating merges ───────────────────────────────────────────────────────

fn merge_step(oid: &str, onto: &str, parents: &[&str]) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Merge,
        message: None,
        onto: Some(onto.to_string()),
        merge_parents: parents.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn a_merge_is_recreated_from_its_rewritten_parents() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    // The topology-preserving plan for root..M:
    //   A, then F (on A), then C (back onto A), then M merging F into C.
    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                pick(&h.a),
                pick(&h.f),
                pick_onto(&h.c, &h.a),
                merge_step(&h.m, &h.c, &[&h.f]),
            ],
        )
        .unwrap();
    assert!(!status.in_progress, "a clean recreate should not pause");

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        head.parent_count(),
        2,
        "the merge must be recreated as a merge"
    );
    assert_eq!(head.summary().unwrap(), "Merge branch 'feature'");

    let first = head.parent(0).unwrap();
    let second = head.parent(1).unwrap();
    assert_eq!(first.summary().unwrap(), "C on main");
    assert_eq!(second.summary().unwrap(), "F on feature");

    // Both sides' content is present, and the worktree is clean.
    assert!(tr.path().join("f.txt").exists());
    assert!(tr.path().join("c.txt").exists());
    assert!(tr.repo.statuses(None).unwrap().is_empty());
}

#[test]
fn merge_on_a_non_merge_commit_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .rebase_start(&handle.id, vec![merge_step(&h.c, &h.a, &[&h.f])])
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
}

#[test]
fn merge_without_parents_is_rejected() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .rebase_start(&handle.id, vec![pick(&h.a), merge_step(&h.m, &h.c, &[])])
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRebasePlan(_)), "got {err:?}");
}

#[test]
fn an_octopus_merge_cannot_be_recreated() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);

    // A third parent and an octopus merge on top of M.
    let octopus = {
        let sig = git2::Signature::now("Test", "t@e.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let f = tr
            .repo
            .find_commit(git2::Oid::from_str(&h.f).unwrap())
            .unwrap();
        let a = tr
            .repo
            .find_commit(git2::Oid::from_str(&h.a).unwrap())
            .unwrap();
        let tree = head.tree().unwrap();
        tr.repo
            .commit(Some("HEAD"), &sig, &sig, "octopus", &tree, &[&head, &f, &a])
            .unwrap()
            .to_string()
    };

    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .rebase_start(
            &handle.id,
            vec![merge_step(&octopus, &h.m, &[&h.f, &h.a])],
        )
        .unwrap_err();
    match err {
        AppError::InvalidRebasePlan(msg) => {
            assert!(
                msg.contains("octopus"),
                "message should name the shape: {msg}"
            );
        }
        other => panic!("expected InvalidRebasePlan, got {other:?}"),
    }
}

#[test]
fn orig_head_survives_the_resets_a_preserving_replay_performs() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    // The fixture's own `git merge` wrote ORIG_HEAD (git does that), and the
    // replay resets HEAD several times to reach each step's base — each reset
    // writing its own ORIG_HEAD. The escape hatch documented for this engine
    // (`git reset --hard ORIG_HEAD`) is only true if ours wins.
    let (backend, handle) = tr.open_with_backend();

    backend
        .rebase_start(
            &handle.id,
            vec![
                pick(&h.a),
                pick(&h.f),
                pick_onto(&h.c, &h.a),
                merge_step(&h.m, &h.c, &[&h.f]),
            ],
        )
        .unwrap();

    let orig_head = std::fs::read_to_string(tr.path().join(".git").join("ORIG_HEAD"))
        .unwrap()
        .trim()
        .to_string();
    assert_eq!(
        orig_head, h.m,
        "ORIG_HEAD must name the pre-rebase tip, not a commit the replay reset through"
    );
}

// ─── conflicting recreate ────────────────────────────────────────────────────

/// Same shape as `merge_history`, but both sides edit `shared.txt`, so the
/// recreated merge conflicts. The original merge is resolved one way, which the
/// recreate must NOT reuse (neither does git).
fn conflicting_merge_history(tr: &TempRepo) -> (String, String, String, String) {
    use support::fs::write_file;

    write_file(tr.path(), "shared.txt", "base\n");
    let a = tr.commit_all("A on main").to_string();

    let a_commit = tr
        .repo
        .find_commit(git2::Oid::from_str(&a).unwrap())
        .unwrap();
    tr.repo.branch("feature", &a_commit, false).unwrap();
    tr.repo.set_head("refs/heads/feature").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write_file(tr.path(), "shared.txt", "feature\n");
    let f = tr.commit_all("F on feature").to_string();

    tr.repo.set_head("refs/heads/main").unwrap();
    tr.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    write_file(tr.path(), "shared.txt", "main\n");
    let c = tr.commit_all("C on main").to_string();

    let f_oid = git2::Oid::from_str(&f).unwrap();
    let m = {
        let annotated = tr.repo.find_annotated_commit(f_oid).unwrap();
        tr.repo.merge(&[&annotated], None, None).unwrap();
        write_file(tr.path(), "shared.txt", "original resolution\n");
        let mut index = tr.repo.index().unwrap();
        index
            .add_path(std::path::Path::new("shared.txt"))
            .unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = tr.repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test", "t@e.com").unwrap();
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let f_commit = tr.repo.find_commit(f_oid).unwrap();
        tr.repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "Merge branch 'feature'",
                &tree,
                &[&head, &f_commit],
            )
            .unwrap()
            .to_string()
    };
    tr.repo.cleanup_state().unwrap();
    (a, f, c, m)
}

#[test]
fn a_conflicting_recreated_merge_pauses_and_resumes() {
    use support::fs::write_file;

    let tr = TempRepo::with_initial_commit("root\n");
    let (a, f, c, m) = conflicting_merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                pick(&a),
                pick(&f),
                pick_onto(&c, &a),
                merge_step(&m, &c, &[&f]),
            ],
        )
        .unwrap();
    assert!(status.in_progress, "the recreated merge should conflict");
    assert_eq!(status.pause_reason.as_deref(), Some("conflict"));

    // The conflict is visible through the same API the Conflict screen and the
    // merge resolver window use.
    let sides = backend
        .conflict_sides(&handle.id, std::path::Path::new("shared.txt"))
        .unwrap();
    assert!(sides.ours.is_some(), "ours side missing: {sides:?}");
    assert!(sides.theirs.is_some(), "theirs side missing: {sides:?}");

    // Resolve and continue.
    write_file(tr.path(), "shared.txt", "resolved by hand\n");
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("shared.txt")])
        .unwrap();
    let done = backend.rebase_continue(&handle.id).unwrap();
    assert!(!done.in_progress, "continue should finish the plan");

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        head.parent_count(),
        2,
        "the resumed step must still be a merge"
    );
    assert_eq!(head.summary().unwrap(), "Merge branch 'feature'");
    assert_eq!(
        std::fs::read_to_string(tr.path().join("shared.txt")).unwrap(),
        "resolved by hand\n",
        "the user's resolution is what gets committed, not the original merge's"
    );
    assert!(
        !tr.repo.head_detached().unwrap(),
        "HEAD reattached on completion"
    );
}
