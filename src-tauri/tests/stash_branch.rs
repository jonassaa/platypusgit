mod support;

use platypusgit_lib::git::{types::StashSaveOptions, GitBackend};
use support::fs::{read_file, write_file};
use support::TempRepo;

#[test]
fn stash_branch_creates_branch_applies_stash_and_drops_it() {
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
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 1);

    backend.stash_branch(&handle.id, 0, "from-stash").unwrap();

    let branches = backend.branches(&handle.id).unwrap();
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "from-stash");
    assert_eq!(backend.stashes(&handle.id).unwrap().len(), 0);
    assert_eq!(read_file(tr.path(), "README.md"), "dirty\n");
}
