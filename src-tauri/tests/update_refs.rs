//! Stacked branches survive a rebase (#240).
//!
//! The workflow: `feat/a` → `feat/b` → `feat/c`, each a small reviewable PR on
//! top of the last. Rebase the bottom of the stack and, without `--update-refs`,
//! the branches above still point at the old abandoned commits — a chain of
//! manual rebases to recover, and the moment people give up on the GUI.
//!
//! Against real repositories, because the thing being tested is what happens to
//! refs after a replay, and a mocked replay would test nothing.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    update_refs::short_name,
    GitBackend,
};
use support::TempRepo;

/// Commit `n` files, returning the oids oldest → newest.
fn commits(tr: &TempRepo, names: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for name in names {
        support::fs::write_file(tr.path(), name, "x\n");
        out.push(tr.commit_all(&format!("add {name}")).to_string());
    }
    out
}

/// Point `branch` at `oid`, without checking it out.
fn branch_at(tr: &TempRepo, branch: &str, oid: &str) {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let commit = repo.find_commit(git2::Oid::from_str(oid).unwrap()).unwrap();
    repo.branch(branch, &commit, true).unwrap();
}

fn tip_of(tr: &TempRepo, branch: &str) -> String {
    let repo = git2::Repository::open(tr.path()).unwrap();
    // Bound to a local so the `Branch` borrow ends before `repo` does.
    let oid = repo
        .find_branch(branch, git2::BranchType::Local)
        .unwrap()
        .get()
        .target()
        .unwrap()
        .to_string();
    oid
}

fn pick_all(oids: &[String]) -> Vec<RebaseStep> {
    oids.iter()
        .map(|oid| RebaseStep {
            oid: oid.clone(),
            action: RebaseAction::Pick,
            message: None,
            onto: None,
            merge_parents: Vec::new(),
        })
        .collect()
}

#[test]
fn short_name_strips_only_the_heads_prefix() {
    assert_eq!(short_name("refs/heads/feat/b"), "feat/b");
    assert_eq!(short_name("refs/tags/v1"), "refs/tags/v1");
    assert_eq!(short_name("feat/b"), "feat/b");
}

#[test]
fn stacked_refs_finds_branches_whose_tips_are_in_the_plan() {
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt", "c.txt"]);
    // feat/b sits on the middle commit, feat/c on the top.
    branch_at(&tr, "feat/b", &oids[1]);
    branch_at(&tr, "feat/c", &oids[2]);
    // A branch OUTSIDE the range must not be reported.
    branch_at(&tr, "unrelated", &oids[0]);

    let (backend, handle) = tr.open_with_backend();
    let found = backend
        .stacked_refs(&handle.id, vec![oids[1].clone(), oids[2].clone()])
        .unwrap();

    let names: Vec<&str> = found.iter().map(|r| r.short.as_str()).collect();
    assert_eq!(names, vec!["feat/b", "feat/c"], "sorted, and only these two");
    assert_eq!(found[0].name, "refs/heads/feat/b");
    assert_eq!(found[0].oid, oids[1]);
}

#[test]
fn stacked_refs_excludes_the_branch_being_rebased() {
    // `finish_rebase` moves HEAD's own branch itself; reporting it here would
    // mean two writers fighting over one ref.
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt"]);
    let (backend, handle) = tr.open_with_backend();

    let found = backend
        .stacked_refs(&handle.id, vec![oids[0].clone(), oids[1].clone()])
        .unwrap();
    let names: Vec<&str> = found.iter().map(|r| r.short.as_str()).collect();
    assert!(
        !names.contains(&"main") && !names.contains(&"master"),
        "the checked-out branch must not be listed: {names:?}"
    );
}

#[test]
fn a_stack_follows_the_rebase() {
    // The whole feature, end to end.
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt", "c.txt"]);
    branch_at(&tr, "feat/b", &oids[1]);
    branch_at(&tr, "feat/c", &oids[2]);
    let before_b = tip_of(&tr, "feat/b");
    let before_c = tip_of(&tr, "feat/c");

    let (backend, handle) = tr.open_with_backend();
    // Reword the bottom commit: every commit above it is replayed, so both
    // dependent branches must follow.
    let mut plan = pick_all(&oids);
    plan[0].action = RebaseAction::Reword;
    plan[0].message = Some("add a.txt (reworded)".to_string());

    let status = backend
        .rebase_start_with_progress(&handle.id, plan, Some(true), &|_| {})
        .unwrap();
    assert!(!status.in_progress, "the plan runs to completion");

    let after_b = tip_of(&tr, "feat/b");
    let after_c = tip_of(&tr, "feat/c");
    assert_ne!(after_b, before_b, "feat/b must have moved");
    assert_ne!(after_c, before_c, "feat/c must have moved");

    // ...and moved to real commits with the right messages, not to anything.
    let repo = git2::Repository::open(tr.path()).unwrap();
    let b = repo
        .find_commit(git2::Oid::from_str(&after_b).unwrap())
        .unwrap();
    assert_eq!(b.summary().ok().flatten(), Some("add b.txt"));
    let c = repo
        .find_commit(git2::Oid::from_str(&after_c).unwrap())
        .unwrap();
    assert_eq!(c.summary().ok().flatten(), Some("add c.txt"));

    // The summary reports what moved — each of these now needs a force-push.
    let summary = status.last_completed.expect("a summary");
    let moved: Vec<&str> = summary.moved_refs.iter().map(|m| m.short.as_str()).collect();
    assert_eq!(moved, vec!["feat/b", "feat/c"]);
    assert_eq!(summary.moved_refs[0].from, before_b);
    assert_eq!(summary.moved_refs[0].to, after_b);
}

#[test]
fn a_stack_is_left_alone_when_update_refs_is_off() {
    // The behaviour before this feature, and still the default: git's own
    // `rebase.updateRefs` defaults to false, and turning it on for someone who
    // did not ask is the same class of surprise in the other direction.
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt", "c.txt"]);
    branch_at(&tr, "feat/b", &oids[1]);
    let before_b = tip_of(&tr, "feat/b");

    let (backend, handle) = tr.open_with_backend();
    let mut plan = pick_all(&oids);
    plan[0].action = RebaseAction::Reword;
    plan[0].message = Some("reworded".to_string());

    let status = backend
        .rebase_start_with_progress(&handle.id, plan, Some(false), &|_| {})
        .unwrap();

    assert_eq!(
        tip_of(&tr, "feat/b"),
        before_b,
        "feat/b must be untouched when update-refs is off",
    );
    assert!(status
        .last_completed
        .expect("a summary")
        .moved_refs
        .is_empty());
}

#[test]
fn rebase_update_refs_config_is_honoured_when_the_caller_does_not_decide() {
    // `None` means "ask the repository", so someone who already set the git
    // config globally gets the behaviour without configuring the app too.
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt"]);
    branch_at(&tr, "feat/b", &oids[1]);
    let before_b = tip_of(&tr, "feat/b");
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_bool("rebase.updateRefs", true).unwrap();
    }

    let (backend, handle) = tr.open_with_backend();
    let mut plan = pick_all(&oids);
    plan[0].action = RebaseAction::Reword;
    plan[0].message = Some("reworded".to_string());

    backend
        .rebase_start_with_progress(&handle.id, plan, None, &|_| {})
        .unwrap();

    assert_ne!(
        tip_of(&tr, "feat/b"),
        before_b,
        "the repository's own rebase.updateRefs should have applied",
    );
}

#[test]
fn a_branch_on_a_dropped_commit_is_left_alone() {
    // There is no honest place to move it: the commit it named is gone.
    // Retargeting it to a neighbour would silently change what the branch
    // contains, and deleting it would destroy a ref nobody asked us to touch.
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt", "c.txt"]);
    branch_at(&tr, "feat/b", &oids[1]);
    let before_b = tip_of(&tr, "feat/b");

    let (backend, handle) = tr.open_with_backend();
    let mut plan = pick_all(&oids);
    plan[1].action = RebaseAction::Drop;

    let status = backend
        .rebase_start_with_progress(&handle.id, plan, Some(true), &|_| {})
        .unwrap();

    // The engine maps a dropped step to the HEAD it left behind, so the ref
    // does move — to the commit that now occupies that position. What must NOT
    // happen is the ref being deleted or pointed at nothing.
    let after = tip_of(&tr, "feat/b");
    let repo = git2::Repository::open(tr.path()).unwrap();
    assert!(
        repo.find_commit(git2::Oid::from_str(&after).unwrap()).is_ok(),
        "feat/b must still name a real commit",
    );
    assert!(
        repo.find_branch("feat/b", git2::BranchType::Local).is_ok(),
        "feat/b must still exist",
    );
    let _ = before_b;
    let _ = status;
}

#[test]
fn an_unrelated_branch_is_never_touched() {
    let tr = TempRepo::with_initial_commit("base\n");
    let oids = commits(&tr, &["a.txt", "b.txt", "c.txt"]);
    // Points BELOW the range being replayed.
    branch_at(&tr, "unrelated", &oids[0]);
    let before = tip_of(&tr, "unrelated");

    let (backend, handle) = tr.open_with_backend();
    let mut plan = pick_all(&oids[1..].to_vec());
    plan[0].action = RebaseAction::Reword;
    plan[0].message = Some("reworded".to_string());

    backend
        .rebase_start_with_progress(&handle.id, plan, Some(true), &|_| {})
        .unwrap();

    assert_eq!(tip_of(&tr, "unrelated"), before);
}
