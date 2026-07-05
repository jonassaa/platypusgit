mod support;

use std::path::PathBuf;

use platypusgit_lib::git::{types::CommitOptions, GitBackend};
use support::{fs::{read_file, write_file}, TempRepo};

#[test]
fn cherry_pick_applies_commit_onto_head() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Create branch `feature`, commit a change there, go back to main.
    backend.create_branch(&handle.id, "feature", None).unwrap();
    backend.checkout_branch(&handle.id, "feature").unwrap();
    write_file(tr.path(), "NOTES.md", "hello notes\n");
    backend.stage(&handle.id, &[PathBuf::from("NOTES.md")]).unwrap();
    let feature_oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "add notes".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    backend.checkout_branch(&handle.id, "main").unwrap();
    assert!(!tr.path().join("NOTES.md").exists());

    backend.cherry_pick(&handle.id, &feature_oid).unwrap();

    assert_eq!(read_file(tr.path(), "NOTES.md"), "hello notes\n");
    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log[0].summary, "add notes");
}

#[test]
fn revert_undoes_commit() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "README.md", "hello world\n");
    backend.stage(&handle.id, &[PathBuf::from("README.md")]).unwrap();
    let bad_oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "bad change".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    backend.revert(&handle.id, &bad_oid).unwrap();

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    let log = backend.log(&handle.id, None, 10).unwrap();
    assert!(log[0].summary.to_lowercase().contains("revert"));
}
