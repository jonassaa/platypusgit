//! `git rebase -i <newbase>` — replaying a branch onto a base it does NOT
//! descend from (186).
//!
//! The engine already supports this: `rebase_start` takes the run's base from
//! the first non-Drop step's `onto`, and `rebase_plan::validate` accepts any
//! existing commit there with no ancestry requirement. These tests pin that,
//! because nothing else exercises an `onto` below the range — and pin the range
//! primitive split too: `commits_between` answers for a diverged pair,
//! `commits_since` refuses, and that refusal is deliberate.
//!
//! **`onto` reaches the run through TWO mechanisms, and either one alone is
//! enough for the first step.** Measured by mutation while writing this file:
//! disabling `rebase_start`'s `first_step.onto` detach leaves the tests green,
//! because `advance_rebase` also calls `move_to_base` for any step that names an
//! `onto`; disabling that instead is likewise green, because the initial detach
//! already placed it. Only killing both turns the log into
//! `E, D, A, initial` — main replayed on its own root with the new base
//! nowhere in it. So a reader chasing "where does the base get used" must find
//! both sites, and a test that only breaks one has proved nothing.

mod support;

use platypusgit_lib::git::{
    types::{RebaseAction, RebaseStep},
    GitBackend,
};

use support::{git_in, TempRepo};

/// ```text
/// root ── A ── D ── E   (main, HEAD)
///     \
///      ─ B ── C         (other)
/// ```
/// Every commit touches its own file, so nothing conflicts.
struct Diverged {
    root: String,
    other_tip: String,
    main_tip: String,
}

fn diverged(tr: &TempRepo) -> Diverged {
    // Built with the real CLI, not `TempRepo::add_commit`: that helper commits
    // through the fixture's OWN cached `git2::Index`, which a `git checkout` run
    // beside it does not invalidate — so the branch swap left it holding the other
    // branch's entries and the next commit's tree carried files the worktree did
    // not have. `rebase_start` then refused the whole thing as DirtyWorktree.
    let commit = |name: &str, body: &str, msg: &str| -> String {
        support::fs::write_file(tr.path(), name, body);
        git_in(tr.path(), &["add", "--", name]);
        git_in(tr.path(), &["commit", "-m", msg]);
        git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string()
    };

    let root = git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string();

    git_in(tr.path(), &["checkout", "-b", "other"]);
    commit("b.txt", "b\n", "B on other");
    let other_tip = commit("c.txt", "c\n", "C on other");

    git_in(tr.path(), &["checkout", "main"]);
    commit("a.txt", "a\n", "A on main");
    commit("d.txt", "d\n", "D on main");
    let main_tip = commit("e.txt", "e\n", "E on main");

    assert_eq!(
        git_in(tr.path(), &["status", "--porcelain"]).trim(),
        "",
        "the fixture must leave a clean worktree — rebase_start refuses a dirty one"
    );

    Diverged {
        root,
        other_tip,
        main_tip,
    }
}

fn step(oid: &str, onto: Option<&str>) -> RebaseStep {
    RebaseStep {
        oid: oid.to_string(),
        action: RebaseAction::Pick,
        message: None,
        onto: onto.map(|s| s.to_string()),
        merge_parents: Vec::new(),
    }
}

#[test]
fn commits_between_is_the_range_and_commits_since_refuses_it() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let range = backend
        .commits_between(&handle.id, &h.other_tip, "HEAD", 100)
        .unwrap();
    let summaries: Vec<&str> = range.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["E on main", "D on main", "A on main"],
        "base..HEAD is HEAD's commits not reachable from the new base"
    );

    // The invariant that stays: a rebase base for the ON-BRANCH flow must be an
    // ancestor. Loosening this is explicitly out of scope.
    assert!(
        backend.commits_since(&handle.id, &h.other_tip).is_err(),
        "commits_since must keep refusing a non-ancestor base"
    );
}

#[test]
fn replays_the_branch_onto_a_diverged_base() {
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let range = backend
        .commits_between(&handle.id, &h.other_tip, "HEAD", 100)
        .unwrap();
    // Oldest-first, with the new base named on the first step — the plan shape
    // the Rebase screen submits.
    let mut plan: Vec<RebaseStep> = range.iter().rev().map(|c| step(&c.oid, None)).collect();
    plan[0].onto = Some(h.other_tip.clone());

    let status = backend.rebase_start(&handle.id, plan).unwrap();
    assert!(!status.in_progress, "a clean replay finishes in one call");

    let log = git_in(tr.path(), &["log", "--format=%s"]);
    assert_eq!(
        log.trim().split('\n').collect::<Vec<_>>(),
        vec![
            "E on main",
            "D on main",
            "A on main",
            "C on other",
            "B on other",
            "initial"
        ],
        "main must sit on top of other's tip"
    );

    // The branch ref moved, exactly once, and HEAD is attached to it again.
    assert_eq!(
        git_in(tr.path(), &["symbolic-ref", "HEAD"]).trim(),
        "refs/heads/main"
    );
    assert_eq!(
        git_in(tr.path(), &["rev-parse", "ORIG_HEAD"]).trim(),
        h.main_tip,
        "ORIG_HEAD is the pre-rebase tip — `git reset --hard ORIG_HEAD` undoes this"
    );
    assert_eq!(git_in(tr.path(), &["status", "--porcelain"]).trim(), "");
    // Both sides' content survives.
    for f in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"] {
        assert!(tr.path().join(f).exists(), "{f} must exist after the replay");
    }
    // `other` itself is untouched.
    assert_eq!(
        git_in(tr.path(), &["rev-parse", "other"]).trim(),
        h.other_tip
    );
    assert_ne!(h.root, h.other_tip);
}

#[test]
fn a_short_prefix_and_a_branch_name_both_work_as_the_new_base() {
    // The base picker's free-form hash row and the branch menus hand over a
    // PREFIX and a NAME, not a full oid — and after this feature that is the
    // common path, because a diverged base is usually outside the loaded log.
    // Both `ahead_behind` and `rebase_start` revparse whatever they are given.
    let tr = TempRepo::with_initial_commit("root\n");
    let h = diverged(&tr);
    let (backend, handle) = tr.open_with_backend();

    let by_oid = backend
        .ahead_behind(&handle.id, &h.other_tip, "HEAD")
        .unwrap();
    let by_prefix = backend
        .ahead_behind(&handle.id, &h.other_tip[..7], "HEAD")
        .unwrap();
    let by_name = backend.ahead_behind(&handle.id, "other", "HEAD").unwrap();
    assert_eq!(by_oid.ahead, 3, "three commits on main are not on other");
    assert_eq!(by_oid.behind, 2, "two commits on other are not on main");
    assert_eq!(by_oid.merge_base, Some(h.root.clone()));
    assert_eq!(by_prefix.ahead, by_oid.ahead);
    assert_eq!(by_prefix.behind, by_oid.behind);
    assert_eq!(by_name.ahead, by_oid.ahead);
    assert_eq!(by_name.behind, by_oid.behind);

    let range = backend
        .commits_between(&handle.id, &h.other_tip[..7], "HEAD", 100)
        .unwrap();
    assert_eq!(range.len(), 3);

    let mut plan: Vec<RebaseStep> = range.iter().rev().map(|c| step(&c.oid, None)).collect();
    plan[0].onto = Some(h.other_tip[..7].to_string());
    backend.rebase_start(&handle.id, plan).unwrap();

    assert_eq!(
        git_in(tr.path(), &["rev-parse", "HEAD~3"]).trim(),
        h.other_tip,
        "a 7-char prefix must land on the same base as the full oid"
    );
}
