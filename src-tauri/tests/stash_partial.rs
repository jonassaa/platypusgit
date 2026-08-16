//! `stash_save_paths` — stash a selection rather than the worktree (#133).

mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::fs::{read_file, write_file};
use support::TempRepo;

fn opts(message: &str, untracked: bool) -> StashSaveOptions {
    StashSaveOptions {
        message: Some(message.into()),
        include_untracked: untracked,
        keep_index: false,
    }
}

fn paths(list: &[&str]) -> Vec<PathBuf> {
    list.iter().map(PathBuf::from).collect()
}

#[test]
fn stashes_only_the_named_path_and_leaves_the_rest_dirty() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "other.txt", "original\n");
    tr.commit_all("add other");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "stash me\n");
    write_file(tr.path(), "other.txt", "leave me\n");

    let oid = backend
        .stash_save_paths(&handle.id, opts("just the readme", false), &paths(&["README.md"]))
        .unwrap();
    assert!(oid.is_some(), "an entry was created");

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n", "reverted");
    assert_eq!(
        read_file(tr.path(), "other.txt"),
        "leave me\n",
        "the unselected file is untouched"
    );

    let stashes = backend.stashes(&handle.id).unwrap();
    assert_eq!(stashes.len(), 1);
    // `git stash push -m X` writes `On <branch>: X`, exactly as the whole-tree
    // path already does — a partial stash is an ordinary entry.
    assert_eq!(stashes[0].message, "On main: just the readme");
    assert_eq!(stashes[0].oid, oid.unwrap());
}

#[test]
fn a_pathspec_that_matches_no_change_is_a_no_op_not_an_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "other.txt", "original\n");
    tr.commit_all("add other");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "dirty\n");

    // git prints "No local changes to save" and exits ZERO here, so the exit
    // status cannot answer "was an entry created". `refs/stash` can.
    let oid = backend
        .stash_save_paths(&handle.id, opts("nothing", false), &paths(&["other.txt"]))
        .unwrap();

    assert!(oid.is_none(), "no entry, and no error either");
    assert!(backend.stashes(&handle.id).unwrap().is_empty());
    assert_eq!(
        read_file(tr.path(), "README.md"),
        "dirty\n",
        "the dirty file the pathspec did not name is untouched"
    );
}

#[test]
fn an_untracked_path_needs_the_flag_and_works_with_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "brand-new.txt", "never seen by git\n");

    // Without `--include-untracked` git refuses the pathspec outright
    // ("did not match any file(s) known to git"), which is why the flag is
    // DERIVED from the selection rather than offered as a choice.
    let err = backend
        .stash_save_paths(
            &handle.id,
            opts("no flag", false),
            &paths(&["brand-new.txt"]),
        )
        .unwrap_err();
    assert!(matches!(err, AppError::Git(_)), "got {err:?}");
    assert!(tr.path().join("brand-new.txt").exists());

    let oid = backend
        .stash_save_paths(&handle.id, opts("with flag", true), &paths(&["brand-new.txt"]))
        .unwrap();
    assert!(oid.is_some());
    assert!(
        !tr.path().join("brand-new.txt").exists(),
        "the untracked file went into the stash"
    );
    assert!(
        backend.stashes(&handle.id).unwrap()[0].untracked,
        "and the entry reports its third parent"
    );
}

#[test]
fn a_mixed_selection_carries_both_kinds() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "keep.txt", "original\n");
    tr.commit_all("add keep");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "tracked edit\n");
    write_file(tr.path(), "brand-new.txt", "untracked\n");
    write_file(tr.path(), "keep.txt", "not selected\n");

    backend
        .stash_save_paths(
            &handle.id,
            opts("mixed", true),
            &paths(&["README.md", "brand-new.txt"]),
        )
        .unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    assert!(!tr.path().join("brand-new.txt").exists());
    assert_eq!(
        read_file(tr.path(), "keep.txt"),
        "not selected\n",
        "the unselected file stays dirty"
    );
}

#[test]
fn an_empty_path_list_is_refused_rather_than_stashing_everything() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");

    // `git stash push --` with no paths stashes the WHOLE worktree — a very
    // different and far more destructive command than the one asked for.
    let err = backend
        .stash_save_paths(&handle.id, opts("nope", false), &[])
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
    assert!(backend.stashes(&handle.id).unwrap().is_empty());
}

#[test]
fn a_path_beginning_with_a_dash_is_a_path_not_an_option() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "-f", "leading dash\n");

    // Reaches git only after the `--` separator; without it this parses as an
    // option. Untracked, so the flag comes along.
    backend
        .stash_save_paths(&handle.id, opts("dashy", true), &paths(&["-f"]))
        .unwrap();

    assert!(!tr.path().join("-f").exists());
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);
}

/// **`GIT_LITERAL_PATHSPECS` is load-bearing, not hygiene.**
///
/// git reads a leading `:` as pathspec MAGIC. A file honestly named
/// `:(exclude)weird.txt` — a legal POSIX filename, and a name `git status`
/// hands us verbatim — reaches `git stash push -- ':(exclude)weird.txt'` as
/// "everything EXCEPT weird.txt", so a request to stash one file stashes the
/// **entire worktree** instead. The `--` separator does not help: it ends
/// OPTION parsing, and everything after it is still parsed as a pathspec.
///
/// So the acceptance is the other files: they must still be dirty.
#[test]
fn a_pathspec_magic_filename_is_a_literal_path_not_an_exclusion() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "keep.txt", "original\n");
    tr.commit_all("add keep");
    let (backend, handle) = tr.open_with_backend();

    let magic = ":(exclude)weird.txt";
    write_file(tr.path(), magic, "magic name\n");
    write_file(tr.path(), "README.md", "dirty readme\n");
    write_file(tr.path(), "keep.txt", "dirty keep\n");

    backend
        .stash_save_paths(&handle.id, opts("just the magic one", true), &paths(&[magic]))
        .unwrap();

    // Without the env var this stashes everything and both assertions below
    // fail — which is exactly the regression this test exists to catch.
    assert!(
        !tr.path().join(magic).exists(),
        "the named file should have been stashed"
    );
    assert_eq!(
        read_file(tr.path(), "README.md"),
        "dirty readme\n",
        "an unnamed file must not be swept up by pathspec magic"
    );
    assert_eq!(read_file(tr.path(), "keep.txt"), "dirty keep\n");
}

#[test]
fn a_message_with_a_line_break_is_refused_before_git_runs() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");

    let err = backend
        .stash_save_paths(
            &handle.id,
            opts("two\nlines", false),
            &paths(&["README.md"]),
        )
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(backend.stashes(&handle.id).unwrap().is_empty());
}
