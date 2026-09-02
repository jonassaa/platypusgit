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
        .checkout_branch(&handle.id, "feature", false)
        .expect("checkout");

    let head = tr.repo.head().unwrap();
    assert_eq!(head.shorthand().ok(), Some("feature"));
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
fn create_branch_rejects_an_invalid_name_before_touching_the_repo() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .create_branch(&handle.id, "foo bar", None)
        .unwrap_err();
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "got {err:?}"
    );

    // Rejected before any ref was written.
    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(!names.iter().any(|n| n.contains("foo")));
}

#[test]
fn rename_branch_rejects_an_invalid_target_name() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "old", None).unwrap();

    let err = backend
        .rename_branch(&handle.id, "old", "-bad")
        .unwrap_err();
    assert!(
        matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
        "got {err:?}"
    );

    // The original branch is untouched.
    let names: Vec<_> = backend
        .branches(&handle.id)
        .unwrap()
        .into_iter()
        .map(|b| b.name)
        .collect();
    assert!(names.iter().any(|n| n == "old"));
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
        .checkout_branch(&handle.id, "feature", false)
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
        .checkout_branch(&handle.id, "feature", false)
        .unwrap_err();
    assert!(matches!(err, platypusgit_lib::error::AppError::DirtyWorktree(_)));
}

#[test]
fn delete_unmerged_branch_is_refused_without_force() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    // Create a branch, check it out, commit a change on it, go back to main.
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature", false).unwrap();
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
                no_verify: false,
            },
        )
        .unwrap();
    backend.checkout_branch(&handle.id, "main", false).unwrap();

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
                sign: None,
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
                sign: None,
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
            TagTarget { oid: short_oid, annotation: None, sign: None },
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

// ---------------------------------------------------------------------------
// Ordering data: `tip_time` + `is_default` (#135)
//
// The frontend sorts branch lists default-first then newest-tip-first, so both
// fields are the only inputs to that ordering — they cannot be derived from
// anything else `BranchInfo` carries.
// ---------------------------------------------------------------------------

/// `origin` with the given extra branches fetched, plus a symbolic
/// `refs/remotes/origin/HEAD` pointing at `head` — what `git clone` and
/// `git remote set-head` leave behind, which libgit2's own fetch does not.
fn with_origin_head(extra: &[&str], head: &str) -> (TempRepo, TempRepo) {
    let upstream = TempRepo::with_initial_commit("hello\n");
    {
        let tip = upstream.repo.head().unwrap().peel_to_commit().unwrap();
        for name in extra {
            upstream.repo.branch(name, &tip, false).unwrap();
        }
    }
    let local = TempRepo::with_initial_commit("hello\n");
    local
        .repo
        .remote("origin", upstream.path().to_str().unwrap())
        .unwrap();
    {
        let mut remote = local.repo.find_remote("origin").unwrap();
        remote
            .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
            .unwrap();
    }
    local
        .repo
        .reference_symbolic(
            "refs/remotes/origin/HEAD",
            &format!("refs/remotes/origin/{head}"),
            true,
            "test fixture",
        )
        .unwrap();
    (local, upstream)
}

/// Move HEAD onto `keep` and delete `main`, so the `main`/`master`/`trunk`
/// fallback has to look past its first candidate.
fn without_main(tr: &TempRepo, keep: &str) {
    let (backend, handle) = tr.open_with_backend();
    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch(keep, &tip, false).unwrap();
    backend.checkout_branch(&handle.id, keep, false).unwrap();
    backend.delete_branch(&handle.id, "main", false).unwrap();
}

fn default_names(branches: &[platypusgit_lib::git::types::BranchInfo]) -> Vec<String> {
    branches
        .iter()
        .filter(|b| b.is_default)
        .map(|b| b.name.clone())
        .collect()
}

#[test]
fn branch_tip_time_is_the_tip_committer_time() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let head_commit = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let head_time = head_commit.time().seconds();

    // A deliberately old tip: `Signature::now()` twice in a row would tie on a
    // one-second clock and prove nothing about ordering.
    let old_sig =
        git2::Signature::new("Old", "old@example.com", &git2::Time::new(1_000_000_000, 0)).unwrap();
    let tree = head_commit.tree().unwrap();
    let old_oid = tr
        .repo
        .commit(None, &old_sig, &old_sig, "old", &tree, &[&head_commit])
        .unwrap();
    tr.repo
        .branch("stale", &tr.repo.find_commit(old_oid).unwrap(), false)
        .unwrap();

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();

    let head = branches.iter().find(|b| b.name == "main").expect("main");
    let stale = branches.iter().find(|b| b.name == "stale").expect("stale");

    assert_eq!(head.tip_time, head_time);
    assert_eq!(stale.tip_time, 1_000_000_000);
    assert!(
        head.tip_time > stale.tip_time,
        "fixture sanity: the stale branch must sort older",
    );
}

#[test]
fn default_branch_follows_remote_head_symbolic_target() {
    let (tr, _up) = with_origin_head(&[], "main");
    let (backend, handle) = tr.open_with_backend();

    let branches = backend.branches(&handle.id).unwrap();
    let mut names = default_names(&branches);
    names.sort();

    // The local branch AND the remote's copy of it — the picker pins one at the
    // top of each of its two sections.
    assert_eq!(names, vec!["main".to_string(), "origin/main".to_string()]);
}

#[test]
fn remote_head_outranks_the_local_main_fallback() {
    // origin/HEAD names `release`, which exists only on the remote. `main`
    // exists locally and must NOT be treated as the default anyway.
    let (tr, _up) = with_origin_head(&["release"], "release");
    let (backend, handle) = tr.open_with_backend();

    let branches = backend.branches(&handle.id).unwrap();

    assert_eq!(default_names(&branches), vec!["origin/release".to_string()]);
}

#[test]
fn default_branch_falls_back_to_local_main() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("feature", &tip, false).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let branches = backend.branches(&handle.id).unwrap();

    assert_eq!(default_names(&branches), vec!["main".to_string()]);
}

/// Candidate order is `main`, `master`, `trunk` — and it is an ORDER, not a
/// set: a repo carrying both `master` and `trunk` answers `master`. Also pins
/// that `init.defaultBranch` is not consulted; if it were, this would answer
/// `trunk`.
#[test]
fn default_branch_falls_back_to_master_before_trunk() {
    let tr = TempRepo::with_initial_commit("hello\n");
    without_main(&tr, "master");
    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo.branch("trunk", &tip, false).unwrap();
    tr.repo
        .config()
        .unwrap()
        .set_str("init.defaultBranch", "trunk")
        .unwrap();

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();

    assert_eq!(default_names(&branches), vec!["master".to_string()]);
}

#[test]
fn no_default_branch_when_nothing_answers() {
    let tr = TempRepo::with_initial_commit("hello\n");
    without_main(&tr, "dev");

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();

    assert!(
        !branches.is_empty(),
        "fixture sanity: the repo still has branches",
    );
    assert!(default_names(&branches).is_empty());
}

/// A stale `origin/HEAD` must not suppress the local fallback.
///
/// The real-world shape: cloned when the default was `master`, upstream renamed
/// it to `main` and deleted `master`. `git fetch --prune` does NOT rewrite
/// `refs/remotes/origin/HEAD`, so the symref still names a ref nobody has. If
/// detection took that name on trust nothing would ever be pinned again, with
/// no error to explain it.
#[test]
fn stale_remote_head_falls_back_to_the_local_default() {
    let (tr, _up) = with_origin_head(&[], "main");
    tr.repo
        .reference_symbolic(
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/deleted-long-ago",
            true,
            "test fixture",
        )
        .unwrap();

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();
    let mut names = default_names(&branches);
    names.sort();

    assert_eq!(names, vec!["main".to_string(), "origin/main".to_string()]);
}

/// ...and when the local fallback has nothing to offer either, nothing is
/// pinned. Both halves matter: the previous test proves the fall-through
/// happens, this one proves it still terminates.
#[test]
fn stale_remote_head_with_no_local_candidate_pins_nothing() {
    let (tr, _up) = with_origin_head(&[], "main");
    tr.repo
        .reference_symbolic(
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/deleted-long-ago",
            true,
            "test fixture",
        )
        .unwrap();
    without_main(&tr, "dev");

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();

    // `origin/main` is still fetched, but nothing names it as the default.
    assert!(
        branches.iter().any(|b| b.name == "origin/main"),
        "fixture sanity: the remote-tracking ref is still there",
    );
    assert!(default_names(&branches).is_empty());
}
