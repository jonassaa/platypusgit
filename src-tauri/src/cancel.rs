//! Cancelling a long-running child process (#234).
//!
//! # Why a registry and not a channel
//!
//! Every network op in this app is a spawned `git` (`proc::git_async`,
//! `git_async_in`), so cancellation is a signal — the hard part is *addressing*
//! the child from a second, unrelated IPC call.
//!
//! The obvious shape, a `tokio::select!` over `child.wait()` and a cancel
//! future, does not survive contact with the borrow checker: both arms need
//! `&mut child`. The next one, `Arc<Mutex<Child>>` shared with a killer task,
//! deadlocks — the op holds the lock across `wait()`, which is precisely the
//! await the killer needs to interrupt.
//!
//! So the registry does not *ask* the op to stop. It kills the op's child
//! directly, from the cancelling call's own task, and the op then **notices**:
//! its `wait()` returns because the child is dead, and it checks
//! [`Op::is_cancelled`] before mapping stderr to an error. No shared `Child`, no
//! select, no timers.
//!
//! # Why the frontend supplies the id
//!
//! The op we most need to cancel is the one that never answers, so an id minted
//! by the backend and emitted back would leave an unbounded window where the op
//! is running and unaddressable. The frontend generates the id before the invoke
//! (`src/lib/opId.ts`), so the cancel button is live from the first frame.
//!
//! An op with no id is **detached**: it never enters the map and can never be
//! cancelled. That is what lets `push_tag`, LFS, submodule update and the forge
//! PR checkout keep their current behaviour without branching anywhere.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// One cancellable operation.
pub struct Op {
    /// `None` for a detached op — nothing to look up, nothing to cancel.
    id: Option<String>,
    cancelled: AtomicBool,
    /// The child's pid, once it has been spawned. `None` in the window between
    /// registration and spawn, which is exactly the window [`Op::attach`]
    /// closes.
    pid: Mutex<Option<u32>>,
}

impl Op {
    /// An op nobody can cancel. Callers hold one of these instead of an
    /// `Option<&Op>`, so there is no second code path to keep in step.
    pub fn detached() -> Self {
        Self {
            id: None,
            cancelled: AtomicBool::new(false),
            pid: Mutex::new(None),
        }
    }

    fn tracked(id: String) -> Self {
        Self {
            id: Some(id),
            cancelled: AtomicBool::new(false),
            pid: Mutex::new(None),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Record the child we just spawned.
    ///
    /// Returns `false` when a cancel arrived in the window between registration
    /// and the spawn — the caller must then kill its own child (it still holds
    /// `&mut Child`, so `start_kill` is right there) and bail. Without this, a
    /// cancel clicked in the first milliseconds would set the flag, find no pid,
    /// and leave a `git` running with nobody left to stop it.
    pub fn attach(&self, pid: u32) -> bool {
        *self.pid.lock().expect("op pid mutex") = Some(pid);
        !self.is_cancelled()
    }

    /// Cancel: mark, then kill the child's whole process group.
    ///
    /// The **second** call escalates to `SIGKILL`. The user clicking Cancel again
    /// is the escalation signal — a timer would need `tokio::time` and a rule for
    /// how long to wait, and the first click has already given git its chance to
    /// clean up after itself.
    pub fn cancel(&self) {
        let already = self.cancelled.swap(true, Ordering::SeqCst);
        let pid = *self.pid.lock().expect("op pid mutex");
        if let Some(pid) = pid {
            kill_tree(pid, already);
        }
    }
}

/// Every in-flight cancellable op, by id.
#[derive(Default)]
pub struct OpRegistry {
    ops: Mutex<HashMap<String, Arc<Op>>>,
}

impl OpRegistry {
    /// Register an op and hand back a guard that de-registers on drop.
    ///
    /// `id: None` yields a detached op, so a caller that was given no id needs no
    /// special case. A repeat of an id already in the map replaces it: the id is
    /// minted per invoke, so a collision means the frontend re-used one, and the
    /// newer op is the one a cancel is meant for.
    pub fn begin(self: &Arc<Self>, id: Option<&str>) -> OpGuard {
        let op = match id {
            None => Arc::new(Op::detached()),
            Some(id) => {
                let op = Arc::new(Op::tracked(id.to_string()));
                self.ops
                    .lock()
                    .expect("op registry mutex")
                    .insert(id.to_string(), op.clone());
                op
            }
        };
        OpGuard {
            registry: self.clone(),
            op,
        }
    }

    /// Cancel one op. `false` when no op with that id is in flight — a stale
    /// cancel (the op finished between the click and the invoke), which is not an
    /// error the user needs to hear about.
    pub fn cancel(&self, id: &str) -> bool {
        let op = self.ops.lock().expect("op registry mutex").get(id).cloned();
        match op {
            Some(op) => {
                op.cancel();
                true
            }
            None => false,
        }
    }

    /// Cancel everything in flight. The window-close path (`lib.rs`): a `git`
    /// that outlives the app is a transfer nobody can see and nobody can stop.
    pub fn cancel_all(&self) -> usize {
        // Cloned out from under the lock: `Op::cancel` spawns `taskkill` on
        // Windows, and holding the registry lock across that would block every
        // op that is trying to finish.
        let ops: Vec<Arc<Op>> = self
            .ops
            .lock()
            .expect("op registry mutex")
            .values()
            .cloned()
            .collect();
        for op in &ops {
            op.cancel();
        }
        ops.len()
    }

    fn finish(&self, id: &str) {
        self.ops.lock().expect("op registry mutex").remove(id);
    }
}

/// Keeps an op in the registry for the lifetime of the operation.
///
/// A guard rather than a `finish()` call at the end of each command: every
/// cancellable op has `?` returns in it, and an entry left behind would make a
/// later cancel signal a pid that has since been recycled.
pub struct OpGuard {
    registry: Arc<OpRegistry>,
    op: Arc<Op>,
}

impl OpGuard {
    pub fn op(&self) -> &Op {
        &self.op
    }
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        if let Some(id) = &self.op.id {
            self.registry.finish(id);
        }
    }
}

/// Kill `pid` and everything it spawned.
///
/// # Why the process GROUP
///
/// `git clone` over https spawns `git-remote-https`; over ssh it spawns `ssh`.
/// Killing only `git` leaves that child holding the connection, so the transfer
/// the user cancelled carries on.
///
/// # Why SIGTERM first
///
/// git installs signal handlers that remove its lock files (`lockfile.c`) and,
/// in `clone`, the partially-written destination (`remove_junk_on_signal`).
/// SIGKILL skips all of it, so a SIGKILLed pull leaves `.git/index.lock` behind
/// and the *next* pull fails with "Unable to create '…/index.lock': File
/// exists". A cancel that breaks the following operation is worse than no cancel.
#[cfg(unix)]
pub fn kill_tree(pid: u32, hard: bool) {
    let sig = if hard { libc::SIGKILL } else { libc::SIGTERM };
    let pid = pid as libc::pid_t;
    // `getpgid` first, and `killpg` ONLY when the child really is its own group
    // leader. `proc::git_async*` puts it in one, but a future spawn site that
    // forgot would otherwise have us signal OUR OWN process group — i.e. kill
    // the app, from a cancel button. The check makes that unreachable rather
    // than merely unlikely.
    let group_leader = unsafe { libc::getpgid(pid) } == pid;
    unsafe {
        if group_leader {
            libc::killpg(pid, sig);
        } else {
            libc::kill(pid, sig);
        }
    }
}

/// The Windows tree-kill's argv.
///
/// A pure function, compiled and tested on **every** platform even though only
/// Windows runs it — the same split `reveal.rs` uses for its per-platform argv,
/// and for the same reason: `#[cfg(windows)]` code is invisible to this repo's
/// PR CI (only `release.yml` builds Windows), so a mistake here would surface at
/// release time. Keeping the interesting half platform-independent leaves three
/// lines of genuinely conditional code.
///
/// * `/T` — the whole tree. `git` is rarely the process doing the waiting; this
///   is Windows' answer to the process group unix gets from `killpg`.
/// * `/F` — forced. There is no graceful option for a console child spawned with
///   `CREATE_NO_WINDOW`: it has no console for `GenerateConsoleCtrlEvent` to
///   signal, and plain `taskkill` sends a `WM_CLOSE` that a console app ignores.
// Only the `#[cfg(windows)]` sibling below calls it, so off Windows the sole
// caller is its own test — which `dead_code` does not count.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn taskkill_args(pid: u32) -> [String; 4] {
    [
        "/F".to_string(),
        "/T".to_string(),
        "/PID".to_string(),
        pid.to_string(),
    ]
}

/// Windows has no SIGTERM, so git gets no chance to remove its lock files —
/// see [`taskkill_args`]. `discard_partial_clone` covers the clone destination;
/// a stale `index.lock` after a cancelled pull is the known remaining gap,
/// recorded in `docs/dev/backend.md`.
///
/// Fire-and-forget: `taskkill` is spawned and not awaited, because `cancel()` is
/// called from a sync window-event handler as well as from a command.
#[cfg(windows)]
pub fn kill_tree(pid: u32, _hard: bool) {
    // Through `proc::program` — `tests/spawn_no_window.rs` fails the build on a
    // raw `Command::new` anywhere outside proc.rs.
    let _ = crate::proc::program("taskkill")
        .args(taskkill_args(pid))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> Arc<OpRegistry> {
        Arc::new(OpRegistry::default())
    }

    #[test]
    fn a_detached_op_is_never_cancelled() {
        let reg = registry();
        let guard = reg.begin(None);
        // Nothing to look up, so the only way to cancel it would be by id.
        assert!(!reg.cancel("anything"));
        assert!(!guard.op().is_cancelled());
    }

    #[test]
    fn cancelling_a_tracked_op_marks_it() {
        let reg = registry();
        let guard = reg.begin(Some("op-1"));
        assert!(reg.cancel("op-1"));
        assert!(guard.op().is_cancelled());
    }

    #[test]
    fn cancelling_an_unknown_id_is_not_an_error() {
        // A cancel that lost the race with the op finishing. The user gets
        // nothing, which is correct: the op they wanted stopped has stopped.
        assert!(!registry().cancel("op-that-finished"));
    }

    #[test]
    fn attach_refuses_after_a_cancel_has_landed() {
        // The window this exists for: Cancel clicked between `begin` and
        // `spawn`. `false` tells the caller to kill the child it is holding.
        let reg = registry();
        let guard = reg.begin(Some("op-2"));
        reg.cancel("op-2");
        assert!(!guard.op().attach(999_999));
    }

    #[test]
    fn attach_accepts_while_the_op_is_live() {
        let reg = registry();
        let guard = reg.begin(Some("op-3"));
        assert!(guard.op().attach(999_999));
    }

    #[test]
    fn dropping_the_guard_deregisters() {
        let reg = registry();
        {
            let _guard = reg.begin(Some("op-4"));
            assert!(reg.ops.lock().unwrap().contains_key("op-4"));
        }
        // Or a later cancel signals a pid that has since been recycled.
        assert!(!reg.ops.lock().unwrap().contains_key("op-4"));
        assert!(!reg.cancel("op-4"));
    }

    #[test]
    fn cancel_all_marks_every_op_in_flight() {
        let reg = registry();
        let a = reg.begin(Some("op-a"));
        let b = reg.begin(Some("op-b"));
        assert_eq!(reg.cancel_all(), 2);
        assert!(a.op().is_cancelled());
        assert!(b.op().is_cancelled());
    }

    #[test]
    fn cancel_all_with_nothing_in_flight_does_nothing() {
        assert_eq!(registry().cancel_all(), 0);
    }

    #[test]
    fn re_using_an_id_replaces_the_entry_so_cancel_hits_the_newer_op() {
        let reg = registry();
        let first = reg.begin(Some("dup"));
        let second = reg.begin(Some("dup"));
        assert!(reg.cancel("dup"));
        assert!(second.op().is_cancelled());
        assert!(!first.op().is_cancelled());
    }

    /// Runs everywhere, kills only on Windows. `/T` is the load-bearing flag:
    /// without it the transport helper (`git-remote-https`, `ssh`) survives the
    /// cancel and the transfer carries on.
    #[test]
    fn the_windows_tree_kill_asks_for_the_whole_tree_by_pid() {
        assert_eq!(
            taskkill_args(4321),
            ["/F".to_string(), "/T".to_string(), "/PID".to_string(), "4321".to_string()]
        );
    }

    /// A cancel with no pid recorded must still MARK the op, or the op would
    /// spawn its child and then run to completion having never noticed.
    #[test]
    fn cancelling_before_the_spawn_still_marks() {
        let reg = registry();
        let guard = reg.begin(Some("op-5"));
        reg.cancel("op-5");
        assert!(guard.op().is_cancelled());
    }
}
