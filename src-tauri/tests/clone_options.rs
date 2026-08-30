//! Clone options, and staying honest about shallow (#255).
//!
//! Everything here runs against a real `git` and a real bare repository over a
//! `file://` URL. That transport is load-bearing rather than incidental: a plain
//! path clone takes git's local hardlink shortcut, which ignores `--depth` and
//! `--filter` entirely — so a test that used one would pass while proving
//! nothing about either flag.
//!
//! The other half is detection. `ShallowInfo` is READ from git on every call
//! (`.git/shallow` plus the remotes' fetch refspecs), and the unshallow test
//! below re-reads it through the SAME cached `Libgit2Backend` handle that saw
//! the repository shallow a moment earlier — which is what proves libgit2's
//! `is_shallow()` does not cache, and therefore that the truncation notices
//! actually come down when the history arrives.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::commands::branches::unshallow_args;
use platypusgit_lib::commands::create::{clone_args, run_clone};
use platypusgit_lib::commands::net::run_git_authenticated;
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::{CloneOptions, RepoId};
use platypusgit_lib::git::{libgit2::Libgit2Backend, GitBackend};

use support::{git_in, BareTempRepo, TempRepo};

/// A bare origin carrying three commits on `main` and one more on `other`,
/// plus the `file://` URL that reaches it.
///
/// Two branches on purpose: `--single-branch` and `--no-single-branch` are only
/// distinguishable on a repository that has a second branch to leave behind.
struct Origin {
    bare: BareTempRepo,
    _source: TempRepo,
    url: String,
}

fn origin_with_two_branches() -> Origin {
    let source = TempRepo::with_initial_commit("one\n");
    for n in ["two", "three"] {
        std::fs::write(source.path().join(format!("{n}.txt")), format!("{n}\n")).unwrap();
        git_in(source.path(), &["add", "-A"]);
        git_in(source.path(), &["commit", "-m", n]);
    }
    git_in(source.path(), &["checkout", "-b", "other"]);
    std::fs::write(source.path().join("side.txt"), "side\n").unwrap();
    git_in(source.path(), &["add", "-A"]);
    git_in(source.path(), &["commit", "-m", "side"]);
    git_in(source.path(), &["checkout", "main"]);

    let bare = BareTempRepo::new();
    let bare_path = bare.path.to_string_lossy().to_string();
    git_in(source.path(), &["remote", "add", "origin", &bare_path]);
    git_in(source.path(), &["push", "origin", "main", "other"]);
    // A partial clone is only partial if the server agrees to filter. Without
    // this git warns "filtering not recognized by server, ignoring" and hands
    // over every blob — the clone still succeeds, so a test that did not set it
    // would be asserting local config and nothing about the transfer.
    git_in(&bare.path, &["config", "uploadpack.allowfilter", "true"]);

    let url = format!("file://{bare_path}");
    Origin {
        bare,
        _source: source,
        url,
    }
}

/// Clone `origin` with `opts` into a fresh tempdir, answering the destination
/// and the guard that owns it.
async fn clone_with(origin: &Origin, opts: CloneOptions) -> (PathBuf, tempfile::TempDir) {
    let parent = tempfile::tempdir().unwrap();
    let dest = run_clone(&origin.url, parent.path(), "cloned", &opts, None, |_| {})
        .await
        .expect("clone from a local file:// origin");
    (dest, parent)
}

fn open_backend(path: &Path) -> (Libgit2Backend, RepoId) {
    let backend = Libgit2Backend::new();
    let handle = backend.open(path).expect("open the clone");
    (backend, handle.id)
}

fn log_count(repo: &Path) -> usize {
    git_in(repo, &["rev-list", "--count", "HEAD"])
        .trim()
        .parse()
        .expect("a commit count")
}

// ─────────────────────────────────────────────────────────────
// The argument list — pure, no repository
// ─────────────────────────────────────────────────────────────

#[test]
fn every_option_becomes_its_own_flag_before_the_separator() {
    let args = clone_args(
        "https://example.com/repo.git",
        "repo",
        &CloneOptions {
            recurse_submodules: true,
            depth: Some(25),
            blobless: true,
            single_branch: true,
        },
    );

    assert_eq!(
        args,
        vec![
            "-c",
            "protocol.ext.allow=never",
            "clone",
            "--progress",
            "--depth",
            "25",
            "--filter=blob:none",
            "--single-branch",
            "--recurse-submodules",
            "--",
            "https://example.com/repo.git",
            "repo",
        ]
    );

    // The separator's whole job: every flag is ahead of it and the two
    // user-supplied values are behind it, so neither can ever be read as one.
    let sep = args.iter().position(|a| a == "--").unwrap();
    assert!(args[..sep].iter().all(|a| a != "https://example.com/repo.git"));
    assert_eq!(args.len() - sep, 3);
}

#[test]
fn a_depth_with_single_branch_unticked_negates_gits_own_implication() {
    // `git clone --depth` implies `--single-branch` unless told otherwise, so
    // without the negation the checkbox would silently mean nothing whenever a
    // depth was also set — the user unticks "Single branch" and still gets one.
    let args = clone_args(
        "u",
        "n",
        &CloneOptions {
            depth: Some(1),
            ..CloneOptions::default()
        },
    );
    assert!(args.iter().any(|a| a == "--no-single-branch"));
    assert!(!args.iter().any(|a| a == "--single-branch"));

    // With no depth there is nothing to negate, so nothing is emitted: a bare
    // `--no-single-branch` on a full clone would be noise in the argv.
    let full = clone_args("u", "n", &CloneOptions::default());
    assert!(!full.iter().any(|a| a.ends_with("single-branch")));
}

#[test]
fn the_default_options_are_exactly_the_clone_that_shipped_before() {
    assert_eq!(
        clone_args("u", "n", &CloneOptions::default()),
        vec!["-c", "protocol.ext.allow=never", "clone", "--progress", "--", "u", "n"]
    );
}

#[tokio::test]
async fn a_zero_depth_is_refused_before_anything_is_spawned() {
    // git's own words are `fatal: depth 0 is not a positive number`, delivered
    // as a clone failure after the spawn. This is a form validation, so it is
    // answered as one — and the destination is never touched.
    let parent = tempfile::tempdir().unwrap();
    let err = run_clone(
        "https://example.com/repo.git",
        parent.path(),
        "cloned",
        &CloneOptions {
            depth: Some(0),
            ..CloneOptions::default()
        },
        None,
        |_| {},
    )
    .await
    .unwrap_err();

    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(!parent.path().join("cloned").exists());
}

// ─────────────────────────────────────────────────────────────
// Real clones, and what the app then says about them
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_full_clone_is_neither_shallow_nor_single_branch() {
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(&origin, CloneOptions::default()).await;
    let (backend, id) = open_backend(&dest);

    let info = backend.shallow_info(&id).expect("shallow_info");
    assert!(!info.shallow);
    assert_eq!(info.boundary_count, 0);
    assert!(!info.single_branch);
    assert_eq!(log_count(&dest), 3);
}

#[tokio::test]
async fn a_shallow_clone_reports_shallow_with_a_boundary_per_branch_tip() {
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(
        &origin,
        CloneOptions {
            depth: Some(1),
            ..CloneOptions::default()
        },
    )
    .await;
    let (backend, id) = open_backend(&dest);

    let info = backend.shallow_info(&id).expect("shallow_info");
    assert!(info.shallow, "a --depth 1 clone is shallow");
    // `--no-single-branch` was emitted (no single-branch box ticked), so both
    // branch tips are fetched and each one is its own boundary.
    assert_eq!(info.boundary_count, 2, "one boundary per fetched branch tip");
    assert!(!info.single_branch, "all branches were fetched, just shallowly");
    assert_eq!(log_count(&dest), 1, "history genuinely stops at the tip");
}

#[tokio::test]
async fn depth_and_single_branch_together_leave_one_boundary_and_one_branch() {
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(
        &origin,
        CloneOptions {
            depth: Some(1),
            single_branch: true,
            ..CloneOptions::default()
        },
    )
    .await;
    let (backend, id) = open_backend(&dest);

    let info = backend.shallow_info(&id).expect("shallow_info");
    assert!(info.shallow);
    assert_eq!(info.boundary_count, 1);
    assert!(
        info.single_branch,
        "the fetch refspec names one branch, which is what the notice reports"
    );
    let remote_branches = git_in(&dest, &["branch", "-r", "--format=%(refname)"]);
    assert!(!remote_branches.contains("other"), "got {remote_branches}");
}

#[tokio::test]
async fn a_single_branch_clone_is_reported_without_being_shallow() {
    // The two facts are independent: `--single-branch` truncates the BRANCH
    // list, not the history, and a user who sees only one branch deserves the
    // same explanation as one whose log stops early.
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(
        &origin,
        CloneOptions {
            single_branch: true,
            ..CloneOptions::default()
        },
    )
    .await;
    let (backend, id) = open_backend(&dest);

    let info = backend.shallow_info(&id).expect("shallow_info");
    assert!(!info.shallow, "single-branch keeps the full history it fetched");
    assert!(info.single_branch);
    assert_eq!(log_count(&dest), 3);
}

#[tokio::test]
async fn a_blobless_clone_keeps_every_commit_and_records_its_filter() {
    // `--filter=blob:none` is the option for a big repo you intend to work in:
    // it truncates nothing, so nothing about it is dishonest and no notice is
    // owed for it.
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(
        &origin,
        CloneOptions {
            blobless: true,
            ..CloneOptions::default()
        },
    )
    .await;
    let (backend, id) = open_backend(&dest);

    let info = backend.shallow_info(&id).expect("shallow_info");
    assert!(!info.shallow);
    assert!(!info.single_branch);
    assert_eq!(log_count(&dest), 3);
    assert_eq!(
        git_in(&dest, &["config", "--get", "remote.origin.partialclonefilter"]).trim(),
        "blob:none"
    );
    // And the working tree really is there — a partial clone fetches the blobs
    // the checkout needs, on demand.
    assert_eq!(
        std::fs::read_to_string(dest.join("README.md")).unwrap(),
        "one\n"
    );
}

#[tokio::test]
async fn unshallow_restores_the_history_and_the_backend_stops_calling_it_shallow() {
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(
        &origin,
        CloneOptions {
            depth: Some(1),
            single_branch: true,
            ..CloneOptions::default()
        },
    )
    .await;
    // One backend, opened BEFORE the unshallow and reused after it. Libgit2Backend
    // caches each `git2::Repository` for the life of the tab, so an
    // `is_shallow()` that cached would leave every truncation notice up forever
    // — with the full history sitting right there behind it.
    let (backend, id) = open_backend(&dest);
    assert!(backend.shallow_info(&id).unwrap().shallow);

    run_git_authenticated(&dest, &unshallow_args(), None)
        .await
        .expect("git fetch --unshallow");

    let info = backend.shallow_info(&id).expect("shallow_info after unshallow");
    assert!(!info.shallow, "the shallow marker is gone");
    assert_eq!(info.boundary_count, 0);
    assert_eq!(log_count(&dest), 3, "the missing commits actually arrived");
    // Unshallowing does NOT widen a single-branch refspec, and the notice must
    // keep saying so rather than going quiet on a half-fixed repository.
    assert!(info.single_branch);
    assert!(!dest.join(".git/shallow").exists());
}

#[tokio::test]
async fn unshallow_on_a_complete_repository_is_the_error_the_command_avoids() {
    // Pins the reason `unshallow` re-reads the state instead of just running:
    // git refuses outright, and that refusal must never reach a user who simply
    // clicked a button whose work another window had already done.
    let origin = origin_with_two_branches();
    let (dest, _guard) = clone_with(&origin, CloneOptions::default()).await;

    let err = run_git_authenticated(&dest, &unshallow_args(), None)
        .await
        .unwrap_err();
    let AppError::Network(message) = &err else {
        panic!("got {err:?}, expected AppError::Network");
    };
    assert!(
        message.contains("complete repository"),
        "expected git's own refusal, got: {message}"
    );

    // And the state the command branches on is the one that spares the user
    // that message.
    let (backend, id) = open_backend(&dest);
    assert!(!backend.shallow_info(&id).unwrap().shallow);
}

#[test]
fn a_repository_with_no_remote_at_all_is_neither_flag() {
    // The plain local repository every other test in the suite uses: nothing is
    // missing from it, so neither notice may appear.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let info = backend.shallow_info(&handle.id).expect("shallow_info");
    assert!(!info.shallow);
    assert!(!info.single_branch);
    assert_eq!(info.boundary_count, 0);
    // Keep the fixture alive past the read.
    drop(tr);
}

#[test]
fn the_bare_origin_fixture_is_reachable() {
    // Cheap guard on the fixture itself: every clone above is a `file://` URL
    // built from this path, and a bare repo that never received the push would
    // make all of them fail with the same unhelpful "does not appear to be a
    // repository".
    let origin = origin_with_two_branches();
    assert!(origin.bare.path.join("HEAD").exists());
    assert!(origin.url.starts_with("file://"));
}
