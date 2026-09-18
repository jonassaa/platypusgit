//! The ordering contract behind the git-backed log walk (#483).
//!
//! `build_walk_order` sorts with `Sort::TIME | Sort::TOPOLOGICAL`, which is
//! Kahn's algorithm over a time-priority queue — git's `--date-order`, and NOT
//! its `--topo-order`. The distinction is not cosmetic: measured on
//! `torvalds/linux`, the two share only 1,627 of the first 2,000 oids, so
//! taking the order from the wrong one silently changes WHICH COMMITS the
//! first page contains. Both #473 and #476 proposed `--topo-order`.
//!
//! This is the file that makes "`--date-order` is the drop-in" something the
//! build checks rather than something a spec claims.
//!
//! **Plant a violation before trusting an edit here.** Change `--date-order`
//! to `--topo-order` in `date_order_reproduces_libgit2_time_topological` and
//! it must go red. A fixture on which the two orderings agree would make this
//! file pass against the exact mistake it exists to catch, which is why
//! `diverges_from_topo_order` asserts the fixture is sharp.

mod support;

use git2::{Oid, Repository, Signature, Sort, Time};
use support::{git_in, TempRepo};

/// One commit with an explicit timestamp and explicit parents, touching no ref
/// and no working tree.
fn commit_on(repo: &Repository, name: &str, when: i64, parents: &[Oid]) -> Oid {
    let blob = repo.blob(format!("{name}\n").as_bytes()).unwrap();
    let base_tree = parents
        .first()
        .map(|p| repo.find_commit(*p).unwrap().tree().unwrap());
    let mut tb = repo.treebuilder(base_tree.as_ref()).unwrap();
    tb.insert(name, blob, 0o100644).unwrap();
    let tree = repo.find_tree(tb.write().unwrap()).unwrap();

    let sig = Signature::new("Test", "test@example.com", &Time::new(when, 0)).unwrap();
    let parent_commits: Vec<_> = parents
        .iter()
        .map(|p| repo.find_commit(*p).unwrap())
        .collect();
    let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
    repo.commit(None, &sig, &sig, name, &tree, &parent_refs)
        .unwrap()
}

/// Two lines of development whose commit dates INTERLEAVE, then a merge.
///
/// The interleaving is the whole point. `--date-order` walks strictly by
/// timestamp within the parents-after-children constraint, so it alternates
/// between the two lines; `--topo-order` refuses to intermix them. A fixture
/// whose branches do not interleave produces the same sequence either way and
/// proves nothing.
fn interleaved_merge_history(tr: &TempRepo) -> Oid {
    let repo = &tr.repo;
    let base = repo.head().unwrap().peel_to_commit().unwrap().id();

    let m1 = commit_on(repo, "m1", 1_000, &[base]);
    let f1 = commit_on(repo, "f1", 2_000, &[base]);
    let m2 = commit_on(repo, "m2", 3_000, &[m1]);
    let f2 = commit_on(repo, "f2", 4_000, &[f1]);
    let merge = commit_on(repo, "merge", 5_000, &[m2, f2]);

    repo.reference("refs/heads/main", merge, true, "test fixture")
        .unwrap();
    merge
}

fn libgit2_time_topological(tr: &TempRepo) -> Vec<String> {
    let mut walk = tr.repo.revwalk().unwrap();
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL).unwrap();
    walk.push_head().unwrap();
    walk.map(|o| o.unwrap().to_string()).collect()
}

fn rev_list(tr: &TempRepo, ordering: &str) -> Vec<String> {
    git_in(tr.path(), &["rev-list", ordering, "HEAD"])
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn date_order_reproduces_libgit2_time_topological() {
    let tr = TempRepo::with_initial_commit("root\n");
    interleaved_merge_history(&tr);
    assert_eq!(
        libgit2_time_topological(&tr),
        rev_list(&tr, "--date-order"),
        "the git-backed walk must reproduce libgit2's order exactly",
    );
}

#[test]
fn diverges_from_topo_order() {
    // Without this, the test above would pass against `--topo-order` too and
    // would be worthless as a guard.
    let tr = TempRepo::with_initial_commit("root\n");
    interleaved_merge_history(&tr);
    assert_ne!(
        rev_list(&tr, "--date-order"),
        rev_list(&tr, "--topo-order"),
        "fixture does not exercise the distinction this file exists to pin",
    );
}

#[test]
fn libgit2_topological_alone_is_the_other_ordering() {
    // The mirror image, so the mapping is pinned in both directions: dropping
    // Sort::TIME is what `--topo-order` corresponds to.
    let tr = TempRepo::with_initial_commit("root\n");
    interleaved_merge_history(&tr);

    let mut walk = tr.repo.revwalk().unwrap();
    walk.set_sorting(Sort::TOPOLOGICAL).unwrap();
    walk.push_head().unwrap();
    let topo: Vec<String> = walk.map(|o| o.unwrap().to_string()).collect();

    assert_eq!(topo, rev_list(&tr, "--topo-order"));
}
