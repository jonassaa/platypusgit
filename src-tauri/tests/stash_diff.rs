//! `stash_diff` — "what did this stash change" (#133).
//!
//! The bug this replaces diffed the stash against *current* HEAD, so it mixed
//! the stashed changes with everything landed since, and it did so backwards.
//! Both are pinned here.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::{
    types::{DiffLineKind, StashSaveOptions},
    GitBackend,
};
use support::fs::write_file;
use support::TempRepo;

fn opts(message: &str, untracked: bool) -> StashSaveOptions {
    StashSaveOptions {
        message: Some(message.into()),
        include_untracked: untracked,
        keep_index: false,
    }
}

#[test]
fn diffs_the_stash_against_its_own_parent_not_current_head() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "stashed change\n");
    backend.stash_save(&handle.id, opts("wip", false)).unwrap();

    // Land something AFTER the stash. Diffing against HEAD (the old behaviour)
    // would drag this in; diffing against the stash's own first parent cannot.
    write_file(tr.path(), "later.txt", "landed after the stash\n");
    tr.commit_all("later");

    let stash = backend.stashes(&handle.id).unwrap().remove(0);
    let files = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, true)
        .unwrap();

    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["README.md"], "only the stash's own change");
}

#[test]
fn direction_is_parent_to_stash_so_stashed_work_reads_as_additions() {
    let tr = TempRepo::with_initial_commit("one\n");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "one\ntwo\n");
    backend.stash_save(&handle.id, opts("wip", false)).unwrap();

    let stash = backend.stashes(&handle.id).unwrap().remove(0);
    let files = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, false)
        .unwrap();

    let lines: Vec<(&str, String)> = files[0]
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| {
            let kind = match l.kind {
                DiffLineKind::Addition => "+",
                DiffLineKind::Deletion => "-",
                DiffLineKind::Context => " ",
                DiffLineKind::HunkHeader => "@",
            };
            (kind, l.content.trim_end().to_string())
        })
        .collect();
    assert!(
        lines.iter().any(|(k, c)| *k == "+" && c == "two"),
        "the stashed line must be an addition, got: {lines:?}"
    );
    assert!(
        !lines.iter().any(|(k, c)| *k == "-" && c == "two"),
        "reversed direction — the stash is the TO side, got: {lines:?}"
    );
}

#[test]
fn untracked_files_ride_in_on_the_flag_and_stay_out_without_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "tracked edit\n");
    write_file(tr.path(), "brand-new.txt", "never seen by git\n");
    backend.stash_save(&handle.id, opts("wip -u", true)).unwrap();

    let stash = backend.stashes(&handle.id).unwrap().remove(0);
    assert!(stash.untracked, "the entry must report its third parent");

    let with = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, true)
        .unwrap();
    let mut with_paths: Vec<&str> = with.iter().map(|f| f.path.as_str()).collect();
    with_paths.sort_unstable();
    assert_eq!(with_paths, ["README.md", "brand-new.txt"]);

    let without = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, false)
        .unwrap();
    let without_paths: Vec<&str> = without.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(without_paths, ["README.md"]);
}

#[test]
fn the_flag_is_inert_on_an_entry_with_no_third_parent() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    write_file(tr.path(), "README.md", "tracked edit\n");
    backend.stash_save(&handle.id, opts("wip", false)).unwrap();

    let stash = backend.stashes(&handle.id).unwrap().remove(0);
    assert!(!stash.untracked);

    let with = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, true)
        .unwrap();
    let without = backend
        .stash_diff(&handle.id, &stash.oid, 3, false, false)
        .unwrap();
    assert_eq!(with.len(), without.len());
    assert_eq!(with.len(), 1);
}

#[test]
fn a_root_commit_has_no_parent_and_is_refused_as_a_stash() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // The initial commit is a real commit with no first parent — exactly what a
    // stale oid or a hand-typed revspec could hand us.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let err = backend
        .stash_diff(&handle.id, &head.id().to_string(), 3, false, false)
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

#[test]
fn garbage_is_invalid_ref_not_a_stringified_libgit2_message() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .stash_diff(&handle.id, "not-a-rev", 3, false, false)
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}
