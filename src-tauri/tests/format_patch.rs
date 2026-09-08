//! `format_patch` — export commits as mailbox-format patch files.
//!
//! The numbering is the part most likely to be silently wrong: each commit gets
//! its OWN `git format-patch` invocation, and left to itself every invocation
//! numbers from `0001` and the files overwrite one another. `--start-number` is
//! what makes a multi-commit export come out as a readable series.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{linear_history, TempRepo};

/// Sorted file names in `dir`, so assertions do not depend on readdir order.
fn names(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .expect("read out dir")
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    v.sort();
    v
}

#[test]
fn exports_one_commit_as_a_mailbox_patch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("a.txt", "alpha\n", "feat: add a.txt");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    let out = tempfile::tempdir().unwrap();

    let written = backend
        .format_patch(&handle.id, &[head], out.path())
        .expect("format-patch");

    assert_eq!(written.len(), 1, "one commit, one file: {written:?}");
    assert_eq!(names(out.path()), vec!["0001-feat-add-a.txt.patch".to_string()]);

    // MAILBOX format, which is the whole reason this is not a plain diff: the
    // author, the date and the subject travel with the change so `git am` can
    // reconstruct the commit.
    let body = std::fs::read_to_string(&written[0]).unwrap();
    assert!(body.starts_with("From "), "not a mailbox patch:\n{body}");
    assert!(body.contains("From: Test User <test@example.com>"));
    assert!(body.contains("Subject: [PATCH] feat: add a.txt"));
    assert!(body.contains("Date: "));
    assert!(body.contains("+alpha"));
}

/// THE case `--start-number` exists for. Without it each invocation writes
/// `0001-…` and later commits clobber earlier ones.
///
/// Measured: removing `--start-number` fails THIS test and only this one. In
/// particular `the_series_order_matches_the_oids_given` below still passes
/// without it, because two commits with different subjects produce two
/// different filenames even when both are numbered `0001` — so a fixture whose
/// commits happen to sort correctly hides the bug. This one uses
/// `linear_history`, whose subjects are uniform, and counts the files.
#[test]
fn numbers_a_multi_commit_export_as_a_series() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let oids = linear_history(&tr, 3); // newest-first, per the helper
    let oldest_first: Vec<String> = oids.iter().rev().cloned().collect();
    let (backend, handle) = tr.open_with_backend();
    let out = tempfile::tempdir().unwrap();

    let written = backend
        .format_patch(&handle.id, &oldest_first, out.path())
        .expect("format-patch");

    assert_eq!(written.len(), 3, "one file per commit: {written:?}");
    let files = names(out.path());
    assert_eq!(files.len(), 3, "three DISTINCT files, not one overwritten: {files:?}");
    assert!(files[0].starts_with("0001-"), "{files:?}");
    assert!(files[1].starts_with("0002-"), "{files:?}");
    assert!(files[2].starts_with("0003-"), "{files:?}");
}

/// And the numbering follows the order given, oldest first — a series read in
/// file order must replay in ancestry order.
#[test]
fn the_series_order_matches_the_oids_given() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("one.txt", "1\n", "feat: first");
    tr.add_commit("two.txt", "2\n", "feat: second");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let parent = head.parent(0).unwrap();
    let out = tempfile::tempdir().unwrap();

    backend
        .format_patch(
            &handle.id,
            &[parent.id().to_string(), head.id().to_string()],
            out.path(),
        )
        .expect("format-patch");

    let files = names(out.path());
    assert!(files[0].contains("first"), "0001 should be the older commit: {files:?}");
    assert!(files[1].contains("second"), "0002 should be the newer commit: {files:?}");
}

/// A merge is refused UP FRONT, and nothing is written — `format-patch` skips a
/// merge silently, so exporting a selection containing one would hand back a
/// shorter list with nothing saying which commit vanished.
#[test]
fn a_merge_commit_is_refused_and_nothing_is_written() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let h = support::merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let out = tempfile::tempdir().unwrap();

    let err = backend
        .format_patch(&handle.id, &[h.m.clone()], out.path())
        .expect_err("a merge has no patch to export");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(names(out.path()).is_empty());
}

/// And a merge ANYWHERE in the selection refuses the whole export, rather than
/// quietly writing the others: a series with a hole in it is not a series.
#[test]
fn a_merge_among_several_refuses_the_whole_export() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let h = support::merge_history(&tr);
    let (backend, handle) = tr.open_with_backend();
    let out = tempfile::tempdir().unwrap();

    let err = backend
        .format_patch(&handle.id, &[h.c.clone(), h.m.clone()], out.path())
        .expect_err("must refuse the whole export");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(
        names(out.path()).is_empty(),
        "the non-merge commit must NOT have been written: {:?}",
        names(out.path())
    );
}

#[test]
fn an_empty_selection_is_refused() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let out = tempfile::tempdir().unwrap();

    let err = backend
        .format_patch(&handle.id, &[], out.path())
        .expect_err("must refuse");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(names(out.path()).is_empty());
}

#[test]
fn an_unknown_oid_is_refused_and_nothing_is_written() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("a.txt", "alpha\n", "feat: add a.txt");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    let out = tempfile::tempdir().unwrap();

    // The good oid comes FIRST, so a per-commit loop with no up-front
    // resolution would already have written 0001 before hitting the bad one.
    let err = backend
        .format_patch(&handle.id, &[head, "0".repeat(40)], out.path())
        .expect_err("must refuse an unknown oid");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
    assert!(
        names(out.path()).is_empty(),
        "a refused export must write nothing: {:?}",
        names(out.path())
    );
}

/// The root commit has no parent and still exports — git handles it, and a
/// first-commit patch is a legitimate thing to send.
#[test]
fn the_root_commit_exports() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let root = tr.repo.head().unwrap().peel_to_commit().unwrap().id().to_string();
    let out = tempfile::tempdir().unwrap();

    let written = backend
        .format_patch(&handle.id, &[root], out.path())
        .expect("the root commit should export");
    assert_eq!(written.len(), 1);
    assert!(std::fs::read_to_string(&written[0]).unwrap().contains("README"));
}

/// The exported patch actually applies — the point of mailbox format.
#[test]
fn the_exported_patch_can_be_applied_to_a_fresh_clone_of_the_parent() {
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.add_commit("a.txt", "alpha\n", "feat: add a.txt");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let out = tempfile::tempdir().unwrap();
    let written = backend
        .format_patch(&handle.id, &[head.id().to_string()], out.path())
        .expect("format-patch");

    // A second repo at the parent commit, then `git am` the patch.
    let other = TempRepo::with_initial_commit("hello\n");
    let applied = support::git_in(other.path(), &["am", &written[0]]);
    let _ = applied;
    let subject = support::git_in(other.path(), &["log", "-1", "--pretty=%s"]);
    assert!(
        subject.contains("feat: add a.txt"),
        "git am should have reconstructed the commit, got {subject:?}"
    );
    assert_eq!(
        support::fs::read_file(other.path(), "a.txt"),
        "alpha\n",
        "and its content"
    );
}
