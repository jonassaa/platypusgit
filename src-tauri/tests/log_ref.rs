mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::{LogFilter, REFSPEC_ALL};
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

fn checkout(tr: &TempRepo, branch: &str) {
    tr.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    let mut co = git2::build::CheckoutBuilder::new();
    co.force();
    tr.repo.checkout_head(Some(&mut co)).unwrap();
}

/// main: `initial` → `main work`; `feature` (branched at initial):
/// `cherry commit`, unmerged. HEAD ends on main.
fn branchy() -> TempRepo {
    let tr = TempRepo::with_initial_commit("hi\n");
    {
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.branch("feature", &head, false).unwrap();
    }
    tr.add_commit("main.txt", "m\n", "main work");
    checkout(&tr, "feature");
    tr.add_commit("cherry.txt", "cherry\n", "cherry commit");
    checkout(&tr, "main");
    tr
}

fn summaries(commits: &[platypusgit_lib::git::types::CommitInfo]) -> Vec<&str> {
    commits.iter().map(|c| c.summary.as_str()).collect()
}

/// Default (None) stays HEAD-scoped: the unmerged branch's commit is absent.
#[test]
fn head_log_excludes_unmerged_branch_commit() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert_eq!(summaries(&out), vec!["main work", "initial"]);
}

/// A branch refspec walks from that branch's tip.
#[test]
fn ref_scoped_log_returns_unmerged_branch_commits() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, Some("feature"), 100).unwrap();

    assert_eq!(summaries(&out), vec!["cherry commit", "initial"]);
}

/// Any revspec works as the start point — oid and suffix syntax included.
#[test]
fn ref_scoped_log_accepts_oid_and_revspec() {
    let tr = branchy();
    let feature_tip = tr
        .repo
        .revparse_single("feature")
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();
    let (backend, handle) = tr.open_with_backend();

    let by_oid = backend.log(&handle.id, Some(&feature_tip), 100).unwrap();
    assert_eq!(summaries(&by_oid), vec!["cherry commit", "initial"]);

    let by_suffix = backend.log(&handle.id, Some("feature~1"), 100).unwrap();
    assert_eq!(summaries(&by_suffix), vec!["initial"]);
}

/// Tags resolve too (annotated tags peel to their commit).
#[test]
fn ref_scoped_log_accepts_tag() {
    let tr = branchy();
    {
        let target = tr.repo.revparse_single("feature").unwrap();
        let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
        tr.repo.tag("v-cherry", &target, &sig, "tagged", false).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, Some("v-cherry"), 100).unwrap();

    assert_eq!(summaries(&out), vec!["cherry commit", "initial"]);
}

/// Unresolvable refspec → InvalidRef, not a stringified internal error.
#[test]
fn ref_scoped_log_invalid_ref_errors() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let err = backend.log(&handle.id, Some("no-such-ref"), 100).unwrap_err();

    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

/// The `limit` still caps a ref-scoped walk.
#[test]
fn ref_scoped_log_respects_limit() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, Some("feature"), 1).unwrap();

    assert_eq!(summaries(&out), vec!["cherry commit"]);
}

/// log_filtered searches within the scoped walk only.
#[test]
fn log_filtered_is_ref_scoped() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();
    let filter = LogFilter {
        message: Some("cherry".into()),
        ..Default::default()
    };

    // HEAD scope: the cherry commit is unreachable → no match.
    let head_scoped = backend
        .log_filtered(&handle.id, &filter, None, 100)
        .unwrap();
    assert!(head_scoped.is_empty(), "got {head_scoped:?}");

    // feature scope: found.
    let branch_scoped = backend
        .log_filtered(&handle.id, &filter, Some("feature"), 100)
        .unwrap();
    assert_eq!(summaries(&branch_scoped), vec!["cherry commit"]);
}

/// An empty filter with a refspec falls back to the plain ref-scoped log.
#[test]
fn log_filtered_empty_filter_keeps_refspec() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .log_filtered(&handle.id, &LogFilter::default(), Some("feature"), 100)
        .unwrap();

    assert_eq!(summaries(&out), vec!["cherry commit", "initial"]);
}

// ─── "All branches" scope (REFSPEC_ALL) ──────────────────────────────────────

/// The all-refs sentinel walks every branch at once, so an unmerged branch's
/// commit shows up next to HEAD's — one graph, every branch we know of.
#[test]
fn all_refs_log_includes_every_branch() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, Some(REFSPEC_ALL), 100).unwrap();
    let got = summaries(&out);

    assert!(got.contains(&"main work"), "got {got:?}");
    assert!(got.contains(&"cherry commit"), "got {got:?}");
    assert!(got.contains(&"initial"), "got {got:?}");
    // "initial" is shared ancestry — each commit appears exactly once.
    assert_eq!(got.len(), 3, "got {got:?}");
}

/// A detached HEAD is under no branch; its commits must not vanish from the
/// all-refs walk.
#[test]
fn all_refs_log_keeps_a_detached_head() {
    let tr = branchy();
    tr.add_commit("detached.txt", "d\n", "detached work");
    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    let parent = tr
        .repo
        .revparse_single("HEAD~1")
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id();
    tr.repo.set_head_detached(tip).unwrap();
    // Rewind main so the newest commit is reachable from HEAD alone.
    tr.repo
        .find_reference("refs/heads/main")
        .unwrap()
        .set_target(parent, "rewind")
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, Some(REFSPEC_ALL), 100).unwrap();

    assert!(summaries(&out).contains(&"detached work"), "got {out:?}");
}

/// Paging an all-refs walk resumes from the frontier, so no branch is dropped
/// at a page boundary.
#[test]
fn all_refs_log_pages_without_losing_a_branch() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();

    let first = backend
        .log_page(&handle.id, Some(REFSPEC_ALL), None, 2)
        .unwrap();
    assert_eq!(first.commits.len(), 2);
    let cursor = first.next_cursor.clone().expect("expected a next cursor");
    let second = backend
        .log_page(&handle.id, Some(REFSPEC_ALL), Some(&cursor), 2)
        .unwrap();

    let mut all = summaries(&first.commits);
    all.extend(summaries(&second.commits));
    all.sort_unstable();
    assert_eq!(all, vec!["cherry commit", "initial", "main work"]);
}

/// Search under the all-refs scope reaches commits HEAD cannot.
#[test]
fn log_filtered_all_refs_finds_an_unmerged_commit() {
    let tr = branchy();
    let (backend, handle) = tr.open_with_backend();
    let filter = LogFilter {
        message: Some("cherry".into()),
        ..Default::default()
    };

    let out = backend
        .log_filtered(&handle.id, &filter, Some(REFSPEC_ALL), 100)
        .unwrap();

    assert_eq!(summaries(&out), vec!["cherry commit"]);
}
