//! The built-in terminal (#243), tested against real ptys.
//!
//! Every assertion here is "the marker eventually appears", never "this read
//! equals": a pty delivers in chunks whose boundaries are not ours to choose,
//! and a shell prints a prompt, echoes the input and prints the output in an
//! order that is the shell's business, not the test's.
//!
//! Two traps these tests were written around, both of which cost a debugging
//! round and are the reason the helpers look the way they do:
//!
//! 1. **A pty echoes its input.** A marker that also appears in the command
//!    text matches the echo, so the assertion passes before the shell has run
//!    anything at all. Every marker here is either an expanded value or a
//!    string that cannot appear in what was typed.
//! 2. **`read` on a pty master does not return while the shell lives.** A
//!    `while Instant::now() < deadline { reader.read(..) }` loop hangs forever
//!    inside the read, because the deadline is only checked between reads. So
//!    reading happens on a thread and the test waits on a channel — which is
//!    also exactly why `TerminalState` gives every session its own reader
//!    thread rather than polling.

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Drain `reader` on a thread, forwarding every chunk as a lossy string.
///
/// The receiver ends when the shell exits and the master reports EOF.
fn drain(mut reader: Box<dyn Read + Send>) -> mpsc::Receiver<String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(String::from_utf8_lossy(&buf[..n]).into_owned()).is_err() {
                break;
            }
        }
    });
    rx
}

/// Accumulate from `rx` until `marker` appears or `secs` elapse.
fn read_until(rx: &mpsc::Receiver<String>, marker: &str, secs: u64) -> String {
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut acc = String::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => {
                acc.push_str(&chunk);
                if acc.contains(marker) {
                    return acc;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    acc
}

/// The shell these tests drive.
///
/// Deliberately NOT `proc::default_shell()`, which is `$SHELL` — the developer's
/// own interactive shell, with their rc files. Two reasons, both learned the
/// hard way: a themed zsh resets the line editor as it starts and DISCARDS
/// input already buffered in the pty, so the test hangs against one machine's
/// dotfiles and passes on another; and a suite whose result depends on who is
/// running it is not a suite. `/bin/sh` reads what is waiting for it.
///
/// `default_shell()` itself is pinned by `default_shell_prefers_the_users_shell`
/// below, which is the part of it worth testing.
#[cfg(unix)]
const TEST_SHELL: &str = "/bin/sh";

#[cfg(unix)]
#[test]
fn spawn_pty_shell_runs_in_the_given_workdir() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Canonicalise: macOS hands out /var/folders/… which is a symlink to
    // /private/var/folders/…, and the shell reports the resolved one.
    let workdir = dir.path().canonicalize().expect("canonicalize");

    let mut session = platypusgit_lib::proc::spawn_pty_shell(
        std::ffi::OsStr::new(TEST_SHELL),
        &workdir,
        24,
        80,
    )
    .expect("spawn a shell");

    let rx = drain(session.master.try_clone_reader().expect("reader"));
    let mut writer = session.master.take_writer().expect("writer");

    writeln!(writer, "printf 'PGIT[%s]END\\n' \"$PWD\"").expect("write");
    writer.flush().expect("flush");

    // The EXPANDED path — see trap 1 in the module doc. `PGIT[%s]END` is on the
    // stream as an echo before the shell has run anything.
    let expected = format!("PGIT[{}]END", workdir.display());
    let out = read_until(&rx, &expected, 15);

    let _ = session.child.kill();
    let _ = session.child.wait();

    assert!(
        out.contains(&expected),
        "the shell's cwd should be the workdir. saw: {out}"
    );
}

/// `$SHELL` is what the user's own terminal runs, and the built-in terminal
/// should not be a *different* shell from the one outside the app.
#[cfg(unix)]
#[test]
fn default_shell_prefers_the_users_shell() {
    let shell = platypusgit_lib::proc::default_shell();
    match std::env::var_os("SHELL").filter(|s| !s.is_empty()) {
        Some(expected) => assert_eq!(shell, expected),
        // No `$SHELL` (a bare CI container): the honest last resort, not empty.
        None => assert_eq!(shell, std::ffi::OsString::from("/bin/sh")),
    }
}

#[test]
fn spawn_pty_shell_rejects_a_shell_that_does_not_exist() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = platypusgit_lib::proc::spawn_pty_shell(
        std::ffi::OsStr::new("/nonexistent/pgit-not-a-shell"),
        dir.path(),
        24,
        80,
    );
    assert!(err.is_err(), "a missing shell must not silently succeed");
}

// ---------------------------------------------------------------------------
// The session registry
// ---------------------------------------------------------------------------

#[cfg(unix)]
mod registry {
    use super::TEST_SHELL;
    use platypusgit_lib::terminal::{EventSink, TermEvent, TerminalState};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// A sink that records every event, so a test can assert on the stream the
    /// frontend would receive rather than on the pty directly. This is the
    /// whole reason `terminal.rs` takes a sink instead of an `AppHandle`.
    #[derive(Default, Clone)]
    struct Recorder(Arc<Mutex<Vec<TermEvent>>>);

    impl Recorder {
        fn sink(&self) -> EventSink {
            let inner = self.0.clone();
            Arc::new(move |ev| inner.lock().expect("sink lock").push(ev))
        }

        /// Everything decoded from `Data` events so far, concatenated. Decoding
        /// here is also the assertion that the payload really is base64.
        fn text(&self) -> String {
            use base64::Engine as _;
            let bytes: Vec<u8> = self
                .0
                .lock()
                .expect("lock")
                .iter()
                .filter_map(|e| match e {
                    TermEvent::Data(p) => Some(
                        base64::engine::general_purpose::STANDARD
                            .decode(&p.data)
                            .expect("the payload is base64"),
                    ),
                    TermEvent::Exit(_) => None,
                })
                .flatten()
                .collect();
            String::from_utf8_lossy(&bytes).into_owned()
        }

        fn saw_exit(&self) -> bool {
            self.0
                .lock()
                .expect("lock")
                .iter()
                .any(|e| matches!(e, TermEvent::Exit(_)))
        }

        /// The first `Data` payload as the frontend would receive it.
        fn first_data_json(&self) -> Option<serde_json::Value> {
            self.0.lock().expect("lock").iter().find_map(|e| match e {
                TermEvent::Data(p) => Some(serde_json::to_value(p).expect("serialise")),
                TermEvent::Exit(_) => None,
            })
        }
    }

    /// Poll until `f` is true or the deadline passes. A pty is asynchronous; a
    /// fixed sleep is either flaky or slow, and this is neither.
    fn wait_for(secs: u64, mut f: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(secs);
        while Instant::now() < deadline {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    fn open_in_tempdir(
        state: &Arc<TerminalState>,
        rec: &Recorder,
        id: &str,
    ) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        state
            .open(
                rec.sink(),
                id,
                std::ffi::OsStr::new(TEST_SHELL),
                dir.path(),
                24,
                80,
            )
            .expect("open a session");
        dir
    }

    #[test]
    fn output_reaches_the_sink_as_base64() {
        let state = Arc::new(TerminalState::default());
        let rec = Recorder::default();
        let _dir = open_in_tempdir(&state, &rec, "repo-a");

        state.write("repo-a", b"echo pgit-ok\n").expect("write");

        assert!(
            wait_for(15, || rec.text().contains("pgit-ok")),
            "the marker should reach the sink. saw: {}",
            rec.text()
        );
        state.close("repo-a");
    }

    /// The wire format is FLAT and camelCase, and this is the test that would
    /// have caught the bug that cost an e2e debugging round.
    ///
    /// `TermEvent` used to be a struct-variant enum, and serde tags an enum
    /// externally: the payload went out as `{"data": {"repoId": …}}` instead of
    /// `{"repoId": …}`. The frontend's first line is `payload.repoId !== repoId`
    /// — `undefined !== "…"` for every event — so the shell ran and not one
    /// byte was ever displayed, with no error anywhere, because dropping
    /// another repository's traffic is what that line is FOR.
    ///
    /// Nothing in the Rust suite or the vitest suite could see it: one side
    /// never serialised, the other mocked the payload in the shape it wanted.
    #[test]
    fn the_wire_payload_is_flat_and_camel_case() {
        let state = Arc::new(TerminalState::default());
        let rec = Recorder::default();
        let _dir = open_in_tempdir(&state, &rec, "repo-a");

        state.write("repo-a", b"echo shape\n").expect("write");
        assert!(wait_for(15, || rec.first_data_json().is_some()));

        let json = rec.first_data_json().expect("a data event");
        let obj = json.as_object().expect("an object");
        assert!(
            obj.contains_key("repoId"),
            "the payload must carry repoId at the TOP level, not nested under a \
             variant tag. got: {json}"
        );
        assert!(obj.contains_key("epoch"), "got: {json}");
        assert!(obj.contains_key("data"), "got: {json}");
        assert_eq!(obj["repoId"], "repo-a");
        // And no variant tag wrapping it.
        assert!(
            !obj.contains_key("Data") && !obj.contains_key("data0"),
            "the enum must not be serialised — emit the inner struct. got: {json}"
        );
        state.close("repo-a");
    }

    #[test]
    fn two_repositories_get_two_independent_sessions() {
        let state = Arc::new(TerminalState::default());
        let a = Recorder::default();
        let b = Recorder::default();
        let _da = open_in_tempdir(&state, &a, "repo-a");
        let _db = open_in_tempdir(&state, &b, "repo-b");

        state.write("repo-a", b"echo only-a\n").expect("write a");
        assert!(wait_for(15, || a.text().contains("only-a")));

        // Closing one must not touch the other.
        state.close("repo-a");
        assert!(!state.is_open("repo-a"));
        assert!(state.is_open("repo-b"));

        state.write("repo-b", b"echo still-b\n").expect("write b");
        assert!(
            wait_for(15, || b.text().contains("still-b")),
            "repo-b should still be alive. saw: {}",
            b.text()
        );
        assert!(
            !a.text().contains("still-b"),
            "sessions must not cross sinks"
        );
        state.close("repo-b");
    }

    #[test]
    fn a_shell_that_exits_reports_and_is_reaped() {
        let state = Arc::new(TerminalState::default());
        let rec = Recorder::default();
        let _dir = open_in_tempdir(&state, &rec, "repo-x");

        state.write("repo-x", b"exit 3\n").expect("write");

        assert!(
            wait_for(15, || rec.saw_exit()),
            "an exiting shell must produce an Exit event"
        );
        assert!(
            wait_for(5, || !state.is_open("repo-x")),
            "the session must retire itself once the shell is gone — no zombie, \
             no leaked reader thread"
        );
    }

    #[test]
    fn opening_twice_yields_one_session() {
        let state = Arc::new(TerminalState::default());
        let rec = Recorder::default();
        let dir = open_in_tempdir(&state, &rec, "repo-a");

        // A panel re-mount must not stack shells.
        state
            .open(
                rec.sink(),
                "repo-a",
                std::ffi::OsStr::new(TEST_SHELL),
                dir.path(),
                24,
                80,
            )
            .expect("second open is a no-op");

        state.write("repo-a", b"echo once\n").expect("write");
        assert!(wait_for(15, || rec.text().contains("once")));

        // One close is enough, because there is one session.
        state.close("repo-a");
        assert!(!state.is_open("repo-a"));
    }

    #[test]
    fn closing_an_unknown_session_is_not_an_error() {
        let state = Arc::new(TerminalState::default());
        state.close("never-opened");
        state.close("never-opened");
        assert!(!state.is_open("never-opened"));
    }

    #[test]
    fn writing_to_a_closed_session_errors_rather_than_panicking() {
        let state = Arc::new(TerminalState::default());
        assert!(state.write("nope", b"x").is_err());
        assert!(state.resize("nope", 10, 10).is_err());
    }

    #[test]
    fn close_all_leaves_nothing_running() {
        let state = Arc::new(TerminalState::default());
        let rec = Recorder::default();
        let _a = open_in_tempdir(&state, &rec, "repo-a");
        let _b = open_in_tempdir(&state, &rec, "repo-b");

        state.close_all();

        assert!(!state.is_open("repo-a"));
        assert!(!state.is_open("repo-b"));
    }
}
