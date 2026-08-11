//! An untracked directory that is itself a git repository — a dependency
//! vendored with its own `.git`, a stray clone, a submodule someone forgot to
//! register — is not a file, and libgit2 will not recurse across its `.git`
//! boundary. It surfaces in status as a single entry with a trailing slash
//! (`vendor/lib/`), the UI rebuilds the same path without the slash, and every
//! file-shaped operation then either lies or corrupts:
//!
//! - `diff`         → a valid but empty FileDiff (blank panel, no error)
//! - `file_history` → 0 commits after a full revwalk (looks like "no history")
//! - `blame_file`   → "the path 'vendor' does not exist in the given tree"
//! - `stage`        → "invalid path" for the slashed form, and for the
//!                    SLASHLESS form a silent `160000` gitlink with no
//!                    `.gitmodules` entry, which no clone can resolve
//!
//! These tests pin the detection (real repo probe, not a trailing-slash guess),
//! the guards, and the batch semantics that keep "Stage all" usable.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::DiffKind;
use platypusgit_lib::git::GitBackend;

use support::TempRepo;

/// Create an untracked nested repository at `vendor/lib` **with a commit**.
///
/// The commit is the whole point: a nested repo with an unborn HEAD makes
/// `stage("vendor/lib")` fail on its own ("reference 'refs/heads/master' not
/// found"), which hides the dangerous case. A real vendored dependency always
/// has commits, and that is exactly when staging succeeds and writes a gitlink.
fn make_embedded_repo(tr: &TempRepo) {
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
}

/// Index entries as `(octal mode, path)` pairs, read straight from disk.
fn index_entries(tr: &TempRepo) -> Vec<(u32, String)> {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let index = repo.index().unwrap();
    index
        .iter()
        .map(|e| (e.mode, String::from_utf8_lossy(&e.path).to_string()))
        .collect()
}

/// No gitlink may reach the index — that is the corruption we are preventing.
fn assert_no_gitlink(tr: &TempRepo) {
    let entries = index_entries(tr);
    assert!(
        !entries.iter().any(|(mode, _)| *mode == 0o160000),
        "a 160000 gitlink reached the index: {entries:?}",
    );
}

// ─── Detection ───────────────────────────────────────────────────────────────

#[test]
fn status_flags_the_embedded_repo_and_nothing_else() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);
    // A plain untracked directory — same shape, no `.git`. Must NOT be flagged.
    std::fs::create_dir_all(tr.path().join("plaindir")).unwrap();
    std::fs::write(tr.path().join("plaindir/a.txt"), "a\n").unwrap();

    let statuses = backend.status(&handle.id).unwrap();

    let embedded = statuses
        .iter()
        .find(|s| s.embedded)
        .expect("embedded entry should be flagged");
    assert_eq!(embedded.path, "vendor/lib/");

    // libgit2 recurses into the plain directory, so it shows up as its file.
    let plain = statuses
        .iter()
        .find(|s| s.path == "plaindir/a.txt")
        .expect("plain directory should be recursed into");
    assert!(!plain.embedded);

    assert_eq!(statuses.iter().filter(|s| s.embedded).count(), 1);
}

#[test]
fn list_all_files_flags_the_embedded_repo_too() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    let all = backend.list_all_files(&handle.id).unwrap();

    assert!(all.iter().any(|s| s.path == "vendor/lib/" && s.embedded));
    assert!(all.iter().any(|s| s.path == "README.md" && !s.embedded));
}

#[test]
fn a_registered_submodule_is_not_treated_as_embedded() {
    // A submodule's gitlink is intentional: staging and diffing it is a normal
    // pointer update and must keep working, even though the directory is a
    // repository of its own.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let sub_dir = tr.path().join("sub");
    std::fs::create_dir_all(&sub_dir).unwrap();
    let sub = git2::Repository::init(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("file.txt"), "one\n").unwrap();
    let mut sub_index = sub.index().unwrap();
    sub_index.add_path(Path::new("file.txt")).unwrap();
    sub_index.write().unwrap();
    let sub_tree = sub_index.write_tree().unwrap();
    let sub_tree = sub.find_tree(sub_tree).unwrap();
    let sig = git2::Signature::now("Vendor", "vendor@example.com").unwrap();
    let first = sub
        .commit(Some("HEAD"), &sig, &sig, "one", &sub_tree, &[])
        .unwrap();

    // Register it: gitlink in the index + a `.gitmodules` entry, then commit.
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        let mut index = repo.index().unwrap();
        index
            .add(&git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o160000,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: first,
                flags: 0,
                flags_extended: 0,
                path: b"sub".to_vec(),
            })
            .unwrap();
        std::fs::write(
            tr.path().join(".gitmodules"),
            "[submodule \"sub\"]\n\tpath = sub\n\turl = ./sub\n",
        )
        .unwrap();
        index.add_path(Path::new(".gitmodules")).unwrap();
        index.write().unwrap();
    }
    tr.commit_all("add submodule");

    // Move the submodule's HEAD so the parent sees a pointer change.
    let second = {
        std::fs::write(sub_dir.join("file.txt"), "two\n").unwrap();
        let mut sub_index = sub.index().unwrap();
        sub_index.add_path(Path::new("file.txt")).unwrap();
        sub_index.write().unwrap();
        let tree = sub_index.write_tree().unwrap();
        let tree = sub.find_tree(tree).unwrap();
        let head = sub.head().unwrap().peel_to_commit().unwrap();
        sub.commit(Some("HEAD"), &sig, &sig, "two", &tree, &[&head])
            .unwrap()
    };

    let statuses = backend.status(&handle.id).unwrap();
    let entry = statuses
        .iter()
        .find(|s| s.path == "sub")
        .expect("submodule pointer change should show in status");
    assert!(!entry.embedded, "a registered submodule is not embedded");

    // The whole point: the pointer update still stages.
    backend
        .stage(&handle.id, &[PathBuf::from("sub")])
        .expect("staging a submodule pointer update must keep working");
    assert!(index_entries(&tr)
        .iter()
        .any(|(mode, path)| *mode == 0o160000 && path == "sub"));
    let repo = git2::Repository::open(tr.path()).unwrap();
    let staged_id = repo.index().unwrap().get_path(Path::new("sub"), 0).unwrap().id;
    assert_eq!(staged_id, second, "gitlink should advance to the new commit");
}

// ─── Guards ──────────────────────────────────────────────────────────────────

#[test]
fn stage_rejects_both_the_slashed_and_slashless_forms() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    // The form `status()` reports.
    let err = backend
        .stage(&handle.id, &[PathBuf::from("vendor/lib/")])
        .unwrap_err();
    assert!(matches!(err, AppError::EmbeddedRepo(p) if p == "vendor/lib/"));

    // The form the file tree rebuilds — this one used to succeed silently.
    let err = backend
        .stage(&handle.id, &[PathBuf::from("vendor/lib")])
        .unwrap_err();
    assert!(matches!(err, AppError::EmbeddedRepo(p) if p == "vendor/lib"));

    assert_no_gitlink(&tr);
}

#[test]
fn diff_rejects_the_embedded_repo_instead_of_returning_an_empty_diff() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    for path in ["vendor/lib/", "vendor/lib"] {
        let err = backend
            .diff(&handle.id, &PathBuf::from(path), DiffKind::WorktreeToHead, 3, false)
            .unwrap_err();
        assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
    }
}

#[test]
fn blame_rejects_the_embedded_repo() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    for path in ["vendor/lib/", "vendor/lib"] {
        let err = backend.blame_file(&handle.id, &PathBuf::from(path)).unwrap_err();
        assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
    }
}

#[test]
fn file_history_rejects_the_embedded_repo_instead_of_returning_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    for path in ["vendor/lib/", "vendor/lib"] {
        let err = backend
            .file_history(&handle.id, &PathBuf::from(path), 50)
            .unwrap_err();
        assert!(matches!(err, AppError::EmbeddedRepo(p) if p == path));
    }
}

#[test]
fn guards_leave_ordinary_paths_alone() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);
    support::fs::write_file(tr.path(), "README.md", "hello\nworld\n");

    let readme = PathBuf::from("README.md");
    assert!(backend
        .diff(&handle.id, &readme, DiffKind::WorktreeToHead, 3, false)
        .is_ok());
    assert!(backend.blame_file(&handle.id, &readme).is_ok());
    assert_eq!(
        backend.file_history(&handle.id, &readme, 50).unwrap().len(),
        1
    );
    assert!(backend.stage(&handle.id, &[readme]).is_ok());
}

// ─── Batch semantics ─────────────────────────────────────────────────────────

#[test]
fn a_mixed_batch_stages_the_rest_and_skips_the_embedded_repo() {
    // "Stage all" hands over every unstaged path verbatim, trailing slash
    // included. One vendored repo must not block the whole batch.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);
    support::fs::write_file(tr.path(), "a.txt", "a\n");
    support::fs::write_file(tr.path(), "b.txt", "b\n");

    backend
        .stage(
            &handle.id,
            &[
                PathBuf::from("a.txt"),
                PathBuf::from("vendor/lib/"),
                PathBuf::from("b.txt"),
            ],
        )
        .expect("the non-embedded paths should still stage");

    let entries = index_entries(&tr);
    let paths: Vec<&str> = entries.iter().map(|(_, p)| p.as_str()).collect();
    assert!(paths.contains(&"a.txt"));
    assert!(paths.contains(&"b.txt"));
    assert!(!paths.iter().any(|p| p.starts_with("vendor/")));
    assert_no_gitlink(&tr);
}

#[test]
fn an_all_embedded_batch_errors() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    let err = backend
        .stage(
            &handle.id,
            &[PathBuf::from("vendor/lib/"), PathBuf::from("vendor/lib")],
        )
        .unwrap_err();
    assert!(matches!(err, AppError::EmbeddedRepo(_)));
    assert_no_gitlink(&tr);
}

// ─── Recovery ────────────────────────────────────────────────────────────────

#[test]
fn unstage_still_removes_an_already_committed_gitlink() {
    // `unstage` is deliberately NOT guarded: once a gitlink is in the index
    // (staged by an older build, or by the command line), unstaging it is the
    // only way back — a guard there would trap the user.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    make_embedded_repo(&tr);

    // Plant the gitlink the way a pre-fix build would have.
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("vendor/lib")).unwrap();
        index.write().unwrap();
    }
    assert!(index_entries(&tr)
        .iter()
        .any(|(mode, path)| *mode == 0o160000 && path == "vendor/lib"));

    // Status now reports it slashless and staged — and still flags it embedded.
    let entry = backend
        .status(&handle.id)
        .unwrap()
        .into_iter()
        .find(|s| s.path == "vendor/lib")
        .expect("staged gitlink should show in status");
    assert!(entry.embedded);

    backend
        .unstage(&handle.id, &[PathBuf::from("vendor/lib")])
        .expect("unstage must stay available as the escape hatch");
    assert_no_gitlink(&tr);
}
