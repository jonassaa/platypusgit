//! Bisect integration tests (#93).
//!
//! The fixture is a linear 10-commit history whose file content flips at a known
//! commit, so "the first bad commit" has one right answer and the reported progress
//! can be checked against git's own arithmetic.
//!
//! The restart case is the load-bearing one: a FRESH `Libgit2Backend` (no in-process
//! state at all) must read the in-progress bisect from git's own files and be able
//! to continue and reset it. That is what "git's state is the only state of record"
//! has to mean in practice.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::types::{BisectMark, RepoState};
use platypusgit_lib::git::GitBackend;
use support::{git_in, TempRepo};

/// 10 commits on `main`; `flag.txt` reads "good" up to and including commit 5 and
/// "bad" from commit 6 on. Returns the oids oldest-first.
fn bisect_fixture() -> (TempRepo, Vec<String>) {
    let tr = TempRepo::with_initial_commit("readme\n");
    let mut oids = vec![tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string()];
    for i in 1..=9 {
        let body = if i < 6 { "good\n" } else { "bad\n" };
        tr.add_commit("flag.txt", body, &format!("commit {i}"));
        oids.push(
            tr.repo
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
        );
    }
    (tr, oids)
}

/// Walk the bisect to convergence by testing the file the fixture flips.
fn drive_to_culprit(backend: &Libgit2Backend, handle: &platypusgit_lib::git::types::RepoHandle, root: &std::path::Path) {
    for _ in 0..12 {
        let status = backend.bisect_status(&handle.id).expect("bisect_status");
        if status.first_bad_oid.is_some() {
            return;
        }
        let is_bad = std::fs::read_to_string(root.join("flag.txt"))
            .map(|s| s.trim() == "bad")
            .unwrap_or(false);
        let mark = if is_bad {
            BisectMark::Bad
        } else {
            BisectMark::Good
        };
        backend
            .bisect_mark(&handle.id, mark, None)
            .expect("bisect_mark");
    }
    panic!("bisect never converged");
}

#[test]
fn a_clean_repo_reports_no_bisect() {
    let (tr, _) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();
    let status = backend.bisect_status(&handle.id).expect("bisect_status");
    assert!(!status.in_progress);
    assert_eq!(status.bad_term, "bad");
    assert_eq!(status.good_term, "good");
    assert!(status.remaining.is_none());
}

#[test]
fn start_reports_the_same_progress_git_does() {
    let (tr, oids) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();
    let bad = oids.last().unwrap().clone();
    let good = oids[0].clone();

    let status = backend
        .bisect_start(&handle.id, &bad, &[good])
        .expect("bisect_start");

    assert!(status.in_progress);
    assert_eq!(status.start_ref.as_deref(), Some("main"));
    assert_eq!(status.good_count, 1);
    assert_eq!(status.bad_count, 1);
    assert_eq!(status.skipped_count, 0);
    // git's own numbers for 9 candidates between good and bad.
    assert_eq!(status.remaining, Some(4));
    assert_eq!(status.steps, Some(2));
    assert!(status.first_bad_oid.is_none());
    // A bisect checks out a revision to test, so HEAD moved off the tip.
    assert_ne!(status.current_oid.as_deref(), Some(bad.as_str()));

    // `RepoState::Bisect` needs no new variant — libgit2 reads it off BISECT_LOG,
    // so the operation bar is correct the moment the ops exist.
    assert_eq!(
        backend.repo_state(&handle.id).expect("repo_state"),
        RepoState::Bisect
    );
}

#[test]
fn marking_converges_on_the_commit_that_introduced_the_change() {
    let (tr, oids) = bisect_fixture();
    let culprit = oids[6].clone(); // "commit 6" — the first with flag.txt == bad
    let (backend, handle) = tr.open_with_backend();
    backend
        .bisect_start(&handle.id, oids.last().unwrap(), &[oids[0].clone()])
        .expect("bisect_start");

    drive_to_culprit(&backend, &handle, tr.path());

    let status = backend.bisect_status(&handle.id).expect("bisect_status");
    assert_eq!(status.first_bad_oid.as_deref(), Some(culprit.as_str()));
    // Converged: no more revisions to test, so no misleading "N left".
    assert!(status.remaining.is_none());
    assert!(status.steps.is_none());
    // git leaves the bisect OPEN after it converges, and so do we — the user still
    // has to reset, which is what the bar's Reset button is for.
    assert!(status.in_progress);
}

#[test]
fn skip_records_a_skip_ref_and_keeps_going() {
    let (tr, oids) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();
    backend
        .bisect_start(&handle.id, oids.last().unwrap(), &[oids[0].clone()])
        .expect("bisect_start");

    let status = backend
        .bisect_mark(&handle.id, BisectMark::Skip, None)
        .expect("bisect_mark skip");

    assert_eq!(status.skipped_count, 1);
    assert!(status.in_progress);
    let refs = git_in(tr.path(), &["for-each-ref", "--format=%(refname)", "refs/bisect/*"]);
    assert!(
        refs.contains("refs/bisect/skip-"),
        "git should record a skip ref:\n{refs}"
    );
}

#[test]
fn reset_returns_to_the_starting_branch_and_clears_gits_state() {
    let (tr, oids) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();
    backend
        .bisect_start(&handle.id, oids.last().unwrap(), &[oids[0].clone()])
        .expect("bisect_start");

    backend.bisect_reset(&handle.id).expect("bisect_reset");

    assert!(!backend
        .bisect_status(&handle.id)
        .expect("bisect_status")
        .in_progress);
    assert_eq!(
        backend.repo_state(&handle.id).expect("repo_state"),
        RepoState::Clean
    );
    // Back on the branch, at its tip — NOT detached where the last test landed,
    // which is what `abort_operation`'s hard reset to HEAD would have left.
    let head = git_in(tr.path(), &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(head.trim(), "main");
    let tip = git_in(tr.path(), &["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(&tip, oids.last().unwrap());
    assert!(!tr.path().join(".git").join("BISECT_LOG").exists());
}

#[test]
fn a_restarted_app_reads_the_bisect_from_gits_files_and_can_finish_it() {
    let (tr, oids) = bisect_fixture();
    let culprit = oids[6].clone();
    {
        let (backend, handle) = tr.open_with_backend();
        backend
            .bisect_start(&handle.id, oids.last().unwrap(), &[oids[0].clone()])
            .expect("bisect_start");
    } // both the backend and its in-process state are dropped here

    // A brand-new backend — the equivalent of relaunching the app. It has never
    // seen this bisect; everything it knows comes from git's own files.
    let fresh = Libgit2Backend::new();
    let handle = fresh.open(tr.path()).expect("reopen");
    let status = fresh.bisect_status(&handle.id).expect("bisect_status");
    assert!(status.in_progress, "the bisect must survive a restart");
    assert_eq!(status.remaining, Some(4));
    assert_eq!(status.start_ref.as_deref(), Some("main"));

    drive_to_culprit(&fresh, &handle, tr.path());
    assert_eq!(
        fresh
            .bisect_status(&handle.id)
            .expect("bisect_status")
            .first_bad_oid
            .as_deref(),
        Some(culprit.as_str())
    );
    fresh.bisect_reset(&handle.id).expect("bisect_reset");
}

#[test]
fn a_custom_term_bisect_started_elsewhere_is_read_with_its_own_terms() {
    let (tr, oids) = bisect_fixture();
    // Started outside the app, with git's `--term-old`/`--term-new`. Assuming
    // "good"/"bad" here would look for refs/bisect/bad, find nothing, and report a
    // bisect with no progress and no culprit — i.e. silently wrong.
    git_in(
        tr.path(),
        &[
            "bisect",
            "start",
            "--term-old=works",
            "--term-new=broken",
            oids.last().unwrap(),
            &oids[0],
        ],
    );

    let (backend, handle) = tr.open_with_backend();
    let status = backend.bisect_status(&handle.id).expect("bisect_status");
    assert!(status.in_progress);
    assert_eq!(status.bad_term, "broken");
    assert_eq!(status.good_term, "works");
    assert_eq!(status.remaining, Some(4));
    assert_eq!(status.good_count, 1);
    assert_eq!(status.bad_count, 1);

    // And a mark uses THIS bisect's terms, not git's defaults.
    backend
        .bisect_mark(&handle.id, BisectMark::Good, None)
        .expect("bisect_mark with custom terms");
    assert_eq!(
        backend.bisect_status(&handle.id).unwrap().good_count,
        2,
        "the mark must have landed as a `works` ref"
    );
    backend.bisect_reset(&handle.id).expect("bisect_reset");
}

#[test]
fn marking_or_resetting_without_a_bisect_is_no_bisect_not_a_git_error() {
    let (tr, _) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .bisect_mark(&handle.id, BisectMark::Good, None)
        .expect_err("no bisect to mark");
    assert!(matches!(err, AppError::NoBisect), "got {err:?}");
    let err = backend.bisect_reset(&handle.id).expect_err("no bisect to reset");
    assert!(matches!(err, AppError::NoBisect), "got {err:?}");
}

#[test]
fn an_unresolvable_revision_is_refused_before_git_is_spawned() {
    let (tr, oids) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .bisect_start(&handle.id, "not-a-rev", &[oids[0].clone()])
        .expect_err("bad revspec");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
    // Nothing started, so the repository is untouched.
    assert!(!backend
        .bisect_status(&handle.id)
        .expect("bisect_status")
        .in_progress);
}

#[test]
fn start_with_no_good_revision_is_legal_and_reports_no_progress_yet() {
    let (tr, oids) = bisect_fixture();
    let (backend, handle) = tr.open_with_backend();

    // "This commit is broken, I'll find a working one as I go" — git accepts it and
    // waits, so the UI must be able to offer it.
    let status = backend
        .bisect_start(&handle.id, oids.last().unwrap(), &[])
        .expect("bisect_start with no good rev");
    assert!(status.in_progress);
    assert_eq!(status.good_count, 0);
    assert_eq!(status.bad_count, 1);
    assert!(status.first_bad_oid.is_none());
    backend.bisect_reset(&handle.id).expect("bisect_reset");
}
