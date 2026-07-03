mod support;

use std::path::PathBuf;

use platypusgit_lib::git::GitBackend;
use platypusgit_lib::git::types::CommitOptions;

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

#[test]
fn commit_from_staged_changes_advances_head() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    let oid = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .expect("commit");

    assert_eq!(oid.len(), 40);
    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log.len(), 2, "should have initial + new commit");
    assert_eq!(log[0].summary, "update readme");
}

#[test]
fn amend_replaces_tip() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "oops".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    write_file(tr.path(), "README.md", "hello world, again\n");
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: true,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log.len(), 2, "amend must not add a new commit");
    assert_eq!(log[0].summary, "update readme");
}

#[test]
fn commit_with_signoff_appends_trailer_from_repo_identity() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: false,
                author_override: None,
                signoff: true,
            },
        )
        .expect("commit");

    // TempRepo configures user.name "Test User" / user.email "test@example.com".
    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let msg = tip.message().unwrap();
    assert_eq!(
        msg,
        "update readme\n\nSigned-off-by: Test User <test@example.com>"
    );
}

#[test]
fn commit_signoff_does_not_duplicate_existing_trailer() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme\n\nSigned-off-by: Test User <test@example.com>"
                    .into(),
                amend: false,
                author_override: None,
                signoff: true,
            },
        )
        .expect("commit");

    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let msg = tip.message().unwrap();
    assert_eq!(msg.matches("Signed-off-by:").count(), 1);
}

#[test]
fn commit_without_signoff_leaves_message_untouched() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello world\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "update readme".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .expect("commit");

    let tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.message().unwrap(), "update readme");
}

#[test]
fn commit_on_unborn_branch_creates_root() {
    let tr = TempRepo::fresh();
    write_file(tr.path(), "README.md", "new repo\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .unwrap();

    backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "initial".into(),
                amend: false,
                author_override: None,
                signoff: false,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, None, 10).unwrap();
    assert_eq!(log.len(), 1);
    assert!(log[0].parents.is_empty());
}
