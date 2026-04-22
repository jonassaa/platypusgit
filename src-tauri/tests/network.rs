/// Integration tests for network operations (fetch / pull / push) and
/// remote management (add / remove / rename / set-url / prune).
///
/// Network tests use a *local* bare repo as the "remote", so they work
/// fully offline and don't depend on SSH keys or credential helpers.
mod support;

use platypusgit_lib::git::GitBackend;
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
