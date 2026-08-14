//! A rebase git owns on disk — the `.git/rebase-merge` state that the
//! `rebase_onto` command's `git rebase` shells out to create, or that the user
//! left behind in a terminal — cannot be finished by libgit2.
//!
//! `continue_operation`'s generic path commits the resolved tree and calls
//! `cleanup_state()`, which would drop every step still queued; `abort_operation`'s
//! generic path hard-resets to the mid-rebase HEAD, which leaves the user
//! detached at a half-rebased position rather than back on their branch. These
//! tests pin the hand-off to git for both.

mod support;

use std::path::Path;
use std::process::Command;

use platypusgit_lib::git::{types::RepoState, GitBackend};
use support::{fs::write_file, TempRepo};

fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        // The fixture writes user.name/email into the repo's own config; the
        // rest keeps a developer's global config (signing, editors, hooks) from
        // deciding whether this test passes.
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git")
}

fn git_ok(dir: &Path, args: &[&str]) {
    let out = git(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
}

fn head_ref(dir: &Path) -> String {
    let out = git(dir, &["symbolic-ref", "--quiet", "HEAD"]);
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn rev(dir: &Path, spec: &str) -> String {
    let out = git(dir, &["rev-parse", spec]);
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// `feature` carries two commits on top of the shared base: the first collides
/// with `main` on README.md, the second adds `queued.txt`. Rebasing `feature`
/// onto `main` therefore stops on the first and leaves the second queued —
/// which is the step a wrong "continue" silently throws away.
fn with_cli_rebase_conflict() -> TempRepo {
    let tr = TempRepo::with_initial_commit("base\n");
    let dir = tr.path().to_path_buf();

    git_ok(&dir, &["checkout", "-b", "feature"]);
    write_file(&dir, "README.md", "feature side\n");
    git_ok(&dir, &["add", "README.md"]);
    git_ok(&dir, &["commit", "-m", "feature: README"]);
    write_file(&dir, "queued.txt", "queued work\n");
    git_ok(&dir, &["add", "queued.txt"]);
    git_ok(&dir, &["commit", "-m", "feature: queued"]);

    git_ok(&dir, &["checkout", "main"]);
    write_file(&dir, "README.md", "main side\n");
    git_ok(&dir, &["add", "README.md"]);
    git_ok(&dir, &["commit", "-m", "main: README"]);

    git_ok(&dir, &["checkout", "feature"]);
    let out = git(&dir, &["rebase", "main"]);
    assert!(
        !out.status.success(),
        "fixture expected the rebase to stop on a conflict"
    );
    tr
}

#[test]
fn cli_rebase_conflict_is_reported_as_a_rebase_state_with_no_tracked_session() {
    let tr = with_cli_rebase_conflict();
    let (backend, handle) = tr.open_with_backend();
    assert!(
        matches!(
            backend.repo_state(&handle.id).unwrap(),
            RepoState::Rebase | RepoState::RebaseInteractive | RepoState::RebaseMerge
        ),
        "on-disk rebase must surface through repo_state"
    );
    // Nothing in the in-memory plan map: this rebase is git's, not ours, which
    // is exactly what makes the generic continue/abort paths wrong for it.
    assert!(!backend.rebase_status(&handle.id).unwrap().in_progress);
}

#[test]
fn continue_operation_applies_the_steps_still_queued() {
    let tr = with_cli_rebase_conflict();
    let dir = tr.path().to_path_buf();
    let (backend, handle) = tr.open_with_backend();

    // Resolve the conflicted step the way the app does.
    backend
        .accept_theirs(&handle.id, Path::new("README.md"))
        .expect("accept_theirs");

    let oid = backend
        .continue_operation(&handle.id)
        .expect("continue_operation");

    assert!(!oid.is_empty(), "continue must report the resulting commit");
    assert!(matches!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Clean
    ));
    assert_eq!(head_ref(&dir), "refs/heads/feature");
    // The queued second commit is the acceptance: a libgit2 commit +
    // cleanup_state() would have finished the rebase without it.
    assert!(
        dir.join("queued.txt").exists(),
        "the queued rebase step was dropped"
    );
    let log = git(&dir, &["log", "--pretty=%s", "-3"]);
    let log = String::from_utf8_lossy(&log.stdout);
    assert!(log.contains("feature: queued"), "log was: {log}");
    assert!(log.contains("main: README"), "log was: {log}");
}

#[test]
fn abort_operation_restores_the_pre_rebase_branch() {
    let tr = with_cli_rebase_conflict();
    let dir = tr.path().to_path_buf();
    // `feature`'s tip before the rebase started — ORIG_HEAD is what git records
    // for it, and it is what the branch must point at again afterwards.
    let orig = rev(&dir, "ORIG_HEAD");
    let (backend, handle) = tr.open_with_backend();

    backend
        .abort_operation(&handle.id)
        .expect("abort_operation");

    assert!(matches!(
        backend.repo_state(&handle.id).unwrap(),
        RepoState::Clean
    ));
    assert_eq!(
        head_ref(&dir),
        "refs/heads/feature",
        "abort must leave the branch checked out, not a detached HEAD"
    );
    assert_eq!(rev(&dir, "HEAD"), orig, "abort must restore the branch tip");
    let status = git(&dir, &["status", "--porcelain"]);
    assert_eq!(String::from_utf8_lossy(&status.stdout).trim(), "");
}
