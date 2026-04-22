mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;
use support::{fs::{read_file, write_file}, TempRepo};

#[test]
fn discard_restores_worktree_from_index() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "this is wrong\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("README.md")])
        .expect("discard");

    let contents = read_file(tr.path(), "README.md");
    assert_eq!(contents, "hello\n");
}
