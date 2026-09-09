//! What decorates a log row, and WHICH KIND OF REF each decoration is.
//!
//! The kind is answered here, at the walk, because a shorthand cannot carry it:
//! a tag and a branch share one namespace of display names, and a `/` means
//! nothing — `feat/x` is a local branch, `origin/x` a remote-tracking one,
//! `release/1.0` an ordinary tag. The frontend used to guess from the string,
//! which drew a branch icon on every tag and read `release/1.0` as a remote
//! called `release`.

mod support;

use platypusgit_lib::git::types::{CommitInfo, RefKind};
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// The kind the walk reported for one ref name, across the whole log.
fn kind_of(commits: &[CommitInfo], name: &str) -> Option<RefKind> {
    commits
        .iter()
        .flat_map(|c| c.refs.iter())
        .find(|r| r.name == name)
        .map(|r| r.kind)
}

/// Every ref name the walk put on the row for `summary`.
fn refs_on(commits: &[CommitInfo], summary: &str) -> Vec<String> {
    commits
        .iter()
        .find(|c| c.summary == summary)
        .map(|c| c.refs.iter().map(|r| r.name.clone()).collect())
        .unwrap_or_default()
}

/// A lightweight tag is a tag, not a branch.
#[test]
fn a_lightweight_tag_is_reported_as_a_tag() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .tag_lightweight("v1.0.0", head.as_object(), false)
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert_eq!(kind_of(&out, "v1.0.0"), Some(RefKind::Tag));
    assert_eq!(refs_on(&out, "initial"), vec!["main", "v1.0.0"]);
}

/// An annotated tag points at a TAG object, so it only lands on the row at all
/// by being peeled — and it must survive that peel as a tag.
#[test]
fn an_annotated_tag_is_reported_as_a_tag_on_the_commit_it_peels_to() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
    tr.repo
        .tag("v2.0.0", head.as_object(), &sig, "release two", false)
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert_eq!(kind_of(&out, "v2.0.0"), Some(RefKind::Tag));
}

/// The name is not the evidence: a slash makes neither a remote nor a branch.
#[test]
fn slashes_do_not_decide_the_kind() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .tag_lightweight("release/1.0", head.as_object(), false)
        .unwrap();
    tr.repo.branch("feat/x", &head, false).unwrap();
    tr.repo
        .reference(
            "refs/remotes/origin/main",
            head.id(),
            false,
            "test remote-tracking ref",
        )
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert_eq!(kind_of(&out, "release/1.0"), Some(RefKind::Tag));
    assert_eq!(kind_of(&out, "feat/x"), Some(RefKind::Branch));
    assert_eq!(kind_of(&out, "origin/main"), Some(RefKind::Remote));
}

/// `git tag main` is legal — tags and branches are different namespaces — and
/// the two decorations must not collapse into one another.
#[test]
fn a_tag_and_a_branch_of_the_same_name_stay_distinct() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .tag_lightweight("main", head.as_object(), false)
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    let mut kinds: Vec<RefKind> = out
        .iter()
        .flat_map(|c| c.refs.iter())
        .filter(|r| r.name == "main")
        .map(|r| r.kind)
        .collect();
    kinds.sort_by_key(|k| format!("{k:?}"));
    assert_eq!(kinds, vec![RefKind::Branch, RefKind::Tag]);
}

/// A ref that is neither branch, remote-tracking nor tag is named as itself.
/// `refs/bisect/*` is the everyday case: it points at commits in the walk for
/// as long as a bisect runs.
#[test]
fn an_unclassified_ref_is_reported_as_other() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .reference("refs/bisect/bad", head.id(), false, "test bisect ref")
        .unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend.log(&handle.id, None, 100).unwrap();

    assert_eq!(kind_of(&out, "bisect/bad"), Some(RefKind::Other));
}
