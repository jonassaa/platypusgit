//! Live pty sessions for the built-in terminal (#243).
//!
//! Shape borrowed from `watcher.rs`: a `Default`-constructed state object is
//! `manage`d on the Tauri app, the handlers in `commands/terminal.rs` stay
//! thin, and all of the lifetime management lives here.
//!
//! # Why this module knows nothing about Tauri
//!
//! Output leaves through an injected [`EventSink`] rather than an `AppHandle`.
//! Two reasons, in order of importance: an integration test can supply a
//! recording sink and assert on the exact stream the frontend would see, which
//! an `AppHandle` makes impossible outside a running app; and the reader thread
//! then depends on one closure instead of the whole Tauri runtime.
//!
//! # Why there is not a single logging call in this file
//!
//! A terminal is where secrets get typed — a `sudo` password, a token pasted at
//! a prompt. The property we want is that bytes read from the pty reach exactly
//! one destination, the sink, and nothing else. That is easy to state and hard
//! to keep by care alone, so it is kept structurally: this module logs nothing
//! at all, `tests/terminal_privacy.rs` fails the build if that changes, and the
//! lifecycle logging worth having lives in `commands/terminal.rs`, which sees
//! ids and exit codes and never a byte of traffic.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;

/// A chunk of pty output. `data` is **base64**.
///
/// Not a `String`: pty output is arbitrary bytes, and an 8 KiB read splits a
/// multi-byte character at the boundary about as often as you would expect.
/// `from_utf8_lossy` would replace the split character with U+FFFD, so the user
/// would see a replacement glyph inside a filename — intermittently, and only
/// for non-ASCII, which is the worst kind of bug to be told about. xterm.js
/// decodes UTF-8 incrementally across chunks, which is the correct place for it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermData {
    pub repo_id: String,
    pub epoch: u64,
    pub data: String,
}

/// The shell exited. `code` is `None` when it was signalled, or when the
/// session had already been retired by an explicit close.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermExit {
    pub repo_id: String,
    pub epoch: u64,
    pub code: Option<i32>,
}

/// What a session tells the frontend.
///
/// # Why the variants wrap structs instead of carrying fields
///
/// This enum is a ROUTING type — it tells `commands/terminal.rs` which event
/// name to emit — and it is deliberately **not** `Serialize`. What goes on the
/// wire is the inner struct, flat.
///
/// A struct-variant enum looks tidier and is a trap: serde tags externally by
/// default, so `TermEvent::Data { .. }` serialises as `{"data": {"repoId": …}}`
/// rather than `{"repoId": …}`. The frontend's first check is
/// `payload.repoId !== repoId`, which is then `undefined !== "…"` for every
/// event, so the terminal opens, the shell runs, and **not one byte is ever
/// displayed** — with no error anywhere, because dropping a foreign
/// repository's traffic is exactly what that line is supposed to do sometimes.
/// Cost a full e2e debugging round; the shape below makes it unrepresentable.
pub enum TermEvent {
    Data(TermData),
    Exit(TermExit),
}

/// Where a session's events go.
///
/// `commands/terminal.rs` supplies one that emits on the Tauri app; tests
/// supply one that records.
pub type EventSink = Arc<dyn Fn(TermEvent) + Send + Sync>;

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    epoch: u64,
}

/// Every live pty, keyed by repository.
///
/// Keying by repository id is what makes "one shell per repository tab" a
/// property of the data structure rather than a rule the frontend has to
/// remember.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
    next_epoch: AtomicU64,
}

impl TerminalState {
    /// Start a shell for `repo_id`, or return the epoch of the one already
    /// running.
    ///
    /// Idempotent on purpose: a panel re-mount, a fast double toggle and a tab
    /// re-activation all reach here, and none of them should stack a shell.
    pub fn open(
        self: &Arc<Self>,
        sink: EventSink,
        repo_id: &str,
        shell: &OsStr,
        workdir: &Path,
        rows: u16,
        cols: u16,
    ) -> std::io::Result<u64> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        if let Some(existing) = sessions.get(repo_id) {
            return Ok(existing.epoch);
        }

        // The spawn happens UNDER the lock, and that is deliberate rather than
        // sloppy: the check above and the insert below have to be one atomic
        // step, or two concurrent `term_open`s for the same repository — a
        // double toggle, a re-mount racing a tab activation — both miss the
        // existing session and both spawn a shell, leaving one orphaned with
        // nothing holding its handle. Same shape as the stash TOCTOU rule.
        // The cost is a few milliseconds of contention on a mutex only
        // terminals touch, which is the cheaper half of the trade.
        let session = crate::proc::spawn_pty_shell(shell, workdir, rows, cols)?;
        let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);

        // `portable_pty` reports these as `anyhow::Error`, which `?` cannot
        // convert into `io::Error`. Mapped rather than propagated so the whole
        // module keeps one error type and the caller keeps one match arm.
        let reader = session
            .master
            .try_clone_reader()
            .map_err(|e| std::io::Error::other(format!("could not read the pty: {e}")))?;
        let writer = session
            .master
            .take_writer()
            .map_err(|e| std::io::Error::other(format!("could not write to the pty: {e}")))?;

        spawn_reader(
            Arc::clone(self),
            sink,
            repo_id.to_string(),
            epoch,
            reader,
        );

        sessions.insert(
            repo_id.to_string(),
            Session {
                master: session.master,
                writer,
                child: session.child,
                epoch,
            },
        );
        Ok(epoch)
    }

    /// Send input to the shell.
    pub fn write(&self, repo_id: &str, data: &[u8]) -> std::io::Result<()> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        let session = sessions
            .get_mut(repo_id)
            .ok_or_else(|| std::io::Error::other("no terminal session for this repository"))?;
        session.writer.write_all(data)?;
        session.writer.flush()
    }

    pub fn resize(&self, repo_id: &str, rows: u16, cols: u16) -> std::io::Result<()> {
        let sessions = self.sessions.lock().expect("terminal sessions lock");
        let session = sessions
            .get(repo_id)
            .ok_or_else(|| std::io::Error::other("no terminal session for this repository"))?;
        session
            .master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| std::io::Error::other(format!("could not resize the pty: {e}")))
    }

    /// Kill the shell and forget the session.
    ///
    /// Idempotent — killing a child that has already exited is not an error,
    /// and neither is closing nothing.
    pub fn close(&self, repo_id: &str) {
        // Removed from the map BEFORE the kill, and the lock dropped before the
        // wait: `wait` blocks, and holding the sessions mutex across it would
        // stall every other repository's terminal behind this one.
        let session = self
            .sessions
            .lock()
            .expect("terminal sessions lock")
            .remove(repo_id);
        if let Some(mut session) = session {
            let _ = session.child.kill();
            // Reap, so the dying shell does not become a zombie. The reader
            // thread ends on its own once the master reports EOF.
            let _ = session.child.wait();
        }
    }

    pub fn is_open(&self, repo_id: &str) -> bool {
        self.sessions
            .lock()
            .expect("terminal sessions lock")
            .contains_key(repo_id)
    }

    /// Close every session. Called when the window goes away, so no shell
    /// outlives the app that hosts it.
    pub fn close_all(&self) {
        let ids: Vec<String> = self
            .sessions
            .lock()
            .expect("terminal sessions lock")
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.close(&id);
        }
    }

    /// Drop the session `epoch` belongs to, if it is still the current one, and
    /// return its exit code.
    ///
    /// The epoch check is the fence. A reader that reaches EOF just after the
    /// user closed and reopened the terminal would otherwise remove the NEW
    /// session — killing a shell the user is looking at, from a thread that
    /// belongs to a dead one.
    fn retire(&self, repo_id: &str, epoch: u64) -> Option<i32> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        match sessions.get(repo_id) {
            Some(s) if s.epoch == epoch => {}
            _ => return None,
        }
        let mut session = sessions.remove(repo_id)?;
        drop(sessions);
        session
            .child
            .wait()
            .ok()
            .map(|status| status.exit_code() as i32)
    }
}

/// One blocking reader thread per session.
///
/// A free function rather than a method so it cannot accidentally capture the
/// sessions mutex: reading under that lock would serialise every terminal in
/// the app behind the slowest one, and would deadlock the first `write` that
/// arrived during a read. A pty read does not return while the shell lives, so
/// this genuinely has to be a thread — polling it with a deadline hangs inside
/// the read.
fn spawn_reader(
    state: Arc<TerminalState>,
    sink: EventSink,
    repo_id: String,
    epoch: u64,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::Builder::new()
        .name(format!("pty-reader-{epoch}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => sink(TermEvent::Data(TermData {
                        repo_id: repo_id.clone(),
                        epoch,
                        data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                    })),
                }
            }
            // EOF means the shell is gone. Retire under the epoch fence FIRST,
            // then report, so `is_open` is already false by the time the
            // frontend reacts to the exit.
            let code = state.retire(&repo_id, epoch);
            sink(TermEvent::Exit(TermExit {
                repo_id,
                epoch,
                code,
            }));
        })
        .expect("spawn a pty reader thread");
}
