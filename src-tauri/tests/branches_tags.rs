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

#[test]
fn checkout_is_ok_with_untracked_files_that_dont_conflict() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_commit = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("feature", &head_commit, false).unwrap();

    // A completely untracked file unrelated to anything on either branch.
    support::fs::write_file(tr.path(), "scratch.txt", "junk\n");

    backend
        .checkout_branch(&handle.id, "feature")
        .expect("untracked file should not block checkout");
}

#[test]
fn checkout_refuses_with_modified_tracked_file() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head_commit = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("feature", &head_commit, false).unwrap();

    support::fs::write_file(tr.path(), "README.md", "modified\n");

    let err = backend
        .checkout_branch(&handle.id, "feature")
        .unwrap_err();
    assert!(matches!(err, platypusgit_lib::error::AppError::DirtyWorktree(_)));
}

#[test]
fn delete_unmerged_branch_is_refused_without_force() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Create a branch, check it out, commit a change on it, go back to main.
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature").unwrap();
    support::fs::write_file(tr.path(), "NOTES.md", "notes\n");
    backend.stage(&handle.id, &[std::path::PathBuf::from("NOTES.md")]).unwrap();
    backend
        .commit(
            &handle.id,
            platypusgit_lib::git::types::CommitOptions {
                message: "feature work".into(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: None,
            },
        )
        .unwrap();
    backend.checkout_branch(&handle.id, "main").unwrap();

    let err = backend.delete_branch(&handle.id, "feature", false).unwrap_err();
    assert!(matches!(err, platypusgit_lib::error::AppError::NotMerged(_)));

    // Force delete should succeed.
    backend.delete_branch(&handle.id, "feature", true).unwrap();
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

#[test]
fn create_tag_from_abbreviated_sha() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let full_oid = tr.repo.head().unwrap().target().unwrap().to_string();
    let short_oid = full_oid[..7].to_string();

    backend
        .create_tag(
            &handle.id,
            "v0.1.0-short",
            TagTarget { oid: short_oid, annotation: None },
        )
        .expect("should resolve abbreviated sha");

    let names: Vec<_> = backend
        .tags(&handle.id)
        .unwrap()
        .into_iter()
        .map(|t| t.name)
        .collect();
    assert!(names.iter().any(|n| n == "v0.1.0-short"));
}

/// Create a second repo as `origin`, fetch it, so remote-tracking refs exist.
fn with_origin() -> (TempRepo, TempRepo) {
    let upstream = TempRepo::with_initial_commit("hello\n");
    let local = TempRepo::with_initial_commit("hello\n");
    local
        .repo
        .remote("origin", upstream.path().to_str().unwrap())
        .unwrap();
    // Scoped: the Remote borrows local.repo, and its Drop must run before
    // `local` is moved into the return value.
    {
        let mut remote = local.repo.find_remote("origin").unwrap();
        remote
            .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
            .unwrap();
    }
    (local, upstream)
}

#[test]
fn set_upstream_sets_tracking_branch() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    backend
        .set_upstream(&handle.id, "main", Some("origin/main"))
        .expect("set upstream");

    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .expect("main branch");
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
}

#[test]
fn set_upstream_none_clears_tracking() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();
    backend
        .set_upstream(&handle.id, "main", Some("origin/main"))
        .unwrap();

    backend
        .set_upstream(&handle.id, "main", None)
        .expect("clear upstream");

    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .unwrap();
    assert!(main.upstream.is_none(), "tracking should be cleared");
}

#[test]
fn set_upstream_unknown_remote_branch_is_invalid_ref() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .set_upstream(&handle.id, "main", Some("origin/nope"))
        .expect_err("should reject unknown remote branch");

    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "expected InvalidRef, got {err:?}"
    );
}

#[test]
fn set_upstream_unknown_local_branch_is_invalid_ref() {
    let (tr, _up) = with_origin();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .set_upstream(&handle.id, "nope", Some("origin/main"))
        .expect_err("should reject unknown local branch");

    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "expected InvalidRef, got {err:?}"
    );
}

/// `tip` is the FULL oid. It used to be truncated to 7 chars, which made every
/// frontend comparison against `CommitInfo.oid` fail silently — History's HEAD
/// marker never drew, and the HEAD-ancestry filter that rebase plans are built
/// from degraded to "the whole log", sweeping other branches into a squash.
#[test]
fn branch_tip_is_the_full_oid() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let head_oid = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    let (backend, handle) = tr.open_with_backend();

    let branches = backend.branches(&handle.id).unwrap();
    let head = branches
        .iter()
        .find(|b| b.is_head)
        .expect("no branch reported as HEAD");

    assert_eq!(head.tip.as_deref(), Some(head_oid.as_str()));
    assert_eq!(head_oid.len(), 40, "fixture sanity: oids are 40 chars");
}
