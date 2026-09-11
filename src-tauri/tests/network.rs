/// Integration tests for network operations (fetch / pull / push) and
/// remote management (add / remove / rename / set-url / prune).
///
/// Network tests use a *local* bare repo as the "remote", so they work
/// fully offline and don't depend on SSH keys or credential helpers.
mod support;

use platypusgit_lib::git::GitBackend;
use std::path::PathBuf;
use support::{BareTempRepo, TempRepo};

// ─────────────────────────────────────────────────────────────
// Remote management (libgit2 — no network required)
// ─────────────────────────────────────────────────────────────

#[test]
fn add_remote_shows_in_list() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .add_remote(&handle.id, "origin", "https://example.com/repo.git")
        .expect("add_remote");

    let remotes = backend.remotes(&handle.id).expect("remotes");
    assert!(
        remotes.iter().any(|r| r.name == "origin"),
        "origin should appear in remotes list"
    );
}

#[test]
fn remove_remote_disappears_from_list() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .add_remote(&handle.id, "origin", "https://example.com/repo.git")
        .expect("add_remote");
    backend
        .remove_remote(&handle.id, "origin")
        .expect("remove_remote");

    let remotes = backend.remotes(&handle.id).expect("remotes");
    assert!(
        !remotes.iter().any(|r| r.name == "origin"),
        "origin should not appear after removal"
    );
}

#[test]
fn rename_remote_updates_name() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .add_remote(&handle.id, "origin", "https://example.com/repo.git")
        .expect("add_remote");
    backend
        .rename_remote(&handle.id, "origin", "upstream")
        .expect("rename_remote");

    let remotes = backend.remotes(&handle.id).expect("remotes");
    assert!(
        remotes.iter().any(|r| r.name == "upstream"),
        "upstream should exist after rename"
    );
    assert!(
        !remotes.iter().any(|r| r.name == "origin"),
        "origin should not exist after rename"
    );
}

#[test]
fn set_remote_url_updates_url() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .add_remote(&handle.id, "origin", "https://old.example.com/repo.git")
        .expect("add_remote");
    backend
        .set_remote_url(&handle.id, "origin", "https://new.example.com/repo.git")
        .expect("set_remote_url");

    let remotes = backend.remotes(&handle.id).expect("remotes");
    let origin = remotes.iter().find(|r| r.name == "origin").expect("origin");
    assert_eq!(
        origin.url.as_deref(),
        Some("https://new.example.com/repo.git"),
        "URL should be updated"
    );
}

#[test]
fn remove_nonexistent_remote_returns_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .remove_remote(&handle.id, "nonexistent")
        .unwrap_err();
    // Should be a Git error, not a panic.
    assert!(
        matches!(
            err,
            platypusgit_lib::error::AppError::Git(_)
        ),
        "expected Git error, got {:?}",
        err
    );
}

// ─────────────────────────────────────────────────────────────
// Push / fetch / pull via git CLI against local bare repo
// ─────────────────────────────────────────────────────────────

/// Assert that `git` is available on PATH — if not, skip with a message
/// rather than failing (CI without git should not break).
fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn push_to_bare_remote_creates_ref() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    let bare = BareTempRepo::new();
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Point origin at the bare repo (file:// is fine for local tests)
    backend
        .add_remote(&handle.id, "origin", bare.path.to_str().unwrap())
        .expect("add_remote");

    // Push via the CLI shim.
    // We call repo_path to verify it works, then shell out directly since
    // the Tauri command (async) can't be called from a sync test.
    let path = backend.repo_path(&handle.id).expect("repo_path");
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["push", "origin", "main"])
        .status()
        .expect("git push");
    assert!(status.success(), "push should succeed");

    // Verify the bare repo has the ref.
    let bare_repo = git2::Repository::open_bare(&bare.path).expect("open bare");
    assert!(
        bare_repo.find_reference("refs/heads/main").is_ok(),
        "bare repo should have refs/heads/main after push"
    );
}

#[test]
fn fetch_from_bare_remote_creates_remote_tracking_ref() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    let bare = BareTempRepo::new();
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Set up origin pointing at the bare repo.
    backend
        .add_remote(&handle.id, "origin", bare.path.to_str().unwrap())
        .expect("add_remote");
    let path = backend.repo_path(&handle.id).expect("repo_path");

    // Push first so there's something to fetch back.
    let push_ok = std::process::Command::new("git")
        .arg("-C").arg(&path)
        .args(["push", "origin", "main"])
        .status()
        .expect("git push")
        .success();
    assert!(push_ok, "setup push should succeed");

    // Now fetch from origin.
    let fetch_ok = std::process::Command::new("git")
        .arg("-C").arg(&path)
        .args(["fetch", "origin", "--prune"])
        .status()
        .expect("git fetch")
        .success();
    assert!(fetch_ok, "fetch should succeed");

    // Check remote-tracking ref exists.
    let exists = tr
        .repo
        .find_reference("refs/remotes/origin/main")
        .is_ok();
    assert!(exists, "refs/remotes/origin/main should exist after fetch");
}

#[test]
fn pull_ff_only_advances_head() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    let bare = BareTempRepo::new();

    // "server" side: a repo we push from.
    let server = TempRepo::with_initial_commit("v1\n");
    let server_path = server.path().to_path_buf();

    // "client" side: cloned from bare after server pushes.
    // We use git clone so origin is set up correctly.
    let client_dir = tempfile::tempdir().expect("tempdir");
    let client_path = client_dir.path();

    // Push from server → bare.
    std::process::Command::new("git")
        .arg("-C").arg(&server_path)
        .args(["remote", "add", "origin", bare.path.to_str().unwrap()])
        .status().expect("git remote add").success().then_some(()).expect("remote add");

    std::process::Command::new("git")
        .arg("-C").arg(&server_path)
        .args(["push", "origin", "main"])
        .status().expect("git push").success().then_some(()).expect("push");

    // Clone bare → client. Use `-b main` so the default branch matches.
    std::process::Command::new("git")
        .args(["clone", "-b", "main", bare.path.to_str().unwrap(), client_path.to_str().unwrap()])
        .status().expect("git clone").success().then_some(()).expect("clone");

    // Configure git user in client so it can commit.
    for (k, v) in [("user.name", "Test User"), ("user.email", "test@example.com")] {
        std::process::Command::new("git")
            .arg("-C").arg(client_path)
            .args(["config", k, v])
            .status().expect("git config");
    }

    // Push a new commit from server.
    server.add_commit("README.md", "v2\n", "second commit");
    std::process::Command::new("git")
        .arg("-C").arg(&server_path)
        .args(["push", "origin", "main"])
        .status().expect("push v2").success().then_some(()).expect("push v2");

    let before_oid = {
        let r = git2::Repository::open(client_path).unwrap();
        let x = r.head().unwrap().target().unwrap(); x
    };

    // Pull --ff-only into client.
    let pull_ok = std::process::Command::new("git")
        .arg("-C").arg(client_path)
        .args(["pull", "--ff-only", "origin", "main"])
        .status().expect("git pull").success();
    assert!(pull_ok, "ff-only pull should succeed");

    let after_oid = {
        let r = git2::Repository::open(client_path).unwrap();
        let x = r.head().unwrap().target().unwrap(); x
    };
    assert_ne!(before_oid, after_oid, "HEAD should advance after pull");
}

#[test]
fn repo_path_returns_workdir() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let path = backend.repo_path(&handle.id).expect("repo_path");
    // Should be a directory that exists.
    assert!(path.is_dir(), "repo_path should return an existing directory");
}

/// The behaviour `push` relies on for #61 D9: `git push -u` leaves an upstream
/// that `branches()` then reports. The command's own decision of *when* to pass
/// `-u` is covered by the `push_args` unit tests.
#[test]
fn push_with_u_leaves_an_upstream_branches_reports() {
    let bare = BareTempRepo::new();
    let tr = TempRepo::with_initial_commit("hello\n");
    tr.repo
        .remote("origin", bare.path.to_str().unwrap())
        .unwrap();

    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["push", "-u", "origin", "main"])
        .output()
        .expect("run git push");
    assert!(
        out.status.success(),
        "push failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let (backend, handle) = tr.open_with_backend();
    let branches = backend.branches(&handle.id).unwrap();
    let main = branches
        .iter()
        .find(|b| b.name == "main" && !b.is_remote)
        .expect("main branch");
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
}

// ─────────────────────────────────────────────────────────────
// #451: a ref name beginning with `+` is a FORCE REFSPEC
// ─────────────────────────────────────────────────────────────
//
// The argv `push_args`/`push_tag_args`/`pull_args` build is pinned by the unit
// tests in `commands/branches.rs`, and reverting a builder to a bare ref name
// fails four of them. What those cannot do is say whether the pinned string is
// the RIGHT one: they assert our own choice back to us. These three pin the
// evidence for that choice — git's behaviour, which is not ours to change and
// which #451 existed because we had reasoned about rather than run.
//
// `--` ends OPTION parsing. The ref lands in REFSPEC position, which has a
// grammar of its own, and a leading `+` there means *force-update*. So a branch
// legitimately named `+main` — git accepts it, and a clone can bring one in —
// was sent as "force-update `main`": the remote's default branch silently
// overwritten, with no `confirmRewrite` in front of it, because as far as the
// app was concerned this was an ordinary push.
//
// Each test asserts BOTH shapes. The bare-name half is the damage, so reverting
// the fix fails here with the ref that moved rather than only on a string.

/// Run `git -C <dir> <args…>`; return (success, stderr).
fn git_at(dir: &std::path::Path, args: &[&str]) -> (bool, String) {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Subject of `HEAD` — which branch a pull actually merged.
fn head_subject(dir: &std::path::Path) -> String {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["log", "-1", "--format=%s"])
        .output()
        .expect("run git log");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Does the bare remote carry this exact ref?
fn bare_has(bare: &std::path::Path, full_ref: &str) -> bool {
    git2::Repository::open_bare(bare)
        .expect("open bare")
        .find_reference(full_ref)
        .is_ok()
}

/// Work repo wired to `bare`, with `main` already pushed.
fn work_against(bare: &BareTempRepo) -> (TempRepo, PathBuf) {
    let tr = TempRepo::with_initial_commit("hello\n");
    let work = tr.path_buf();
    assert!(
        git_at(&work, &["remote", "add", "origin", bare.path.to_str().unwrap()]).0,
        "add origin"
    );
    assert!(git_at(&work, &["push", "origin", "main"]).0, "seed push");
    (tr, work)
}

#[test]
fn a_bare_plus_branch_name_force_updates_the_branch_without_the_plus() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    let bare = BareTempRepo::new();
    let (_tr, work) = work_against(&bare);

    // git itself accepts the name — which is what makes this reachable at all.
    assert!(
        git_at(&work, &["check-ref-format", "--branch", "+main"]).0,
        "git must accept `+main` as a branch name, or this bug is unreachable"
    );

    // Diverge local `main` from the remote, so the damage is a REWRITE and not
    // a fast-forward that could be mistaken for harmless.
    assert!(git_at(&work, &["commit", "--allow-empty", "-m", "second"]).0);
    assert!(git_at(&work, &["push", "origin", "main"]).0, "advance main");
    assert!(git_at(&work, &["branch", "+main"]).0);
    assert!(git_at(&work, &["reset", "--hard", "HEAD~1"]).0);
    assert!(git_at(&work, &["commit", "--allow-empty", "-m", "rewritten"]).0);

    // The shape the app used to send.
    let (ok, err) = git_at(&work, &["push", "--progress", "--", "origin", "+main"]);
    assert!(ok, "bare `+main` push failed unexpectedly: {err}");
    assert!(
        !bare_has(&bare.path, "refs/heads/+main"),
        "the bare name is supposed to MISS the branch the user picked"
    );
    assert!(
        err.contains("forced update"),
        "the bare name is supposed to force-update `main` instead: {err}"
    );

    // The shape the app sends now: named in full on both sides, so the `+` is
    // an ordinary character of the ref name rather than refspec grammar.
    let (ok, err) = git_at(
        &work,
        &[
            "push",
            "--progress",
            "--",
            "origin",
            "refs/heads/+main:refs/heads/+main",
        ],
    );
    assert!(ok, "full-refspec push failed: {err}");
    assert!(
        bare_has(&bare.path, "refs/heads/+main"),
        "the full refspec must create the branch the user picked: {err}"
    );
}

/// The tag half. `+v1.2.0` is a force refspec whose SRC is `v1.2.0`, so the
/// damage depends on whether a `v1.2.0` also exists:
///
/// - it does — the common case, since a `+`-prefixed tag is usually a variant
///   of one — and the wrong tag is pushed, silently, which is what this pins;
/// - it does not, and git refuses with `src refspec v1.2.0 does not match any`,
///   which is wrong but at least loud.
#[test]
fn a_bare_plus_tag_name_pushes_the_tag_without_the_plus() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    let bare = BareTempRepo::new();
    let (_tr, work) = work_against(&bare);
    assert!(git_at(&work, &["tag", "v1.2.0"]).0);
    assert!(git_at(&work, &["commit", "--allow-empty", "-m", "second"]).0);
    assert!(git_at(&work, &["tag", "+v1.2.0"]).0);

    let (ok, err) = git_at(&work, &["push", "--progress", "--", "origin", "+v1.2.0"]);
    assert!(ok, "bare `+v1.2.0` push failed unexpectedly: {err}");
    assert!(
        !bare_has(&bare.path, "refs/tags/+v1.2.0"),
        "the bare name is supposed to MISS the tag the user picked"
    );
    assert!(
        bare_has(&bare.path, "refs/tags/v1.2.0"),
        "...and to push the OTHER tag instead: {err}"
    );

    let (ok, err) = git_at(
        &work,
        &[
            "push",
            "--progress",
            "--",
            "origin",
            "refs/tags/+v1.2.0:refs/tags/+v1.2.0",
        ],
    );
    assert!(ok, "full-refspec tag push failed: {err}");
    assert!(
        bare_has(&bare.path, "refs/tags/+v1.2.0"),
        "the full refspec must create the tag the user picked: {err}"
    );
}

/// The pull half, which #451 did not report: the branch is a refspec to
/// `git pull` as well, so a leading `+` merged a DIFFERENT branch than the one
/// named. Milder than the push — a local merge of the wrong branch rather than
/// remote history loss — and the same defect.
///
/// `pull_args` names the SRC half only. A `<src>:<dst>` pair the way the push
/// builders use it is wrong here: the dst would name a LOCAL ref for the fetch
/// to update, and git refuses to fetch into the checked-out branch.
#[test]
fn a_bare_plus_branch_name_pulls_the_branch_without_the_plus() {
    if !git_available() {
        eprintln!("SKIP: git not on PATH");
        return;
    }

    // A remote carrying two DIFFERENT branches, `main` and `+main`, so which
    // one arrived is visible in the log.
    let bare = BareTempRepo::new();
    let (_seed, sp) = work_against(&bare);
    assert!(git_at(&sp, &["commit", "--allow-empty", "-m", "main only"]).0);
    assert!(git_at(&sp, &["push", "origin", "main"]).0, "advance main");
    assert!(git_at(&sp, &["checkout", "-b", "+main", "HEAD~1"]).0);
    assert!(git_at(&sp, &["commit", "--allow-empty", "-m", "plusmain only"]).0);
    assert!(
        git_at(&sp, &["push", "origin", "refs/heads/+main:refs/heads/+main"]).0,
        "seed the +main branch"
    );

    // A clone sitting one commit behind `main`, so a pull has work to do.
    let clone_behind = |dir: &std::path::Path| {
        let ok = std::process::Command::new("git")
            .args(["clone", "--quiet"])
            .arg(&bare.path)
            .arg(dir)
            .status()
            .expect("run git clone")
            .success();
        assert!(ok, "clone failed");
        assert!(git_at(dir, &["checkout", "-B", "work", "origin/main~1"]).0);
    };

    let a_dir = tempfile::tempdir().expect("tempdir");
    let a = a_dir.path().join("bare-name");
    clone_behind(&a);
    let (ok, err) = git_at(&a, &["pull", "--progress", "--ff-only", "--", "origin", "+main"]);
    assert!(ok, "bare `+main` pull failed unexpectedly: {err}");
    assert_eq!(
        head_subject(&a),
        "main only",
        "the bare name is supposed to merge the WRONG branch"
    );

    let b_dir = tempfile::tempdir().expect("tempdir");
    let b = b_dir.path().join("full-ref");
    clone_behind(&b);
    let (ok, err) = git_at(
        &b,
        &[
            "pull",
            "--progress",
            "--ff-only",
            "--",
            "origin",
            "refs/heads/+main",
        ],
    );
    assert!(ok, "full-ref pull failed: {err}");
    assert_eq!(
        head_subject(&b),
        "plusmain only",
        "the full ref must merge the branch the user picked"
    );
}
