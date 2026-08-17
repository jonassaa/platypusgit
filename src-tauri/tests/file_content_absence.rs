//! "There is no text at this path" is a STATE for all three file-content
//! readers — a #146 follow-up.
//!
//! #151 made `read_file_content_at_rev` and `read_file_content_at_index` answer
//! `Ok(None)` for an absent path and documented that a `160000` submodule gitlink
//! "answers the same way". It did not: a gitlink's oid names a commit in the
//! SUBMODULE's object database, which the superproject does not hold, so
//!
//!   * `_at_rev` failed in `entry.to_object()` — BEFORE its `as_blob()` guard,
//!   * `_at_index` failed in `find_blob()`, having no non-blob guard at all, and
//!   * `read_file_content` failed in the same `to_object()` inside its HEAD
//!     fallback, never reaching the `InvalidPath` its docs described.
//!
//! All three answered `Git("object not found - no match for id (…)")`, once per
//! click on a submodule row — the exact noise class #146 exists to remove, in the
//! commands #151 rewrote. These tests pin every reader's answer against a real
//! submodule rather than against the docs.

mod support;

use std::path::Path;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoId, GitBackend};

use support::{fs::write_file, with_submodule, SubmoduleFixture, TempRepo};

/// A repository with `src/main.rs`, so a DIRECTORY exists in both the worktree
/// and HEAD's tree.
fn with_nested_file() -> TempRepo {
    let tr = TempRepo::with_initial_commit("v1\n");
    write_file(tr.path(), "src/main.rs", "fn main() {}\n");
    tr.commit_all("add nested file");
    tr
}

// ── The gitlink: one path, three readers, three separate failures ────────────

/// The Files screen lists a clean submodule (`list_all_files` reports it with
/// `submodule: true`, `embedded: false`) and clicking it reads the worktree copy
/// of a DIRECTORY.
#[test]
fn worktree_reader_answers_none_for_a_clean_submodule() {
    let fx = with_submodule();
    let (backend, handle) = fx.outer.open_with_backend();

    let out = backend
        .read_file_content(&handle.id, Path::new(SubmoduleFixture::SUB_PATH))
        .expect("a gitlink must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

/// The commit panel asks for the INDEX side of every row it renders, and a
/// gitlink DOES have a stage-0 entry (`160000 <oid> 0  vendor/inner`) — so the
/// `get_path(_, 0)` absence guard never fires and `find_blob` got the commit oid.
#[test]
fn index_reader_answers_none_for_a_submodule_gitlink() {
    let fx = with_submodule();
    let (backend, handle) = fx.outer.open_with_backend();

    let out = backend
        .read_file_content_at_index(&handle.id, Path::new(SubmoduleFixture::SUB_PATH))
        .expect("a gitlink must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

/// Every diff surface reads a `{ kind: "rev", rev: "HEAD" }` old side
/// unconditionally, so this fires for the same click as the two above.
#[test]
fn rev_reader_answers_none_for_a_submodule_gitlink() {
    let fx = with_submodule();
    let (backend, handle) = fx.outer.open_with_backend();

    let out = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new(SubmoduleFixture::SUB_PATH))
        .expect("a gitlink must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

// ── The worktree reader's other absences ────────────────────────────────────

/// A path that is in neither the worktree nor HEAD. `get_status` /
/// `list_all_files` are snapshots, so a file deleted between the listing and the
/// read is routine — and both diff-surface callers already fall back to plain
/// rows.
#[test]
fn worktree_reader_answers_none_for_an_absent_path() {
    let tr = TempRepo::with_initial_commit("v1\n");
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content(&handle.id, Path::new("nope.txt"))
        .expect("absence must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

/// A directory: not a file in the worktree, and a tree in HEAD. Same answer
/// `read_file_content_at_rev` already gave.
#[test]
fn worktree_reader_answers_none_for_a_directory() {
    let tr = with_nested_file();
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content(&handle.id, Path::new("src"))
        .expect("a directory must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

#[test]
fn rev_reader_answers_none_for_a_directory() {
    let tr = with_nested_file();
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content_at_rev(&handle.id, "HEAD", Path::new("src"))
        .expect("a directory must not be an error");
    assert!(out.is_none(), "expected None, got {out:?}");
}

// ── What must NOT go quiet along with absence ───────────────────────────────

/// The HEAD fallback is the reason `read_file_content` can colour a DELETED
/// file's removed lines. Absence answering `Ok(None)` must not swallow it.
#[test]
fn worktree_reader_still_falls_back_to_head_for_a_deleted_file() {
    let tr = TempRepo::with_initial_commit("committed\n");
    std::fs::remove_file(tr.path().join("README.md")).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let out = backend
        .read_file_content(&handle.id, Path::new("README.md"))
        .unwrap()
        .expect("a deleted file still has HEAD content");
    assert_eq!(out.text.as_deref(), Some("committed\n"));
    assert!(out.from_head, "the content came from HEAD, not the worktree");
}

/// A genuine failure still errors on the same op — otherwise quieting absence
/// would quiet real problems too.
#[test]
fn worktree_reader_still_errors_for_an_unknown_repo() {
    let err = Libgit2Backend::new()
        .read_file_content(&RepoId("never-opened".into()), Path::new("README.md"))
        .unwrap_err();
    assert!(matches!(err, AppError::UnknownRepo(_)), "got {err:?}");
}
