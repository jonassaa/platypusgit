//! `verify_commit` must not spawn anything for an **unsigned** commit (issue 172).
//!
//! Why this is worth its own test binary: the only way to observe "no process was
//! spawned" is to control `PATH`, and `PATH` is process-global while cargo runs a
//! binary's tests on parallel threads. One `#[test]` per binary, so the
//! environment mutation cannot race a sibling.
//!
//! The stub `git` on `PATH` records that it ran and then fails, which gives three
//! assertions from one fixture:
//!
//! 1. the stub is reachable at all (proving a spawn WOULD be observed),
//! 2. an unsigned commit produces `SigState::None` with the stub untouched,
//! 3. a commit that DOES carry a signature still reaches the subprocess — the
//!    pre-check is a pre-check, not a blanket short-circuit — and git's own
//!    message survives into the error instead of being replaced by
//!    `InvalidRef(oid)`.
//!
//! The Windows console flash this removes cannot be observed from here; what can
//! be observed, on every platform, is that the process is not spawned at all.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::signing::SigState;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// A `git` on `PATH` that touches `marker` and exits non-zero with a message.
///
/// Unix-only: Rust's `Command::new("git")` resolves through `CreateProcess` on
/// Windows, which appends `.exe` and would not find a `.cmd` shim, so a stub
/// there means compiling a real executable. The invariant under test is
/// platform-independent, so the test skips instead.
#[cfg(unix)]
fn stub_git(dir: &std::path::Path, marker: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let git = dir.join("git");
    std::fs::write(
        &git,
        format!(
            "#!/bin/sh\n\
             : > '{}'\n\
             echo 'stub git: gpg is not installed' >&2\n\
             exit 1\n",
            marker.display()
        ),
    )
    .expect("write stub git");
    std::fs::set_permissions(&git, std::fs::Permissions::from_mode(0o755))
        .expect("chmod stub git");
    git
}

#[cfg(unix)]
#[test]
fn an_unsigned_commit_is_verified_without_spawning_git() {
    let bindir = tempfile::tempdir().expect("bindir");
    let marker = bindir.path().join("git-ran");
    stub_git(bindir.path(), &marker);

    // The repository is built entirely through libgit2, so nothing about the
    // fixture itself needs the real git binary.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let unsigned_oid = tr.repo.head().unwrap().target().unwrap().to_string();

    // A commit object carrying a `gpgsig` header. The signature is not a real
    // one — the pre-check reads the HEADER, and what happens after it is a
    // subprocess this test wants to catch, not verify.
    let signed_oid = {
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let buf = tr
            .repo
            .commit_create_buffer(
                &head.author(),
                &head.committer(),
                "signed",
                &head.tree().unwrap(),
                &[&head],
            )
            .unwrap();
        let content = std::str::from_utf8(&buf).unwrap().to_string();
        tr.repo
            .commit_signed(&content, "-----BEGIN SSH SIGNATURE-----\nnope\n", None)
            .expect("write a commit with a gpgsig header")
            .to_string()
    };

    std::env::set_var("PATH", bindir.path());

    // ── the fixture proves itself: a spawn IS observable ─────────────────────
    let probe = std::process::Command::new("git")
        .arg("--version")
        .output()
        .expect("the stub git must be reachable on PATH");
    assert!(!probe.status.success(), "the stub git should exit non-zero");
    assert!(
        marker.exists(),
        "fixture is broken: running git left no marker, so this test could not \
         detect a spawn"
    );
    std::fs::remove_file(&marker).expect("reset the marker");

    // ── the fix: no subprocess for an unsigned commit ────────────────────────
    let status = backend
        .verify_commit(&handle.id, &unsigned_oid)
        .expect("an unsigned commit must verify without git");
    assert_eq!(status.state, SigState::None);
    assert!(status.signer.is_none());
    assert!(
        !marker.exists(),
        "verify_commit spawned git for an UNSIGNED commit — that spawn is the \
         console flash reported in issue 172, once per commit selected in History"
    );

    // ── a hex oid that is not in the repository still fails, still no spawn ──
    let missing = "0".repeat(40);
    let err = backend
        .verify_commit(&handle.id, &missing)
        .expect_err("an unknown object must not read as unsigned");
    assert!(
        matches!(err, AppError::InvalidRef(_)),
        "expected InvalidRef, got {err:?}"
    );
    assert!(
        !marker.exists(),
        "an unresolvable revision must be refused before anything is spawned"
    );

    // ── a SIGNED commit still goes to git, and git's message survives ────────
    let err = backend
        .verify_commit(&handle.id, &signed_oid)
        .expect_err("the stub git fails, so this must be an error");
    assert!(
        marker.exists(),
        "a signed commit must still reach `git show --format=%G?` — the \
         pre-check is not allowed to answer for it"
    );
    match err {
        AppError::Git(msg) => assert!(
            msg.contains("gpg is not installed"),
            "git's own message must survive instead of being replaced by an \
             InvalidRef: {msg}"
        ),
        other => panic!("expected AppError::Git carrying git's message, got {other:?}"),
    }
}

#[cfg(not(unix))]
#[test]
fn an_unsigned_commit_is_verified_without_spawning_git() {
    eprintln!("PATH-stubbed spawn detection is unix-only — skipping");
}
