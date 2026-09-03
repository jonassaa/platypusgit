//! Closing the window stops what is in flight (#263 item 2).
//!
//! ## The leak this exists for, as measured
//!
//! Cancellation's backstop for a dropped future is `kill_on_drop(true)`, and a
//! drop is exactly what closing the app does NOT do: `tao::EventLoop::run` is
//! `-> !` and ends in `std::process::exit(exit_code)` on macOS, Linux and
//! Windows alike (tao 0.35.3, `platform_impl/{macos,linux,windows}/event_loop.rs`),
//! and `process::exit` runs no destructors on any stack. Measured directly
//! before this test file was written: a `tokio::process::Command` child spawned
//! with `kill_on_drop(true)` and held by a task was **still alive 500 ms after
//! its parent called `process::exit(0)`**. So a `git clone` outlives the app and
//! carries on populating the destination the Clone dialog was told never got
//! created — the case `commands/create.rs` already carried a comment about.
//!
//! The fix is not a better backstop, it is asking first: a `CloseRequested`
//! handler that cancels everything registered while there is still a process
//! alive to do it.
//!
//! ## Its own test binary
//!
//! `cancel_all` addresses the process-wide registry with no scope to narrow it,
//! so it reaches every op ANY test in the same process has registered. In the
//! lib's own `mod tests` it would cancel its neighbours; here it shares a
//! process only with the tests below, which serialize on one lock.

use std::sync::{Mutex, MutexGuard};

use platypusgit_lib::cancel::{self, Scope};

/// Every test here either calls `cancel_all` or registers something it could
/// reach, so they all take this.
fn all_scopes_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// The gate that keeps the resolver window out of it.
///
/// The merge resolver is a second `WebviewWindow` (label `merge`, see
/// `src/features/merge/openMergeWindow.ts`) and `on_window_event` is app-global:
/// without this, finishing a conflict resolution would kill the fetch running
/// behind it.
#[test]
fn only_the_main_window_closing_ends_the_app() {
    assert!(
        cancel::close_cancels_everything("main"),
        "closing the app's own window must cancel what is in flight"
    );
    assert!(
        !cancel::close_cancels_everything("merge"),
        "closing the merge resolver must not stop a fetch running behind it"
    );
}

#[cfg(unix)]
#[test]
fn closing_the_window_reaches_every_scope_at_once() {
    let _serialized = all_scopes_lock();

    // A clone and a repository op, which is the pair no single `cancel(scope)`
    // call can reach: `Scope::Clone` and `Scope::Repo` are different scopes by
    // construction, and on the way out there is no scope left to name.
    let clone_reg = cancel::register(Scope::Clone);
    let repo_reg = cancel::register(Scope::repo(std::path::Path::new("/tmp/on-close")));
    let mut cloning = spawn_own_group("sleep", "30");
    let mut fetching = spawn_own_group("sleep", "30");
    assert!(clone_reg.attach(cloning.id()));
    assert!(repo_reg.attach(fetching.id()));

    assert_eq!(cancel::cancel_all(), 2, "both ops must be signalled");

    assert!(clone_reg.is_cancelled());
    assert!(repo_reg.is_cancelled());
    use std::os::unix::process::ExitStatusExt as _;
    assert_eq!(
        cloning.wait().expect("wait clone").signal(),
        Some(libc::SIGTERM),
        "the clone must actually be signalled, not merely marked — a marked-only \
         entry is the leak: the app exits and git carries on cloning"
    );
    assert_eq!(
        fetching.wait().expect("wait fetch").signal(),
        Some(libc::SIGTERM)
    );
}

/// On the way out the polite signal is the ONLY one worth sending.
///
/// `cancel()` escalates to `SIGKILL` on a second ask because the user clicking
/// again says the first did not work. There is no second click here and nobody
/// left to notice: what there is instead is git's own `SIGTERM` handling —
/// `remove_lock_file_on_signal` and, in `clone`, `remove_junk_on_signal` — which
/// is the only thing that can still tidy up once our process is gone. A
/// `SIGKILL` on quit would strand `.git/FETCH_HEAD.lock` and half a clone with
/// nothing running that could remove either.
#[cfg(unix)]
#[test]
fn closing_the_window_asks_politely_even_after_a_cancel_click() {
    use std::io::BufRead as _;
    use std::os::unix::process::CommandExt as _;
    let _serialized = all_scopes_lock();

    let scope = Scope::repo(std::path::Path::new("/tmp/on-close-polite"));
    let registration = cancel::register(scope.clone());
    // Ignores SIGTERM, standing in for a git that does not die on the polite
    // ask — surviving is what proves the signal was not SIGKILL.
    let mut child = platypusgit_lib::proc::program("sh")
        .arg("-c")
        .arg("trap '' TERM; echo ready; while :; do sleep 1; done")
        .process_group(0)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("spawn the SIGTERM-ignoring child");
    let mut ready = String::new();
    std::io::BufReader::new(child.stdout.take().expect("stdout"))
        .read_line(&mut ready)
        .expect("read the ready handshake");
    assert_eq!(ready.trim(), "ready");
    assert!(registration.attach(child.id()));

    // The user clicked Cancel once, then closed the window — the state where
    // `cancel()` itself WOULD escalate.
    assert_eq!(cancel::cancel(&scope), 1);
    std::thread::sleep(std::time::Duration::from_millis(200));
    cancel::cancel_all();
    std::thread::sleep(std::time::Duration::from_millis(300));

    assert!(
        child.try_wait().expect("try_wait").is_none(),
        "closing the window must send SIGTERM, never SIGKILL — a killed git \
         cannot run remove_lock_file_on_signal, and there is no app left to \
         clean up after it"
    );
    let _ = child.kill();
    let _ = child.wait();
}

/// Spawn a child in its own process group, the way `proc::git_async` does — via
/// `proc::program`, because `tests/spawn_no_window.rs` fails the build on a raw
/// `Command::new` outside `proc.rs`.
#[cfg(unix)]
fn spawn_own_group(program: &str, arg: &str) -> std::process::Child {
    use std::os::unix::process::CommandExt as _;
    platypusgit_lib::proc::program(program)
        .arg(arg)
        .process_group(0)
        .spawn()
        .unwrap_or_else(|e| panic!("spawn {program} {arg}: {e}"))
}

/// The wiring itself, which no unit test can reach: `on_window_event` takes a
/// closure the Tauri runtime calls, and there is no runtime in a `cargo test`.
///
/// A grep, and honestly so — the same shape as `tests/spawn_no_window.rs` and
/// `test/docs.test.ts`. It cannot prove the handler runs; it can prove nobody
/// deleted it, or quietly dropped the label gate and started cancelling a fetch
/// every time the resolver window closes.
#[test]
fn the_close_handler_is_wired_and_gated_on_the_main_window() {
    let src = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
    )
    .expect("read src/lib.rs");

    assert!(
        src.contains("WindowEvent::CloseRequested"),
        "lib.rs must handle CloseRequested — without it a git clone outlives the \
         app (see this file's module docs for the measurement)"
    );
    assert!(
        src.contains("cancel::cancel_all()"),
        "the CloseRequested handler must cancel every op in flight"
    );
    assert!(
        src.contains("cancel::close_cancels_everything(window.label())"),
        "the cancel must be gated on the window label, or closing the merge \
         resolver kills a fetch running behind it"
    );
    // `CloseRequested` is emitted from tao's `windowShouldClose:` and nowhere
    // else, so it covers the window's own close button and NOT ⌘Q: on macOS
    // `applicationWillTerminate` goes straight to `LoopDestroyed`, which arrives
    // as `RunEvent::Exit`. Without this second hook, quitting with a keystroke
    // still leaks the clone.
    assert!(
        src.contains("tauri::RunEvent::Exit"),
        "the exit path must cancel too — ⌘Q never emits a window CloseRequested"
    );
}
