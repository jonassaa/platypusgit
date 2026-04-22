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

#[test]
fn delete_branch_removes_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "scratch", None).unwrap();

    backend.delete_branch(&handle.id, "scratch", false).unwrap();

    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(!names.iter().any(|n| n == "scratch"));
}

#[test]
fn delete_current_branch_is_refused() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .delete_branch(&handle.id, "main", false)
        .unwrap_err();
    assert!(matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)));
}

#[test]
fn rename_branch_moves_the_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "old", None).unwrap();

    backend.rename_branch(&handle.id, "old", "new").unwrap();

    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(names.iter().any(|n| n == "new"));
    assert!(!names.iter().any(|n| n == "old"));
}

use platypusgit_lib::git::types::TagTarget;

#[test]
fn create_lightweight_tag() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();

    backend
        .create_tag(
            &handle.id,
            "v0.1.0",
            TagTarget {
                oid: head_oid,
                annotation: None,
            },
        )
        .unwrap();

    let names: Vec<_> = backend
        .tags(&handle.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(names.iter().any(|n| n == "v0.1.0"));
}

#[test]
fn delete_tag_removes_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    backend
        .create_tag(
            &handle.id,
            "v0.1.0",
            TagTarget {
                oid: head_oid,
                annotation: None,
            },
        )
        .unwrap();

    backend.delete_tag(&handle.id, "v0.1.0").unwrap();
    let names: Vec<_> = backend.tags(&handle.id).unwrap().into_iter().map(|t| t.name).collect();
    assert!(!names.iter().any(|n| n == "v0.1.0"));
}
