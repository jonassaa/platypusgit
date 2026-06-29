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

use platypusgit_lib::git::types::{CommitOptions, ResetMode};

#[test]
fn reset_hard_moves_head_and_cleans_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");

    // Make a second commit using a fresh backend session.
    let oid_second;
    {
        let (backend, handle) = tr.open_with_backend();
        write_file(tr.path(), "README.md", "hello world\n");
        backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
        oid_second = backend
            .commit(
                &handle.id,
                CommitOptions {
                    message: "second".into(),
                    amend: false,
                    author_override: None,
                    signoff: false,
                },
            )
            .unwrap();
    }
    let _ = oid_second;

    // Re-open and reset back to the first commit.
    let (backend, handle) = tr.open_with_backend();
    let log = backend.log(&handle.id, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Hard).expect("reset --hard");

    let log = backend.log(&handle.id, 10).unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
}

#[test]
fn reset_soft_keeps_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "hello world\n");
    backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "second".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Soft).expect("reset --soft");

    // Worktree untouched
    assert_eq!(read_file(tr.path(), "README.md"), "hello world\n");
}
