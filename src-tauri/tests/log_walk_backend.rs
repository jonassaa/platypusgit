//! The git-backed walk order, through the real backend (#483).
//!
//! `tests/log_walk_ordering.rs` pins the ORDERING against the `rev-list` CLI.
//! This file goes through `log_walk::rev_list_order` itself and then through
//! `log_page`, because the thing that ships is the function, not the command
//! line a document quotes.
//!
//! The fallback half lives in `tests/log_walk_fallback.rs`, which is a separate
//! binary on purpose: it sets a process-wide environment variable, and Rust
//! runs the tests within one binary on parallel threads.

mod support;

use git2::{Oid, Repository, Signature, Sort, Time};
use platypusgit_lib::git::log_walk;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// Same interleaved fixture as `log_walk_ordering.rs`: two lines of history
/// whose dates alternate, then a merge. A linear history cannot tell a correct
/// order from a lucky one.
fn interleaved_merge_history(tr: &TempRepo) {
    let repo = &tr.repo;
    let commit = |name: &str, when: i64, parents: &[Oid]| -> Oid {
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
    };

    let base = repo.head().unwrap().peel_to_commit().unwrap().id();
    let m1 = commit("m1", 1_000, &[base]);
    let f1 = commit("f1", 2_000, &[base]);
    let m2 = commit("m2", 3_000, &[m1]);
    let f2 = commit("f2", 4_000, &[f1]);
    let merge = commit("merge", 5_000, &[m2, f2]);
    repo.reference("refs/heads/main", merge, true, "test fixture")
        .unwrap();
}

fn libgit2_order(repo: &Repository, start: Oid) -> Vec<Oid> {
    let mut walk = repo.revwalk().unwrap();
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL).unwrap();
    walk.push(start).unwrap();
    walk.map(|o| o.unwrap()).collect()
}

#[test]
fn rev_list_order_matches_the_libgit2_walk() {
    let tr = TempRepo::with_initial_commit("root\n");
    interleaved_merge_history(&tr);
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id();

    let from_git = log_walk::rev_list_order(tr.path(), &[head], 1000).expect("git produced an order");
    assert_eq!(from_git, libgit2_order(&tr.repo, head));
}

#[test]
fn respects_the_cap() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 20);
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id();

    let capped = log_walk::rev_list_order(tr.path(), &[head], 5).expect("order");
    assert_eq!(capped.len(), 5);
    assert_eq!(capped, libgit2_order(&tr.repo, head)[..5].to_vec());
}

#[test]
fn a_page_through_the_backend_is_in_that_order() {
    let tr = TempRepo::with_initial_commit("root\n");
    interleaved_merge_history(&tr);
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    let (backend, handle) = tr.open_with_backend();

    let page = backend.log_page(&handle.id, None, None, 10).expect("page");
    let got: Vec<String> = page.commits.iter().map(|c| c.oid.clone()).collect();
    let want: Vec<String> = libgit2_order(&tr.repo, head)
        .iter()
        .map(|o| o.to_string())
        .collect();
    assert_eq!(got, want);
}

#[test]
fn an_empty_repository_still_pages() {
    // No commits at all: `rev-list` would exit non-zero on a bad revision, so
    // this is the path where returning `None` and falling back has to work.
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();
    let page = backend.log_page(&handle.id, None, None, 10).expect("page");
    assert!(page.commits.is_empty());
    assert!(page.next_cursor.is_none());
}
