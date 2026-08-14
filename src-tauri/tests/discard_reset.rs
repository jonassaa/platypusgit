mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;
use support::{fs::{read_file, write_file}, with_conflicting_merge, TempRepo};

/// A conflicted path has index entries at stages 1/2/3 and NONE at stage 0, so
/// a stage-0-only tracked check misreads it as untracked — and discard's
/// untracked branch deletes the file outright. Discarding a conflicted file must
/// restore a tracked version, never remove the user's merge in progress.
#[test]
fn discard_restores_a_conflicted_file_instead_of_deleting_it() {
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("README.md")])
        .expect("discard a conflicted path");

    assert!(
        tr.path().join("README.md").exists(),
        "discard deleted a conflicted file instead of restoring it"
    );
    // Restoring a conflicted path re-materializes the conflict from the index
    // stages, which is `git checkout --merge` semantics: the user's edits are
    // thrown away and the merge they still have to resolve comes back. Both
    // sides must survive.
    let restored = read_file(tr.path(), "README.md");
    assert!(restored.contains("main branch content"), "ours missing: {restored:?}");
    assert!(
        restored.contains("feature branch content"),
        "theirs missing: {restored:?}"
    );
    assert!(restored.contains("<<<<<<<"), "no conflict markers: {restored:?}");
}

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

// ─── Untracked paths ─────────────────────────────────────────────────────────
//
// `checkout_index` can only restore paths that have an index entry, so an
// untracked path used to report `Ok(())` while nothing happened — a danger op
// whose confirm dialog says "the changes will be lost" and then loses nothing.

#[test]
fn discard_deletes_an_untracked_file() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "loose.txt", "scratch\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("loose.txt")])
        .expect("discard");

    assert!(
        !tr.path().join("loose.txt").exists(),
        "an untracked file must be deleted, not silently left in place",
    );
    assert!(backend.status(&handle.id).unwrap().is_empty());
}

#[test]
fn discard_deletes_an_untracked_file_in_a_nested_directory() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a/b/loose.txt", "scratch\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("a/b/loose.txt")])
        .expect("discard");

    assert!(!tr.path().join("a/b/loose.txt").exists());
}

#[test]
fn discard_deletes_an_untracked_directory() {
    // Not reachable from the tree today (status recurses untracked dirs), but
    // the delete path must not silently no-op if a directory ever arrives.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "scratch/a.txt", "a\n");
    write_file(tr.path(), "scratch/nested/b.txt", "b\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("scratch")])
        .expect("discard");

    assert!(!tr.path().join("scratch").exists());
}

#[test]
fn discard_on_a_directory_holding_tracked_files_restores_instead_of_deleting() {
    // A directory has no index entry of its own, so "not in the index" must
    // NOT be read as "untracked" — deleting `src/` because `src` itself isn't
    // an index entry would wipe every tracked file under it.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "src/a.txt", "a\n");
    tr.commit_all("add src");
    write_file(tr.path(), "src/a.txt", "clobbered\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(&handle.id, &[PathBuf::from("src")])
        .expect("discard");

    assert!(tr.path().join("src/a.txt").exists(), "tracked file must survive");
    assert_eq!(read_file(tr.path(), "src/a.txt"), "a\n");
}

#[test]
fn discard_handles_a_mixed_tracked_and_untracked_batch() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "this is wrong\n");
    write_file(tr.path(), "loose.txt", "scratch\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(
            &handle.id,
            &[PathBuf::from("README.md"), PathBuf::from("loose.txt")],
        )
        .expect("discard");

    assert_eq!(read_file(tr.path(), "README.md"), "hello\n");
    assert!(!tr.path().join("loose.txt").exists());
}

#[test]
fn discard_keeps_a_staged_new_file_that_is_still_in_the_index() {
    // Staged-but-never-committed: it HAS an index entry, so discarding the
    // worktree change restores it from the index rather than deleting it.
    // Removing the file here would destroy staged content.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "new.txt", "staged\n");
    backend.stage(&handle.id, &[PathBuf::from("new.txt")]).unwrap();
    write_file(tr.path(), "new.txt", "then edited\n");

    backend
        .discard(&handle.id, &[PathBuf::from("new.txt")])
        .expect("discard");

    assert_eq!(read_file(tr.path(), "new.txt"), "staged\n");
}

#[test]
fn discard_refuses_an_embedded_repo_instead_of_deleting_it() {
    // `rm -rf` on a nested repository would destroy commits git cannot
    // recover. The UI keeps embedded rows out of discard batches; the backend
    // must refuse them too now that discard deletes untracked paths.
    let tr = TempRepo::with_initial_commit("hello\n");
    let nested_dir = tr.path().join("vendor/lib");
    std::fs::create_dir_all(&nested_dir).unwrap();
    let nested = git2::Repository::init(&nested_dir).unwrap();
    std::fs::write(nested_dir.join("file.txt"), "vendored\n").unwrap();
    let mut index = nested.index().unwrap();
    index.add_path(Path::new("file.txt")).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = nested.find_tree(tree_oid).unwrap();
    let sig = git2::Signature::now("Vendor", "vendor@example.com").unwrap();
    nested
        .commit(Some("HEAD"), &sig, &sig, "vendored code", &tree, &[])
        .unwrap();

    let (backend, handle) = tr.open_with_backend();

    for path in ["vendor/lib/", "vendor/lib"] {
        let err = backend
            .discard(&handle.id, &[PathBuf::from(path)])
            .unwrap_err();
        assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
    }
    assert!(nested_dir.join("file.txt").exists());
}

#[test]
fn discard_skips_an_embedded_repo_but_still_discards_the_rest() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let nested_dir = tr.path().join("vendor/lib");
    std::fs::create_dir_all(&nested_dir).unwrap();
    git2::Repository::init(&nested_dir).unwrap();
    std::fs::write(nested_dir.join("file.txt"), "vendored\n").unwrap();
    write_file(tr.path(), "loose.txt", "scratch\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard(
            &handle.id,
            &[PathBuf::from("vendor/lib/"), PathBuf::from("loose.txt")],
        )
        .expect("the non-embedded paths should still discard");

    assert!(!tr.path().join("loose.txt").exists());
    assert!(nested_dir.join("file.txt").exists());
}

#[test]
fn discard_rejects_a_path_that_escapes_the_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let outside = tr.path().parent().unwrap().join("outside.txt");
    std::fs::write(&outside, "not ours\n").unwrap();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .discard(&handle.id, &[PathBuf::from("../outside.txt")])
        .unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    assert!(outside.exists(), "a path outside the worktree must not be deleted");
    std::fs::remove_file(&outside).ok();
}

#[test]
fn discard_errors_on_a_path_that_is_neither_tracked_nor_present() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .discard(&handle.id, &[PathBuf::from("nope.txt")])
        .unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
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
                    sign: None,
                },
            )
            .unwrap();
    }
    let _ = oid_second;

    // Re-open and reset back to the first commit.
    let (backend, handle) = tr.open_with_backend();
    let log = backend.log(&handle.id, None, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Hard).expect("reset --hard");

    let log = backend.log(&handle.id, None, 10).unwrap();
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
                sign: None,
            },
        )
        .unwrap();

    let log = backend.log(&handle.id, None, 10).unwrap();
    let first = log[1].oid.clone();
    backend.reset(&handle.id, &first, ResetMode::Soft).expect("reset --soft");

    // Worktree untouched
    assert_eq!(read_file(tr.path(), "README.md"), "hello world\n");
}
