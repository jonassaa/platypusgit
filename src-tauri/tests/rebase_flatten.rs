//! Flattening a range that contains a merge: either the merge is dropped (git's
//! default — its side-branch commits are replayed individually) or it is kept
//! as one ordinary commit carrying its diff against its first parent.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
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

#[test]
fn dropping_the_merge_flattens_the_branch() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.f, RebaseAction::Pick),
                step(&h.c, RebaseAction::Pick),
                step(&h.m, RebaseAction::Drop),
            ],
        )
        .unwrap();
    assert!(!status.in_progress);

    let log = backend.log(&handle.id, None, 20).unwrap();
    let summaries: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["C on main", "F on feature", "A on main", "initial"],
        "the branch should be linear, oldest last"
    );
    assert!(
        log.iter().all(|c| c.parents.len() <= 1),
        "no merge commit may survive a flattening rebase"
    );
    // The side branch's content is replayed, not lost.
    assert!(tr.path().join("f.txt").exists(), "F's file must survive");
    assert!(tr.path().join("c.txt").exists(), "C's file must survive");
}

#[test]
fn mainline_pick_keeps_the_merge_as_one_commit() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let merge_tree = tr
        .repo
        .find_commit(git2::Oid::from_str(&h.m).unwrap())
        .unwrap()
        .tree_id();
    let (backend, handle) = tr.open_with_backend();

    // The side branch is NOT replayed on its own; the merge carries its content
    // in as a single commit (the "I merged a topic in, keep that as one step"
    // case).
    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.c, RebaseAction::Pick),
                step(&h.m, RebaseAction::MainlinePick),
            ],
        )
        .unwrap();
    assert!(
        !status.in_progress,
        "a clean mainline pick should not pause"
    );

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        head.parent_count(),
        1,
        "the result must be an ordinary commit"
    );
    assert_eq!(
        head.summary().unwrap(),
        "Merge branch 'feature'",
        "the merge's message is kept"
    );
    assert_eq!(
        head.tree_id(),
        merge_tree,
        "the tree must match the original merge's tree"
    );
}

#[test]
fn mainline_pick_on_a_non_merge_behaves_like_pick() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();

    let status = backend
        .rebase_start(
            &handle.id,
            vec![
                step(&h.a, RebaseAction::Pick),
                step(&h.c, RebaseAction::MainlinePick),
                step(&h.m, RebaseAction::Drop),
            ],
        )
        .unwrap();
    assert!(!status.in_progress);
    assert_eq!(
        backend.log(&handle.id, None, 5).unwrap()[0].summary,
        "C on main"
    );
}
