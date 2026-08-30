//! Cancelling a stalled network op (#234).
//!
//! Its own test binary on purpose. The registry in `cancel.rs` is process-wide,
//! and `Scope::Clone` is a unit variant every clone in the process shares — so a
//! `cancel(&Scope::Clone)` here, run in parallel with `clone_init.rs`'s clones,
//! would kill one of those instead and fail a test that has nothing to do with
//! this feature. Separate binary, separate process, no shared registry.
//!
//! The stall is real rather than simulated: a TCP listener that accepts the
//! connection and then says nothing is exactly the failure the issue names —
//! "a host that accepts the TCP connection and then stalls" — and it is the one
//! case a timeout-free `git` will sit in forever. Nothing here touches the
//! network: the listener is on 127.0.0.1 and answers no HTTP at all.

use std::net::TcpListener;
use std::path::Path;
use std::time::{Duration, Instant};

use platypusgit_lib::cancel::{self, Scope};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::CloneOptions;

/// A listener that accepts connections and then holds them open, silent.
///
/// The accepted sockets are parked in a `Vec` rather than dropped: dropping one
/// closes it, git would see EOF and fail fast, and the test would then be about
/// a broken connection instead of a stalled one.
fn stalling_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let mut held = Vec::new();
        while let Ok((sock, _)) = listener.accept() {
            held.push(sock);
        }
    });
    port
}

/// The two clone tests below serialize here.
///
/// Within one binary `cargo test` still runs in parallel, and `Scope::Clone` is
/// the one scope that cannot be made unique per test — so without this, each
/// clone test's cancel would reach the other's clone and both would be flaky for
/// reasons that have nothing to do with the code under test. Repo-scoped tests
/// need no such thing: each names its own temp path.
fn clone_scope_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Cancel `scope`, retrying until an op has actually registered under it.
///
/// A bare `cancel()` immediately after spawning the op would race its
/// registration and signal nothing, and the test would then hang on a clone
/// nobody cancelled — the exact bug it exists to catch, reported as a timeout.
async fn cancel_when_registered(scope: &Scope) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if cancel::cancel(scope) > 0 {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "no op ever registered under {scope:?} — cancellation is not wired up"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn a_stalled_clone_is_cancellable_and_leaves_nothing_behind() {
    let _serialized = clone_scope_lock();
    let port = stalling_server();
    let dest_parent = tempfile::tempdir().unwrap();
    let parent = dest_parent.path().to_path_buf();
    let url = format!("http://127.0.0.1:{port}/stalled.git");

    let clone = tokio::spawn(async move {
        platypusgit_lib::commands::create::run_clone(&url, &parent, "cloned", &CloneOptions::default(), None, |_| {})
            .await
    });

    // Long enough for git to have spawned its transport helper and be sitting on
    // the silent socket, so this cancels a genuinely in-flight clone rather than
    // one that had not started. `cancel_when_registered` covers the slow machine.
    tokio::time::sleep(Duration::from_millis(500)).await;
    cancel_when_registered(&Scope::Clone).await;

    let err = tokio::time::timeout(Duration::from_secs(30), clone)
        .await
        .expect("the cancelled clone never returned — it is still hanging")
        .expect("clone task panicked")
        .expect_err("a cancelled clone must not report success");

    assert!(
        matches!(err, AppError::Cancelled),
        "got {err:?}, expected AppError::Cancelled — git's dying stderr must not \
         be reported to a user who pressed Cancel"
    );
    assert!(
        !dest_parent.path().join("cloned").exists(),
        "a cancelled clone must not leave a partial destination behind — the next \
         attempt would fail validate_clone_target with 'already exists and is not empty'"
    );
}

/// The destination the user picked is theirs; only the clone is undone.
#[tokio::test]
async fn cancelling_puts_back_an_empty_directory_the_user_chose() {
    let _serialized = clone_scope_lock();
    let port = stalling_server();
    let dest_parent = tempfile::tempdir().unwrap();
    let target = dest_parent.path().join("mine");
    std::fs::create_dir(&target).unwrap();
    let parent = dest_parent.path().to_path_buf();
    let url = format!("http://127.0.0.1:{port}/stalled.git");

    let clone = tokio::spawn(async move {
        platypusgit_lib::commands::create::run_clone(&url, &parent, "mine", &CloneOptions::default(), None, |_| {})
            .await
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    cancel_when_registered(&Scope::Clone).await;

    let err = tokio::time::timeout(Duration::from_secs(30), clone)
        .await
        .expect("the cancelled clone never returned")
        .expect("clone task panicked")
        .expect_err("a cancelled clone must not report success");
    assert!(matches!(err, AppError::Cancelled), "got {err:?}");

    assert!(
        target.is_dir(),
        "the empty directory the user picked must survive a cancel"
    );
    assert_eq!(
        std::fs::read_dir(&target).unwrap().count(),
        0,
        "and it must be empty again, not half a clone"
    );
}

#[tokio::test]
async fn a_stalled_fetch_is_cancellable() {
    let port = stalling_server();
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().to_path_buf();
    git(&repo, &["init"]);
    git(
        &repo,
        &["remote", "add", "origin", &format!("http://127.0.0.1:{port}/stalled.git")],
    );

    let fetching = repo.clone();
    let fetch = tokio::spawn(async move {
        platypusgit_lib::commands::net::run_git_authenticated(
            &fetching,
            &["fetch", "origin"],
            None,
        )
        .await
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    // The scope a fetch registers under is its `cwd`, which is what
    // `cancel_network_op` resolves a repo id to — the two must agree or Cancel
    // silently matches nothing.
    cancel_when_registered(&Scope::repo(&repo)).await;

    let err = tokio::time::timeout(Duration::from_secs(30), fetch)
        .await
        .expect("the cancelled fetch never returned — it is still hanging")
        .expect("fetch task panicked")
        .expect_err("a cancelled fetch must not report success");

    assert!(
        matches!(err, AppError::Cancelled),
        "got {err:?}, expected AppError::Cancelled"
    );
}

/// Cancelling one repository's fetch must not reach another's.
#[tokio::test]
async fn a_cancel_is_scoped_to_the_repository_it_names() {
    let port = stalling_server();
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("mine");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init"]);
    git(
        &repo,
        &["remote", "add", "origin", &format!("http://127.0.0.1:{port}/stalled.git")],
    );

    let fetching = repo.clone();
    let fetch = tokio::spawn(async move {
        platypusgit_lib::commands::net::run_git_authenticated(
            &fetching,
            &["fetch", "origin"],
            None,
        )
        .await
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    // A different repository, cancelled while ours is stalled.
    assert_eq!(cancel::cancel(&Scope::repo(&dir.path().join("someone-else"))), 0);
    assert!(
        !fetch.is_finished(),
        "another repository's cancel stopped this repository's fetch"
    );

    // Clean up: stop the real one so the test does not leave git hanging.
    cancel_when_registered(&Scope::repo(&repo)).await;
    let _ = tokio::time::timeout(Duration::from_secs(30), fetch).await;
}

fn git(cwd: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}
