mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{linear_history, TempRepo};

/// commits_since(base) returns commits reachable from HEAD but not from `base`,
/// newest-first — i.e. the `base..HEAD` range used to seed a rebase plan.
#[test]
fn commits_since_full_oid_returns_range_newest_first() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let oids = linear_history(&tr, 5); // oldest-first: commit 0..4, HEAD = oids[4]
    let (backend, handle) = tr.open_with_backend();

    let out = backend.commits_since(&handle.id, &oids[1]).unwrap();

    // base..HEAD excludes the base itself: commits 2, 3, 4 — newest first.
    let summaries: Vec<&str> = out.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["commit 4", "commit 3", "commit 2"]);
}

/// Regression: a short (abbreviated) hash must resolve. The old client-side
/// path compared a typed short hash against full 40-char oids and never matched.
#[test]
fn commits_since_short_hash_resolves() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let oids = linear_history(&tr, 5);
    let (backend, handle) = tr.open_with_backend();

    let short = &oids[1][..8];
    let out = backend.commits_since(&handle.id, short).unwrap();

    assert_eq!(out.len(), 3);
    assert_eq!(out[0].summary, "commit 4");
}

/// Any revspec resolves — e.g. HEAD~N.
#[test]
fn commits_since_accepts_revspec() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 5);
    let (backend, handle) = tr.open_with_backend();

    let out = backend.commits_since(&handle.id, "HEAD~3").unwrap();

    assert_eq!(out.len(), 3);
    assert_eq!(out[0].summary, "commit 4");
}

/// base == HEAD yields an empty range, not an error.
#[test]
fn commits_since_head_is_empty() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    let out = backend.commits_since(&handle.id, "HEAD").unwrap();

    assert!(out.is_empty());
}

/// A base that is not an ancestor of HEAD is rejected — a rebase base must be
/// reachable from HEAD.
#[test]
fn commits_since_rejects_non_ancestor() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let oids = linear_history(&tr, 3);
    let (backend, handle) = tr.open_with_backend();

    // Forge a commit off an older commit, on its own ref — divergent from HEAD,
    // without moving the worktree (HEAD stays on main).
    let parent = tr.repo.find_commit(git2::Oid::from_str(&oids[0]).unwrap()).unwrap();
    let sig = git2::Signature::now("Test", "test@example.com").unwrap();
    let feature_tip = tr
        .repo
        .commit(
            Some("refs/heads/feature"),
            &sig,
            &sig,
            "side commit",
            &parent.tree().unwrap(),
            &[&parent],
        )
        .unwrap()
        .to_string();

    let err = backend.commits_since(&handle.id, &feature_tip).unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

/// A revspec that doesn't resolve is an error.
#[test]
fn commits_since_rejects_unknown_ref() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend.commits_since(&handle.id, "no-such-ref").unwrap_err();
    assert!(matches!(err, AppError::Git(_) | AppError::InvalidRef(_)), "got {err:?}");
}
