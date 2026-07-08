mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

/// A modified tracked file reports its added/removed line counts vs HEAD.
#[test]
fn status_reports_per_file_line_counts() {
    let tr = TempRepo::with_initial_commit("line one\nline two\nline three\n");
    // Drop "line two", append two new lines: +2 / -1 (line three stays context).
    write_file(tr.path(), "README.md", "line one\nline three\nnew a\nnew b\n");
    let (backend, handle) = tr.open_with_backend();

    let status = backend.status(&handle.id).unwrap();
    let readme = status.iter().find(|f| f.path == "README.md").unwrap();
    assert_eq!(readme.additions, 2, "two appended lines");
    assert_eq!(readme.deletions, 1, "line two removed");
}

/// An untracked file counts its whole content as additions.
#[test]
fn status_counts_untracked_file_as_additions() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "new.txt", "a\nb\nc\n");
    let (backend, handle) = tr.open_with_backend();

    let status = backend.status(&handle.id).unwrap();
    let entry = status.iter().find(|f| f.path == "new.txt").unwrap();
    assert_eq!(entry.additions, 3);
    assert_eq!(entry.deletions, 0);
}

/// Staged changes still count (the diff is HEAD → working tree, index-aware).
#[test]
fn status_counts_staged_changes() {
    let tr = TempRepo::with_initial_commit("a\n");
    write_file(tr.path(), "README.md", "a\nb\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .expect("stage");

    let status = backend.status(&handle.id).unwrap();
    let readme = status.iter().find(|f| f.path == "README.md").unwrap();
    assert_eq!(readme.additions, 1);
    assert_eq!(readme.deletions, 0);
}

/// An unmodified working tree reports zero counts (and typically no entries).
#[test]
fn status_unmodified_has_zero_counts() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let status = backend.status(&handle.id).unwrap();
    for f in &status {
        assert_eq!(f.additions, 0);
        assert_eq!(f.deletions, 0);
    }
}
