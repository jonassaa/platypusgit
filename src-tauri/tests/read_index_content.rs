//! read_file_content_at_index — the INDEX copy of a file.
//!
//! The commit panel diffs against the index (IndexToHead when staged,
//! WorktreeToIndex otherwise). Without this op its syntax tokens had to be
//! approximated from HEAD and the worktree, which disagree with the index exactly
//! when a file is partially staged.

mod support;

use std::path::Path;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoId, GitBackend};

use support::{fs::write_file, TempRepo};

/// A staged edit is visible in the index while the worktree has moved on again.
#[test]
fn reads_the_staged_copy_not_the_worktree_or_head() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();

    // Stage "v2", then edit the worktree again to "v3".
    write_file(tr.path(), "README.md", "v2\n");
    backend
        .stage(&handle.id, &[Path::new("README.md").to_path_buf()])
        .unwrap();
    write_file(tr.path(), "README.md", "v3\n");

    let index = backend
        .read_file_content_at_index(&handle.id, Path::new("README.md"))
        .unwrap()
        .expect("README.md is in the index");
    assert_eq!(index.text.as_deref(), Some("v2\n"));
    assert!(!index.binary);

    // The other two reads must still disagree with it — that disagreement is the
    // whole reason this op exists.
    let worktree = backend
        .read_file_content(&handle.id, Path::new("README.md"))
        .unwrap();
    assert_eq!(worktree.text.as_deref(), Some("v3\n"));
    let head = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new("README.md"))
        .unwrap()
        .expect("README.md exists at HEAD");
    assert_eq!(head.text.as_deref(), Some("v1\n"));
}

/// With nothing staged the index still holds the committed content.
#[test]
fn reads_committed_content_when_nothing_is_staged() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();

    let index = backend
        .read_file_content_at_index(&handle.id, Path::new("README.md"))
        .unwrap()
        .expect("README.md is in the index");
    assert_eq!(index.text.as_deref(), Some("v1\n"));
}

/// A path that is not in the index at all is `Ok(None)`, not an error (#146) —
/// the caller renders the rows plain. The commit panel asks for the index side of
/// every row it draws, so an untracked row having none is the expected answer,
/// and reporting it as `InvalidPath` put a routine condition on the error path.
#[test]
fn untracked_path_is_absent_not_an_error() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_file(tr.path(), "untracked.txt", "nope\n");
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content_at_index(&handle.id, Path::new("untracked.txt"))
        .expect("absence must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

/// ...but a GENUINE failure on the same op still errors. Absence going quiet
/// must not take real problems with it.
#[test]
fn an_unknown_repo_still_errors_while_absence_does_not() {
    let err = Libgit2Backend::new()
        .read_file_content_at_index(&RepoId("never-opened".into()), Path::new("README.md"))
        .unwrap_err();
    assert!(matches!(err, AppError::UnknownRepo(_)), "got {err:?}");
}

/// Binary content is reported as binary with no text, like the other readers.
#[test]
fn binary_content_reports_binary() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();

    std::fs::write(tr.path().join("blob.bin"), [0u8, 159, 146, 150]).unwrap();
    backend
        .stage(&handle.id, &[Path::new("blob.bin").to_path_buf()])
        .unwrap();

    let out = backend
        .read_file_content_at_index(&handle.id, Path::new("blob.bin"))
        .unwrap()
        .expect("blob.bin is staged");
    assert!(out.binary);
    assert!(out.text.is_none());
}
