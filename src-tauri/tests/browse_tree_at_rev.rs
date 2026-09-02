mod support;

use std::path::Path;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::StatusFlag;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

/// list_files_at_rev walks the whole tree of an arbitrary revision, including
/// nested directories, and reports every blob (Unmodified on both sides).
#[test]
fn lists_full_tree_at_revision() {
    let tr = TempRepo::with_initial_commit("v1\n");
    // Add a nested file in a second commit.
    write_file(tr.path(), "src/main.rs", "fn main() {}\n");
    tr.commit_all("add nested file");
    let (backend, handle) = tr.open_with_backend();

    let files = backend.list_files_at_rev(&handle.id, "HEAD").unwrap();
    let mut paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, vec!["README.md", "src/main.rs"]);
    assert!(files
        .iter()
        .all(|f| matches!(f.worktree, StatusFlag::Unmodified)));
}

/// The tree at an older revision reflects that snapshot, not HEAD.
#[test]
fn lists_tree_at_older_revision() {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_file(tr.path(), "extra.txt", "later\n");
    tr.commit_all("add extra");
    let (backend, handle) = tr.open_with_backend();

    // At HEAD~1 only README.md existed.
    let files = backend.list_files_at_rev(&handle.id, "HEAD~1").unwrap();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["README.md"]);
}

/// read_file_content_at_rev returns the historical content of a file, not the
/// current worktree version.
#[test]
fn reads_historical_file_content() {
    let tr = TempRepo::with_initial_commit("first version\n");
    // Overwrite README in a second commit.
    write_file(tr.path(), "README.md", "second version\n");
    tr.commit_all("update readme");
    let (backend, handle) = tr.open_with_backend();

    let old = backend
        .read_file_content_at_rev(&handle.id, "HEAD~1", Path::new("README.md"))
        .unwrap()
        .expect("README.md exists at HEAD~1");
    assert_eq!(old.text.as_deref(), Some("first version\n"));
    assert!(!old.binary);
    assert!(old.from_head);

    let cur = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new("README.md"))
        .unwrap()
        .expect("README.md exists at HEAD");
    assert_eq!(cur.text.as_deref(), Some("second version\n"));
}

/// A branch name resolves as a revspec for both ops.
#[test]
fn resolves_branch_revspec() {
    let tr = TempRepo::with_initial_commit("main content\n");
    let (backend, handle) = tr.open_with_backend();
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature", false).unwrap();
    write_file(tr.path(), "feature.txt", "on feature\n");
    tr.commit_all("feature commit");

    // Re-open so the backend sees the new ref state cleanly.
    let (backend, handle) = tr.open_with_backend();
    let files = backend.list_files_at_rev(&handle.id, "feature").unwrap();
    let mut paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, vec!["README.md", "feature.txt"]);

    let content = backend
        .read_file_content_at_rev(&handle.id, "feature", Path::new("feature.txt"))
        .unwrap()
        .expect("feature.txt exists on feature");
    assert_eq!(content.text.as_deref(), Some("on feature\n"));
}

/// An unresolvable revspec yields InvalidRef.
#[test]
fn rejects_unknown_revspec() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .list_files_at_rev(&handle.id, "no-such-ref")
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");

    let err = backend
        .read_file_content_at_rev(&handle.id, "no-such-ref", Path::new("README.md"))
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

/// A binary (non-UTF8) blob comes back flagged binary with no text — locking in
/// the non-UTF8 branch of read_file_content_at_rev.
#[test]
fn reads_binary_blob_at_revision() {
    use std::fs;

    let tr = TempRepo::with_initial_commit("v1\n");
    // Write bytes containing a NUL — invalid UTF-8, so git2 treats it as binary.
    fs::write(tr.path().join("blob.bin"), [0u8, 1, 2, 0, 255, 0xfe]).expect("write binary");
    tr.commit_all("add binary blob");
    let (backend, handle) = tr.open_with_backend();

    let content = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new("blob.bin"))
        .unwrap()
        .expect("blob.bin exists at HEAD");
    assert!(content.binary, "expected binary flag set");
    assert_eq!(content.text, None);
}

/// A path that doesn't exist in the tree is `Ok(None)`, NOT an error (#146).
///
/// Every caller is a diff surface reading the OTHER side of a file it is already
/// rendering, so an added file having no old side is the routine case. While this
/// answered `InvalidPath`, the frontend's shared `invoke` wrapper logged one ERROR
/// line per absent side — seven in the v0.0.11 report, from a single commit's
/// syntax prefetch.
#[test]
fn missing_path_in_tree_is_absent_not_an_error() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new("nope.txt"))
        .expect("absence must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

/// ...but a GENUINE failure still errors. The two must stay distinguishable, or
/// making absence quiet would also silence a real problem.
#[test]
fn a_bad_revspec_still_errors_while_absence_does_not() {
    let tr = TempRepo::with_initial_commit("hi\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .read_file_content_at_rev(&handle.id, "no-such-ref", Path::new("nope.txt"))
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}
