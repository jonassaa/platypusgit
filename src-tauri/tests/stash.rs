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
