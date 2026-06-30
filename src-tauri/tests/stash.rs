mod support;

use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::fs::{read_file, write_file};
use support::TempRepo;

#[test]
fn stash_save_clears_worktree_and_records_entry() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty change\n");

    let oid = backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();
    assert!(oid.is_some());

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    let stashes = backend.stashes(&handle.id).unwrap();
    assert_eq!(stashes.len(), 1);
}

#[test]
fn stash_apply_restores_changes_and_keeps_stash() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();

    backend.stash_apply(&handle.id, 0).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);
}

#[test]
fn stash_pop_restores_and_drops() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();

    backend.stash_pop(&handle.id, 0).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
}

#[test]
fn stash_drop_removes_entry_without_applying() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "dirty\n");
    backend
        .stash_save(
            &handle.id,
            StashSaveOptions {
                message: Some("wip".into()),
                include_untracked: false,
                keep_index: false,
            },
        )
        .unwrap();

    backend.stash_drop(&handle.id, 0).unwrap();
    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
}
