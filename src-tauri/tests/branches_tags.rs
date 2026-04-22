mod support;

use platypusgit_lib::git::GitBackend;
use support::TempRepo;

#[test]
fn checkout_moves_head_to_existing_branch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Create a branch via libgit2 directly for the test fixture.
    let head_commit = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("feature", &head_commit, false).unwrap();

    backend
        .checkout_branch(&handle.id, "feature")
        .expect("checkout");

    let head = tr.repo.head().unwrap();
    assert_eq!(head.shorthand(), Some("feature"));
}

#[test]
fn create_branch_from_head_creates_new_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "feature", None).unwrap();

    let branches: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(branches.iter().any(|n| n == "feature"));
}

#[test]
fn create_branch_from_explicit_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    backend
        .create_branch(&handle.id, "pinned", Some(&head_oid))
        .unwrap();
    let branches: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(branches.iter().any(|n| n == "pinned"));
}
