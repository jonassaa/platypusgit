//! Progress and failure reporting from the shared network runner (#296).
//!
//! `run_git_authenticated` used to `wait_with_output()` its child: one buffered
//! read at the end, no `--progress`, and therefore no way to tell a 300 MB fetch
//! from a stalled one. It streams now, which changes two things worth pinning
//! against a real `git`:
//!
//! 1. **Ticks actually arrive.** The parser is unit-tested in `progress.rs`
//!    against captured lines; this tests the whole path — flag, spawn, pipe,
//!    splitter, sink — with git as the author of the bytes. A `file://` remote
//!    is enough: git runs a real pack transfer over it and reports progress,
//!    while a plain path clone hardlinks and reports nothing.
//! 2. **A failure still says what git said.** `map_git_failure` is now fed the
//!    reader's tail rather than raw stderr. If the filtering ever swallowed the
//!    `fatal:` line, every network error in the app would degrade to a bare exit
//!    code — and no unit test of the parser would notice.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use platypusgit_lib::commands::net::{run_git_authenticated, run_git_authenticated_with_progress};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::CloneProgress;

fn git(cwd: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}

fn commit_files(repo: &Path, prefix: &str, count: usize) {
    for i in 0..count {
        std::fs::write(repo.join(format!("{prefix}{i}.txt")), format!("{prefix} {i}\n")).unwrap();
    }
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-qm", prefix]);
}

/// A bare origin, and a clone of it that is one commit behind.
///
/// Returned as `(clone_dir, _tempdir)` — the `TempDir` guard has to outlive the
/// test or the whole fixture is deleted before git is done with it.
fn behind_clone() -> (PathBuf, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let origin = dir.path().join("origin.git");
    let seed = dir.path().join("seed");
    let clone = dir.path().join("clone");
    std::fs::create_dir_all(&seed).unwrap();

    git(dir.path(), &["init", "-q", "--bare", "origin.git"]);
    git(&seed, &["init", "-q", "-b", "main"]);
    commit_files(&seed, "first", 40);
    let url = format!("file://{}", origin.display());
    git(&seed, &["remote", "add", "origin", &url]);
    git(&seed, &["push", "-q", "origin", "main"]);

    git(dir.path(), &["clone", "-q", &url, "clone"]);

    // Move origin ahead, so the clone's fetch has a real pack to transfer.
    commit_files(&seed, "second", 60);
    git(&seed, &["push", "-q", "origin", "main"]);

    (clone, dir)
}

#[tokio::test]
async fn a_fetch_reports_gits_own_progress() {
    let (clone, _guard) = behind_clone();
    let seen: Mutex<Vec<CloneProgress>> = Mutex::new(Vec::new());

    // The same argv `fetch_args` builds — `--progress` included, which is the
    // whole reason there is anything on stderr to read.
    run_git_authenticated_with_progress(
        &clone,
        &["fetch", "--progress", "--", "origin"],
        None,
        &mut |p| seen.lock().unwrap().push(p),
    )
    .await
    .expect("the fetch itself must succeed");

    let seen = seen.into_inner().unwrap();
    assert!(
        !seen.is_empty(),
        "no progress ticks — git was not run with --progress, or the reader is not \
         splitting on the carriage returns git redraws with"
    );
    assert!(
        seen.iter().all(|p| p.percent <= 100 && !p.phase.is_empty()),
        "every tick must carry a usable phase and percentage: {seen:?}"
    );
    // Git counts up within a phase. Anything else means the splitter is handing
    // whole buffers to the parser instead of one redraw at a time.
    assert!(
        seen.iter().any(|p| p.percent == 100),
        "a completed phase must reach 100%: {seen:?}"
    );
}

#[tokio::test]
async fn the_quiet_wrapper_runs_the_same_op_without_a_sink() {
    // `run_git_authenticated` delegates to the streaming body with a no-op sink.
    // If that delegation ever broke, every op in the app that does not want
    // progress would break with it.
    let (clone, _guard) = behind_clone();

    run_git_authenticated(&clone, &["fetch", "--progress", "--", "origin"], None)
        .await
        .expect("a sinkless fetch must still fetch");
}

#[tokio::test]
async fn a_failure_still_carries_gits_own_words() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_path_buf();
    git(&repo, &["init", "-q"]);

    let err = run_git_authenticated(&repo, &["fetch", "--progress", "--", "nope"], None)
        .await
        .expect_err("fetching an undefined remote must fail");

    // Not `AppError::Auth` — there is no credential to ask for here — and not an
    // empty message: the tail must reach the classifier intact.
    match err {
        AppError::Network(msg) => {
            assert!(
                msg.contains("nope"),
                "the error must name what git complained about, got: {msg:?}"
            );
        }
        other => panic!("expected AppError::Network, got {other:?}"),
    }
}

#[tokio::test]
async fn progress_lines_are_kept_out_of_the_failure_message() {
    // A push that transfers a pack and THEN gets rejected: the message the user
    // reads must be git's rejection, not the five hundred redraws in front of it.
    let dir = tempfile::tempdir().unwrap();
    let origin = dir.path().join("origin.git");
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();

    git(dir.path(), &["init", "-q", "--bare", "origin.git"]);
    git(&work, &["init", "-q", "-b", "main"]);
    commit_files(&work, "base", 40);
    let url = format!("file://{}", origin.display());
    git(&work, &["remote", "add", "origin", &url]);
    git(&work, &["push", "-q", "origin", "main"]);

    // Refuse the update: origin moves on, and the local side rewinds so its push
    // is a non-fast-forward.
    let other = dir.path().join("other");
    git(dir.path(), &["clone", "-q", &url, "other"]);
    commit_files(&other, "theirs", 5);
    git(&other, &["push", "-q", "origin", "main"]);
    commit_files(&work, "mine", 40);

    let err = run_git_authenticated(&work, &["push", "--progress", "origin", "main"], None)
        .await
        .expect_err("a non-fast-forward push must fail");

    let AppError::Network(msg) = err else {
        panic!("expected AppError::Network");
    };
    assert!(
        msg.contains("rejected") || msg.contains("fetch first") || msg.contains("non-fast-forward"),
        "the rejection must survive: {msg:?}"
    );
    assert!(
        !msg.contains('%'),
        "progress redraws must not be part of what the user reads: {msg:?}"
    );
}
