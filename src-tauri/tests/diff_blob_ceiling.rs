//! One blob-size ceiling for every diff path (#385).
//!
//! `MAX_WORKDIR_BLOB` used to be set at exactly one site —
//! `diff_ref_to_workdir` — while the three functions that actually feed the
//! commit panel and every commit diff (`diff`, `diff_commit`, `diff_commits`)
//! inherited libgit2's 512 MB default. Clicking a checked-in 80 MB
//! `bundle.min.js` xdiff'd the whole thing, allocated a `String` per line, and
//! shipped the lot across IPC as one JSON payload.
//!
//! The ceiling is now the same at all four, and the answer is HONEST: a blob
//! over the ceiling comes back with `oversized: Some(..)` carrying the size and
//! the limit, so the UI can say "too large to diff" instead of the dishonest
//! "Binary file" a bare `max_size` would produce for a text file.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::git::libgit2::MAX_WORKDIR_BLOB;
use platypusgit_lib::git::types::{DiffKind, FileDiff};
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// Comfortably over the 5 MB ceiling, and unambiguously TEXT: plain ASCII with
/// newlines, so libgit2's own binary sniff (a NUL in the first 8000 bytes) has
/// nothing to find. Without a ceiling this is exactly the file that diffs.
fn oversized_text() -> String {
    let line = "the quick brown fox jumps over the lazy dog; padding padding\n";
    debug_assert_eq!(line.len(), 61);
    // ~6.7 MB.
    line.repeat(110_000)
}

/// The same content, one line longer — a modification of a file already over
/// the ceiling.
fn oversized_text_plus_one() -> String {
    let mut s = oversized_text();
    s.push_str("one more line\n");
    s
}

fn find<'a>(diffs: &'a [FileDiff], path: &str) -> &'a FileDiff {
    diffs
        .iter()
        .find(|d| d.path == path)
        .unwrap_or_else(|| panic!("{path} in diff; got {:?}", diffs.iter().map(|d| &d.path).collect::<Vec<_>>()))
}

/// The shared shape of "we did not look at this blob".
fn assert_oversized(fd: &FileDiff, at_least: u64) {
    let over = fd
        .oversized
        .as_ref()
        .unwrap_or_else(|| panic!("{} reported as oversized", fd.path));
    assert!(
        over.size >= at_least,
        "{}: reported size {} covers the real blob ({at_least})",
        fd.path,
        over.size
    );
    assert_eq!(
        over.limit, MAX_WORKDIR_BLOB as u64,
        "the limit the UI names is the one that was applied"
    );
    assert!(
        fd.binary,
        "{}: libgit2 marks an over-ceiling blob binary, and the surfaces' \
         `binary` branch is what routes to the notice",
        fd.path
    );
    assert!(
        fd.hunks.is_empty(),
        "{}: the whole point is that no line was serialised",
        fd.path
    );
    assert_eq!((fd.additions, fd.deletions), (0, 0));
}

#[test]
fn diff_commit_reports_an_oversized_blob_instead_of_diffing_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let big = oversized_text();
    support::fs::write_file(tr.path(), "bundle.min.js", &big);
    support::fs::write_file(tr.path(), "small.txt", "one\ntwo\n");
    tr.commit_all("add a generated artifact");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let diffs = backend.diff_commit(&handle.id, &tip, 3, false).unwrap();

    assert_oversized(find(&diffs, "bundle.min.js"), big.len() as u64);
    // The control: a small text file in the SAME commit still diffs normally,
    // so the ceiling is a per-blob decision, not a per-diff one.
    let small = find(&diffs, "small.txt");
    assert!(small.oversized.is_none());
    assert!(small.additions >= 2, "small file still diffs");
}

#[test]
fn diff_commits_reports_an_oversized_blob_instead_of_diffing_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let base = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    let big = oversized_text();
    support::fs::write_file(tr.path(), "bundle.min.js", &big);
    tr.commit_all("add a generated artifact");
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let diffs = backend
        .diff_commits(&handle.id, &base, &tip, 3, false)
        .unwrap();

    assert_oversized(find(&diffs, "bundle.min.js"), big.len() as u64);
}

#[test]
fn diff_single_file_reports_an_oversized_worktree_blob() {
    // The commit panel's own workhorse: one path, worktree against HEAD.
    let tr = TempRepo::with_initial_commit("hello\n");
    let big = oversized_text();
    support::fs::write_file(tr.path(), "bundle.min.js", &big);
    tr.commit_all("add a generated artifact");
    support::fs::write_file(tr.path(), "bundle.min.js", &oversized_text_plus_one());
    let (backend, handle) = tr.open_with_backend();

    let fd = backend
        .diff(
            &handle.id,
            Path::new("bundle.min.js"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .unwrap();

    assert_oversized(&fd, big.len() as u64);
}

#[test]
fn diff_single_file_reports_an_oversized_staged_blob() {
    // IndexToHead — the staged side of the same panel, a tree-to-index diff and
    // therefore a different libgit2 code path from the worktree one above.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let big = oversized_text();
    support::fs::write_file(tr.path(), "bundle.min.js", &big);
    backend
        .stage(&handle.id, &[PathBuf::from("bundle.min.js")])
        .unwrap();

    let fd = backend
        .diff(
            &handle.id,
            Path::new("bundle.min.js"),
            DiffKind::IndexToHead,
            3,
            false,
        )
        .unwrap();

    assert_oversized(&fd, big.len() as u64);
}

#[test]
fn an_ordinary_text_file_is_never_reported_as_oversized() {
    // The regression that matters most: the ceiling must not change what a
    // normal diff looks like.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    support::fs::write_file(tr.path(), "README.md", "hello\nworld\n");

    let fd = backend
        .diff(
            &handle.id,
            Path::new("README.md"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .unwrap();

    assert!(fd.oversized.is_none());
    assert!(!fd.binary);
    assert_eq!(fd.additions, 1);
}
