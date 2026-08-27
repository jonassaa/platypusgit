//! Deleting untracked files from the working tree (#245).
//!
//! `discard` and `delete_untracked` both remove an untracked file, and that is
//! where the resemblance stops: discard RESTORES a tracked path from the index,
//! and delete must refuse one. These pin that split, the containment boundary
//! (`opener::resolved_workdir_path` — its own path arithmetic is unit-tested in
//! `tests/opener.rs`), and the two-phase batch: validation refusals delete
//! nothing at all, I/O failures are reported per path while their neighbours
//! still go.

mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;
use support::{fs::write_file, with_conflicting_merge, TempRepo};

fn rel(paths: &[&str]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

// ─── The happy path ─────────────────────────────────────────────────────────

#[test]
fn deletes_an_untracked_file() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "loose.txt", "scratch\n");
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["loose.txt"]))
        .expect("delete an untracked file");

    assert!(failed.is_empty(), "unexpected failures: {failed:?}");
    assert!(!tr.path().join("loose.txt").exists(), "file survived");
}

#[test]
fn deletes_a_whole_batch_of_untracked_files() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "a.tmp", "a");
    write_file(tr.path(), "nested/b.tmp", "b");
    write_file(tr.path(), "nested/deep/c.tmp", "c");
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["a.tmp", "nested/b.tmp", "nested/deep/c.tmp"]))
        .expect("delete a batch");

    assert!(failed.is_empty(), "unexpected failures: {failed:?}");
    assert!(!tr.path().join("a.tmp").exists());
    assert!(!tr.path().join("nested/b.tmp").exists());
    assert!(!tr.path().join("nested/deep/c.tmp").exists());
    // Directories are git's business, not ours: it does not track them, so an
    // emptied one is left where it is rather than silently pruned.
    assert!(tr.path().join("nested/deep").is_dir());
}

#[test]
fn an_empty_batch_does_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    assert!(backend
        .delete_untracked(&handle.id, &[])
        .expect("empty batch")
        .is_empty());
}

// ─── Untracked ONLY ─────────────────────────────────────────────────────────

#[test]
fn refuses_a_tracked_file() {
    // The point of the whole command: "Delete" must never quietly become
    // "restore from the index", which is what discard does for a tracked path.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .delete_untracked(&handle.id, &rel(&["README.md"]))
        .expect_err("a tracked file must be refused");

    assert!(matches!(err, AppError::InvalidPath(_)), "wrong error: {err:?}");
    assert!(format!("{err}").contains("tracked"), "unhelpful message: {err}");
    assert!(tr.path().join("README.md").exists(), "tracked file deleted");
}

#[test]
fn refuses_a_tracked_file_with_local_modifications() {
    // The row a user is most likely to right-click: modified, unstaged, and
    // still recoverable from the index.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "edited\n");
    let (backend, handle) = tr.open_with_backend();

    assert!(backend
        .delete_untracked(&handle.id, &rel(&["README.md"]))
        .is_err());
    assert!(tr.path().join("README.md").exists());
}

#[test]
fn refuses_a_staged_new_file() {
    // Staged-but-never-committed: no copy in HISTORY, but the index has one, so
    // it is tracked and delete is the wrong verb for it.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "fresh.txt", "new\n");
    let (backend, handle) = tr.open_with_backend();
    backend.stage(&handle.id, &rel(&["fresh.txt"])).unwrap();

    assert!(backend
        .delete_untracked(&handle.id, &rel(&["fresh.txt"]))
        .is_err());
    assert!(tr.path().join("fresh.txt").exists());
}

#[test]
fn refuses_a_conflicted_file() {
    // A conflicted path has index entries at stages 1/2/3 and NONE at stage 0,
    // so a stage-0-only tracked check reads it as untracked — and deleting it
    // would destroy a merge in progress.
    let tr = with_conflicting_merge();
    let (backend, handle) = tr.open_with_backend();

    assert!(backend
        .delete_untracked(&handle.id, &rel(&["README.md"]))
        .is_err());
    assert!(tr.path().join("README.md").exists());
}

#[test]
fn refuses_a_directory_that_holds_tracked_files() {
    // `src` is never its own index entry, so "absent from the index" must not be
    // read as "untracked" for a directory — that reading would delete every
    // tracked file beneath it.
    let tr = TempRepo::fresh();
    write_file(tr.path(), "src/main.rs", "fn main() {}\n");
    tr.commit_all("add src");
    let (backend, handle) = tr.open_with_backend();

    assert!(backend.delete_untracked(&handle.id, &rel(&["src"])).is_err());
    assert!(tr.path().join("src/main.rs").exists());
}

#[test]
fn refuses_a_directory_of_untracked_files() {
    // Nothing in the index at all, so the tracked check passes — the directory
    // refusal is what stops this. Delete removes files; a recursive tree delete
    // is a different and far more dangerous operation, and libgit2 reports
    // untracked directories as their individual files anyway.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "scratch/a.txt", "a");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .delete_untracked(&handle.id, &rel(&["scratch"]))
        .expect_err("a directory must be refused");

    assert!(format!("{err}").contains("directory"), "unhelpful: {err}");
    assert!(tr.path().join("scratch/a.txt").exists());
}

#[test]
fn refuses_an_embedded_repository() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let nested = tr.path().join("vendor/lib");
    std::fs::create_dir_all(&nested).unwrap();
    git2::Repository::init(&nested).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .delete_untracked(&handle.id, &rel(&["vendor/lib"]))
        .expect_err("an embedded repo must be refused");

    assert!(
        matches!(err, AppError::EmbeddedRepo(_)),
        "wrong error: {err:?}"
    );
    assert!(nested.join(".git").exists(), "embedded repo destroyed");
}

// ─── Containment ────────────────────────────────────────────────────────────

#[test]
fn refuses_a_parent_dir_escape() {
    let tr = TempRepo::with_initial_commit("hello\n");
    // A sibling of the repo, so `..` genuinely reaches it.
    let outside = tr.path().parent().unwrap().join("pg-outside-target.txt");
    std::fs::write(&outside, "secret").unwrap();
    let (backend, handle) = tr.open_with_backend();

    let escape = format!("../{}", outside.file_name().unwrap().to_string_lossy());
    let err = backend
        .delete_untracked(&handle.id, &rel(&[&escape]))
        .expect_err("../ must be refused");

    assert!(matches!(err, AppError::InvalidPath(_)), "wrong error: {err:?}");
    assert!(outside.exists(), "deleted a file outside the repository");
    let _ = std::fs::remove_file(&outside);
}

#[test]
fn refuses_an_absolute_path_outside_the_workdir() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    std::fs::write(&target, "secret").unwrap();
    let (backend, handle) = tr.open_with_backend();

    let abs = target.to_string_lossy().to_string();
    assert!(backend.delete_untracked(&handle.id, &rel(&[&abs])).is_err());
    assert!(target.exists(), "deleted a file outside the repository");
}

#[cfg(unix)]
#[test]
fn refuses_a_symlink_that_points_out_of_the_tree() {
    // No `..`, not absolute: the lexical check cannot see this one, which is why
    // the resolution canonicalizes.
    let tr = TempRepo::with_initial_commit("hello\n");
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    std::fs::write(&target, "secret").unwrap();
    std::os::unix::fs::symlink(&target, tr.path().join("escape")).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .delete_untracked(&handle.id, &rel(&["escape"]))
        .expect_err("an escaping symlink must be refused");

    assert!(matches!(err, AppError::InvalidPath(_)), "wrong error: {err:?}");
    assert!(target.exists(), "the symlink's target was deleted");
    assert!(
        tr.path().join("escape").symlink_metadata().is_ok(),
        "the link itself was deleted"
    );
}

#[cfg(unix)]
#[test]
fn refuses_a_path_reached_through_a_symlinked_directory() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    std::fs::write(&target, "secret").unwrap();
    std::os::unix::fs::symlink(outside.path(), tr.path().join("out")).unwrap();
    let (backend, handle) = tr.open_with_backend();

    assert!(backend
        .delete_untracked(&handle.id, &rel(&["out/secret.txt"]))
        .is_err());
    assert!(target.exists(), "deleted through a symlinked directory");
}

#[cfg(unix)]
#[test]
fn deletes_a_symlink_that_stays_inside_the_tree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "real.txt", "r");
    std::os::unix::fs::symlink(tr.path().join("real.txt"), tr.path().join("alias")).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["alias"]))
        .expect("a contained link is deletable");

    assert!(failed.is_empty(), "unexpected failures: {failed:?}");
    assert!(tr.path().join("alias").symlink_metadata().is_err(), "link survived");
    // Unlinking a link never touches what it points at.
    assert!(tr.path().join("real.txt").exists(), "target deleted with the link");
}

// ─── The two phases ─────────────────────────────────────────────────────────

#[test]
fn a_validation_refusal_deletes_nothing_from_the_batch() {
    // The reason validation is a separate pass. A crafted or mistaken path must
    // not be discoverable by noticing that the files listed before it are gone.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "first.tmp", "1");
    write_file(tr.path(), "second.tmp", "2");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .delete_untracked(
            &handle.id,
            &rel(&["first.tmp", "README.md", "second.tmp"]),
        )
        .expect_err("a tracked path in the batch must refuse the batch");

    assert!(matches!(err, AppError::InvalidPath(_)), "wrong error: {err:?}");
    assert!(tr.path().join("first.tmp").exists(), "deleted a prefix of the batch");
    assert!(tr.path().join("second.tmp").exists());
    assert!(tr.path().join("README.md").exists());
}

#[test]
fn reports_a_missing_file_and_still_deletes_its_neighbours() {
    // Best-effort once unlinking starts: a stale selection (something a build
    // script already removed) must not cost the user the files that ARE there.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "here.tmp", "h");
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["here.tmp", "gone.tmp"]))
        .expect("best-effort deletes what it can");

    assert_eq!(failed.len(), 1, "expected one failure: {failed:?}");
    // The path the CALLER spelled — the file list has no row for a canonicalized
    // absolute path.
    assert_eq!(failed[0].path, "gone.tmp");
    assert!(!failed[0].reason.is_empty(), "no reason given");
    assert!(!tr.path().join("here.tmp").exists(), "neighbour not deleted");
}

#[test]
fn a_missing_file_on_its_own_is_reported_not_silently_ok() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["never-existed.tmp"]))
        .expect("resolution succeeds; the unlink is what fails");

    assert_eq!(failed.len(), 1, "a missing file must be reported: {failed:?}");
    assert_eq!(failed[0].path, "never-existed.tmp");
}

#[cfg(unix)]
#[test]
fn reports_a_file_the_os_refuses_and_still_deletes_the_rest() {
    use std::os::unix::fs::PermissionsExt;

    // A read-ONLY file is still deletable on unix (the directory's write bit is
    // what governs), so the way to make one genuinely unremovable is to take the
    // write bit off its DIRECTORY.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "locked/inside.tmp", "x");
    write_file(tr.path(), "free.tmp", "y");
    let locked = tr.path().join("locked");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
    let (backend, handle) = tr.open_with_backend();

    let failed = backend
        .delete_untracked(&handle.id, &rel(&["locked/inside.tmp", "free.tmp"]));

    // Restore the bit before asserting, or the TempDir cannot clean itself up.
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
    let failed = failed.expect("best-effort deletes what it can");

    assert_eq!(failed.len(), 1, "expected one failure: {failed:?}");
    assert_eq!(failed[0].path, "locked/inside.tmp");
    assert!(!tr.path().join("free.tmp").exists(), "neighbour not deleted");
    assert!(locked.join("inside.tmp").exists(), "the locked file went anyway");
}
