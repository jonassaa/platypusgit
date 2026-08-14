//! git-LFS integration tests (#93).
//!
//! Two halves. The pointer/attribute logic is PURE and always runs — that is what
//! makes "a pointer diff must not look like a text diff" a checked property rather
//! than a hope. Anything that needs the real `git-lfs` binary is conditional on it
//! being installed (`lfs_installed`), because it is not present everywhere and a
//! test that only passes on machines that happen to have it is worse than one that
//! says so out loud.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::DiffKind;
use platypusgit_lib::git::GitBackend;
use support::{fs::write_file, lfs_installed, TempRepo};

const POINTER_V1: &str = "version https://git-lfs.github.com/spec/v1\n\
                          oid sha256:1111111111111111111111111111111111111111111111111111111111111111\n\
                          size 1048576\n";

const POINTER_V2: &str = "version https://git-lfs.github.com/spec/v1\n\
                          oid sha256:2222222222222222222222222222222222222222222222222222222222222222\n\
                          size 2097152\n";

/// A repo that declares LFS in `.gitattributes` and holds a committed pointer file.
/// No `git-lfs` needed: a pointer file is just text, and the app's detection is
/// deliberately independent of the binary.
fn lfs_repo() -> TempRepo {
    let tr = TempRepo::with_initial_commit("readme\n");
    write_file(
        tr.path(),
        ".gitattributes",
        "*.psd filter=lfs diff=lfs merge=lfs -text\n*.md text\n",
    );
    write_file(tr.path(), "art/asset.psd", POINTER_V1);
    tr.commit_all("track psd with lfs");
    tr
}

#[test]
fn a_repo_with_lfs_attributes_reports_in_use_with_its_patterns() {
    let tr = lfs_repo();
    let (backend, handle) = tr.open_with_backend();

    let status = backend.lfs_status(&handle.id).expect("lfs_status");
    assert!(status.in_use, "filter=lfs in .gitattributes means in use");
    assert_eq!(status.patterns, ["*.psd"], "only the lfs-filtered pattern");
    // The whole point of computing `in_use` ourselves: it is answerable with the
    // binary absent, which is exactly when the user needs to be told.
    assert_eq!(status.installed, lfs_installed());
    if !status.installed {
        assert!(status.version.is_none());
        assert!(status.files.is_empty());
    }
}

#[test]
fn a_repo_without_lfs_attributes_reports_not_in_use() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let status = backend.lfs_status(&handle.id).expect("lfs_status");
    assert!(!status.in_use);
    assert!(status.patterns.is_empty());
}

#[test]
fn attributes_in_a_subdirectory_are_found_too() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(
        tr.path(),
        "assets/.gitattributes",
        "*.bin filter=lfs -text\n",
    );
    tr.commit_all("nested attributes");
    let (backend, handle) = tr.open_with_backend();

    // Sourced from the INDEX, so a nested `.gitattributes` is found without a
    // recursive worktree walk.
    let status = backend.lfs_status(&handle.id).expect("lfs_status");
    assert!(status.in_use);
    assert_eq!(status.patterns, ["*.bin"]);
}

#[test]
fn a_pointer_diff_is_flagged_as_lfs_and_carries_both_sides() {
    let tr = lfs_repo();
    // Change the pointer the way a new version of the asset would: same version
    // line, different oid and size.
    write_file(tr.path(), "art/asset.psd", POINTER_V2);
    let (backend, handle) = tr.open_with_backend();

    let diff = backend
        .diff(
            &handle.id,
            std::path::Path::new("art/asset.psd"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .expect("diff");

    let lfs = diff
        .lfs
        .as_ref()
        .expect("an LFS pointer diff must be flagged, not rendered as 2 changed lines");
    assert_eq!(lfs.old.as_ref().unwrap().size, 1_048_576);
    assert_eq!(lfs.new.as_ref().unwrap().size, 2_097_152);
    assert!(lfs.new.as_ref().unwrap().oid.starts_with("2222"));
    // `binary` stays honest — a pointer IS text, and other code trusts that flag.
    assert!(!diff.binary);
}

#[test]
fn an_ordinary_text_diff_is_never_flagged_as_lfs() {
    let tr = lfs_repo();
    write_file(tr.path(), "README.md", "readme, edited\n");
    let (backend, handle) = tr.open_with_backend();

    let diff = backend
        .diff(
            &handle.id,
            std::path::Path::new("README.md"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .expect("diff");
    assert!(diff.lfs.is_none());
    assert!(!diff.hunks.is_empty(), "still an ordinary text diff");
}

#[test]
fn a_commit_diff_flags_an_added_pointer_with_no_old_side() {
    let tr = TempRepo::with_initial_commit("readme\n");
    write_file(tr.path(), ".gitattributes", "*.psd filter=lfs -text\n");
    write_file(tr.path(), "new.psd", POINTER_V1);
    tr.commit_all("add an lfs asset");
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();
    let (backend, handle) = tr.open_with_backend();

    let diffs = backend
        .diff_commit(&handle.id, &head, 3, false)
        .expect("diff_commit");
    let asset = diffs
        .iter()
        .find(|d| d.path == "new.psd")
        .expect("new.psd in the commit diff");
    let lfs = asset.lfs.as_ref().expect("added pointer flagged");
    assert!(lfs.old.is_none());
    assert_eq!(lfs.new.as_ref().unwrap().size, 1_048_576);
    // `.gitattributes` landed in the same commit and is NOT a pointer, which is the
    // check that the detector is not just "this commit mentions lfs".
    let attrs = diffs
        .iter()
        .find(|d| d.path == ".gitattributes")
        .expect(".gitattributes in the commit diff");
    assert!(attrs.lfs.is_none());
}

#[test]
fn checkout_without_the_binary_is_lfs_unavailable_not_a_git_error() {
    if lfs_installed() {
        // With the binary present this is a real (and harmless) checkout, so there
        // is nothing to assert about the missing-binary contract.
        return;
    }
    let tr = lfs_repo();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .lfs_checkout(&handle.id)
        .expect_err("no git-lfs, so this must fail");
    assert!(
        matches!(err, AppError::LfsUnavailable(_)),
        "a missing binary must be its own state, not git's \
         \"'lfs' is not a git command\" in an error banner; got {err:?}"
    );
}

#[test]
fn a_real_git_lfs_reports_pointer_versus_materialized() {
    if !lfs_installed() {
        eprintln!("skipping: git-lfs is not installed");
        return;
    }
    let tr = lfs_repo();
    let (backend, handle) = tr.open_with_backend();
    let status = backend.lfs_status(&handle.id).expect("lfs_status");
    assert!(status.installed);
    assert!(status.version.is_some());
    // The committed pointer has no object behind it, so ls-files lists it as a
    // pointer rather than materialized.
    let listed = status.files.iter().find(|f| f.path == "art/asset.psd");
    if let Some(f) = listed {
        assert!(!f.materialized, "no object was ever uploaded for it");
    }
}
