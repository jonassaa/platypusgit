mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

#[test]
fn stage_moves_worktree_change_to_index() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();

    let before = backend.status(&handle.id).unwrap();
    let readme_before = before.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        readme_before.worktree,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));

    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .expect("stage");

    let after = backend.status(&handle.id).unwrap();
    let readme_after = after.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        readme_after.index,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));
    assert!(matches!(
        readme_after.worktree,
        platypusgit_lib::git::types::StatusFlag::Unmodified
    ));
}

#[test]
fn stage_a_new_untracked_file_marks_it_added() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "docs/notes.md", "note\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("docs/notes.md")])
        .expect("stage");

    let after = backend.status(&handle.id).unwrap();
    let entry = after.iter().find(|f| f.path == "docs/notes.md").unwrap();
    assert!(matches!(
        entry.index,
        platypusgit_lib::git::types::StatusFlag::Added
    ));
}

#[test]
fn unstage_moves_index_change_back_to_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .unstage(&handle.id, &[PathBuf::from("README.md")])
        .expect("unstage");

    let after = backend.status(&handle.id).unwrap();
    let entry = after.iter().find(|f| f.path == "README.md").unwrap();
    assert!(matches!(
        entry.worktree,
        platypusgit_lib::git::types::StatusFlag::Modified
    ));
    assert!(matches!(
        entry.index,
        platypusgit_lib::git::types::StatusFlag::Unmodified
    ));
}
