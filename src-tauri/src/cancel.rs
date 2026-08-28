//! Cancelling an in-flight network git subprocess (#234, hardened by #263).
//!
//! Before this module a clone, fetch, pull or push that hung could only be
//! escaped by force-quitting the app — `run_clone` said so in a comment, and
//! `run_git_authenticated` simply awaited `output()` forever.
//!
//! ## The shape
//!
//! Cancellation is registered at the two choke points every network op already
//! goes through — `commands::create::run_clone` and
//! `commands::net::run_git_authenticated` — rather than per command. That is the
//! same reason the credential policy lives in one place: a second cancel path
//! would be a network op nobody can stop. A new network op inherits
//! cancellation by using `run_git_authenticated`, with nothing to remember.
//!
//! ## Scope, not op id
//!
//! An op is registered under a [`Scope`] — "the clone", or "this repository" —
//! not under an id the frontend minted. Two reasons:
//!
//! * The UI already has exactly one of these in flight per scope: the Clone
//!   dialog is `busy`-gated, and the Fetch/Pull/Push buttons carry a `loading`
//!   spinner keyed on `activity`. There is nothing finer for a user to point at.
//! * The auto-fetch timer can stack fetches behind a stalled one, and those are
//!   ops the user never started and has no id for. Cancelling a *scope* reaches
//!   the whole pile; cancelling an id would leave it.
//!
//! So `cancel(Scope::Repo(path))` stops every network op running on that
//! repository, which is what "Cancel" next to a stuck status line has to mean.
//!
//! ## `cancel()` kills directly, by pid — not through a shared `Child`
//!
//! The obvious shape, a `tokio::select!` over `child.wait()` and a cancel
//! future, does not survive contact with the borrow checker: both arms need
//! `&mut child`. The next one, `Arc<Mutex<Child>>` shared with the cancelling
//! call, deadlocks — the op holds the lock across `wait()`, which is precisely
//! the await the killer needs to interrupt.
//!
//! So [`Registration::attach`] records the child's pid in the registry, and
//! [`cancel`] signals that pid **directly, from the cancelling call's own
//! task** — `cancel_network_op` never touches the op's `Child` at all. The op
//! then **notices**: its `wait()`/`wait_with_output()` returns because the
//! child is dead, and it checks [`Registration::is_cancelled`] before mapping
//! stderr to an error.
//!
//! ## SIGTERM first, to the child's own process group; SIGKILL on a second ask
//!
//! Two things were wrong with the pre-#263 behaviour (an immediate
//! `start_kill()` / `kill_on_drop`, i.e. always `SIGKILL`, always just the one
//! child):
//!
//! * **Wrong signal.** Git installs `remove_lock_file_on_signal` (`lockfile.c`)
//!   for SIGINT / SIGHUP / SIGTERM / SIGQUIT / SIGPIPE — **SIGKILL is
//!   uncatchable**, so a SIGKILLed git never runs it. A cancel that lands while
//!   a fetch is writing refs could strand `.git/FETCH_HEAD.lock`, and the next
//!   fetch fails with "Unable to create '…/FETCH_HEAD.lock': File exists." A
//!   cancel button whose after-effect is a broken repository is worse than no
//!   cancel button. [`kill_tree`] sends `SIGTERM` first, giving git the same
//!   chance to clean up after itself that Ctrl-C would.
//! * **Wrong process.** `git clone`/`fetch`/`pull`/`push` spawns
//!   `git-remote-https` (https) or `ssh` (ssh) to do the actual transfer; a
//!   SIGKILLed **parent** cannot take that child with it, so it survives until
//!   its own blocked read times out. `proc::git_async`/`git_async_in` now put
//!   the child in its own process group (`process_group(0)`), and `kill_tree`
//!   signals the **group**, reaching the transport helper too.
//!
//! A **second** cancel of the same op escalates straight to `SIGKILL`: the
//! user clicking Cancel again is the escalation signal, so there is no timer
//! and no rule for how long the first click gets to work. [`kill_tree`] checks
//! `getpgid(pid) == pid` before using `killpg` — a future spawn site that
//! forgot `process_group(0)` degrades to a single-process kill instead of
//! signalling our OWN process group, i.e. the app, from a cancel button.
//!
//! Windows has no SIGTERM, and a `CREATE_NO_WINDOW` child has no console for
//! `GenerateConsoleCtrlEvent` to signal — so there, `kill_tree` is always the
//! forceful `taskkill /F /T`, tree and all, on both the soft and hard call.
//! Git gets no chance to clean up its lock files on Windows; that gap is
//! documented, not fixed, here.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// What a cancellation request addresses.
///
/// Deliberately coarse — see the module docs. `Clone` has no repository yet
/// (that is the whole point of a clone), so it cannot be a `Repo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    /// The clone the Clone dialog is running. One at a time by construction.
    Clone,
    /// Every network op running on the repository at this working-directory
    /// path. The path comes from `GitBackend::repo_path`, which is also where
    /// the ops themselves get their `cwd` — the two must keep agreeing, or a
    /// cancel would silently match nothing.
    Repo(PathBuf),
}

impl Scope {
    /// The scope for a network op running in `cwd`.
    pub fn repo(cwd: &Path) -> Self {
        Scope::Repo(cwd.to_path_buf())
    }
}

/// A live op's entry in the registry. Removed on drop, so a finished op cannot
/// be "cancelled" into a later, unrelated one.
#[derive(Debug)]
struct Entry {
    id: u64,
    scope: Scope,
    /// The child's pid, once [`Registration::attach`] has recorded it. `None`
    /// in the window between registration and spawn — a `cancel()` landing
    /// then has nothing to signal yet, so it only marks `cancel_requested`;
    /// `attach` is what closes that window (see its doc comment).
    pid: Option<u32>,
    /// Whether `cancel()` has been called for this entry at least once. The
    /// FIRST call is a `SIGTERM`; every call after that escalates to
    /// `SIGKILL` — see the module docs.
    cancel_requested: bool,
}

fn registry() -> &'static Mutex<Vec<Entry>> {
    static REGISTRY: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

/// A live op's handle into the registry. Deregisters on drop, so a later
/// cancel signal cannot reach a pid that has since been recycled by the OS.
#[derive(Debug)]
pub struct Registration {
    id: u64,
}

impl Registration {
    /// Record the pid of the child just spawned under this registration.
    ///
    /// Returns `false` when a cancel already landed in the window between
    /// [`register`] and the spawn — `cancel()` found no pid to signal that
    /// time, so it could only mark the entry, and nothing has been signalled
    /// at the OS level yet. The caller must then kill and reap the child
    /// itself (it still holds `&mut Child` right there) and report
    /// `AppError::Cancelled`, exactly as if the OS-level kill had already run.
    pub fn attach(&self, pid: u32) -> bool {
        let mut live = registry().lock().unwrap_or_else(|e| e.into_inner());
        match live.iter_mut().find(|e| e.id == self.id) {
            Some(entry) => {
                entry.pid = Some(pid);
                !entry.cancel_requested
            }
            // Deregistered already, somehow — treat it the same as "already
            // cancelled" rather than silently letting the child run.
            None => false,
        }
    }

    /// Whether `cancel()` has been called for this op, without awaiting
    /// anything.
    ///
    /// The call sites use this after the child has exited — including a
    /// child that died of its own accord at the same moment `cancel()` ran —
    /// because the request is what decides the outcome, not who got there
    /// first: git's dying stderr must not be reported as a `Network` failure
    /// to a user who pressed Cancel.
    pub fn is_cancelled(&self) -> bool {
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|e| e.id == self.id)
            .map(|e| e.cancel_requested)
            .unwrap_or(true)
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut live = registry().lock().unwrap_or_else(|e| e.into_inner());
        live.retain(|e| e.id != self.id);
    }
}

/// Announce a network op as cancellable, until the returned guard is dropped.
///
/// A `Vec` and not a map: this holds the ops in flight right now — a handful at
/// the very worst — and a scope legitimately has several entries (the auto-fetch
/// pile the module docs describe), which a keyed map would have had to model
/// anyway.
pub fn register(scope: Scope) -> Registration {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(Entry {
            id,
            scope,
            pid: None,
            cancel_requested: false,
        });
    Registration { id }
}

/// Cancel every op registered under `scope`. Answers how many were signalled,
/// which is 0 when nothing was running — not an error: the op can simply have
/// finished between the user reading the status line and clicking Cancel.
///
/// Escalates per-entry: an entry cancelled for the first time gets `SIGTERM`
/// (to its process group); an entry that was already asked to stop gets
/// `SIGKILL`, because a second click is the user telling us the first one did
/// not work.
pub fn cancel(scope: &Scope) -> usize {
    let mut live = registry().lock().unwrap_or_else(|e| e.into_inner());
    let mut signalled = 0;
    for entry in live.iter_mut().filter(|e| &e.scope == scope) {
        let hard = entry.cancel_requested;
        entry.cancel_requested = true;
        if let Some(pid) = entry.pid {
            kill_tree(pid, hard);
        }
        signalled += 1;
    }
    signalled
}

/// Kill `pid` and everything spawned into its process group.
///
/// # Why the process group
///
/// `git clone` over https spawns `git-remote-https`; over ssh it spawns `ssh`.
/// Killing only `git` leaves that child holding the connection, so the
/// transfer the user cancelled carries on. `proc::git_async`/`git_async_in`
/// put the child in its own group (`process_group(0)`); this signals the
/// whole group.
///
/// # Why SIGTERM first
///
/// Git installs signal handlers that remove its lock files (`lockfile.c`) and,
/// in `clone`, the partially-written destination (`remove_junk_on_signal`).
/// `SIGKILL` skips all of it, so a SIGKILLed pull can leave `.git/index.lock`
/// behind, and the *next* pull fails with "Unable to create '…/index.lock':
/// File exists." — a cancel that breaks the following operation is worse than
/// no cancel. `hard` is `true` only on the second (or later) cancel of the
/// same op.
#[cfg(unix)]
fn kill_tree(pid: u32, hard: bool) {
    let sig = if hard { libc::SIGKILL } else { libc::SIGTERM };
    let pid = pid as libc::pid_t;
    // `getpgid` first, and `killpg` ONLY when the child really is its own
    // group leader. `proc::git_async`/`git_async_in` put it in one, but a
    // future spawn site that forgot would otherwise have this signal OUR OWN
    // process group — i.e. kill the app, from a cancel button. The check
    // makes that unreachable rather than merely unlikely.
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
/// A pure function, compiled and tested on every platform even though only
/// Windows runs it — the same split `reveal.rs` uses for its per-platform
/// argv, and for the same reason: `#[cfg(windows)]` code is invisible to this
/// repo's PR CI (only `release.yml` builds Windows), so a mistake here would
/// surface at release time. Keeping the interesting half platform-independent
/// leaves three lines of genuinely conditional code.
///
/// * `/T` — the whole tree. `git` is rarely the process actually blocked on
///   the network; this is Windows' answer to the process group unix gets from
///   `killpg`.
/// * `/F` — forced. There is no graceful option for a console child spawned
///   with `CREATE_NO_WINDOW`: it has no console for `GenerateConsoleCtrlEvent`
///   to signal, and a plain `taskkill` sends a `WM_CLOSE` a console app
///   ignores.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn taskkill_args(pid: u32) -> [String; 4] {
    [
        "/F".to_string(),
        "/T".to_string(),
        "/PID".to_string(),
        pid.to_string(),
    ]
}

/// Windows has no `SIGTERM`, so git gets no chance to remove its lock files —
/// see [`taskkill_args`]. The `hard` distinction that matters on unix collapses
/// to one behaviour here; documented in `docs/dev/backend.md` as a known,
/// accepted gap rather than something this fixes.
///
/// Fire-and-forget: `taskkill` is spawned and not awaited, so a slow-to-die
/// tree cannot make a click on Cancel itself hang.
#[cfg(windows)]
fn kill_tree(pid: u32, _hard: bool) {
    // Through `proc::program` — `tests/spawn_no_window.rs` fails the build on
    // a raw `Command::new` anywhere outside `proc.rs`.
    let _ = crate::proc::program("taskkill")
        .args(taskkill_args(pid))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The registry is process-wide and `cargo test` runs these in parallel, so
    /// every test below addresses a scope only it names. `Scope::Clone` is the
    /// one scope that cannot be made unique — it is a unit variant — so the two
    /// tests that touch it serialize here instead. Without this, one test's
    /// `cancel(&Scope::Clone)` reaches the other's registration and both are
    /// flaky.
    fn clone_scope_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn cancel_signals_a_registered_op() {
        let scope = Scope::repo(Path::new("/tmp/signal-one"));
        let registration = register(scope.clone());
        assert!(!registration.is_cancelled());
        assert_eq!(cancel(&scope), 1);
        assert!(registration.is_cancelled());
    }

    #[test]
    fn a_clone_is_cancellable_without_a_repository() {
        let _serialized = clone_scope_lock();
        let registration = register(Scope::Clone);
        assert_eq!(cancel(&Scope::Clone), 1);
        assert!(registration.is_cancelled());
    }

    #[test]
    fn dropping_the_guard_deregisters() {
        let registration = register(Scope::repo(Path::new("/tmp/deregister")));
        drop(registration);
        assert_eq!(cancel(&Scope::repo(Path::new("/tmp/deregister"))), 0);
    }

    #[test]
    fn scopes_do_not_bleed_into_each_other() {
        let a = register(Scope::repo(Path::new("/tmp/a")));
        let b = register(Scope::repo(Path::new("/tmp/b")));

        assert_eq!(cancel(&Scope::repo(Path::new("/tmp/b"))), 1);

        assert!(!a.is_cancelled(), "/tmp/a must be untouched");
        assert!(b.is_cancelled());
    }

    /// The auto-fetch pile: several ops share one scope, and Cancel has to
    /// reach all of them or the stalled one nobody can see stays stalled.
    #[test]
    fn one_cancel_reaches_every_op_in_the_scope() {
        let path = Path::new("/tmp/pile");
        let g1 = register(Scope::repo(path));
        let g2 = register(Scope::repo(path));
        let g3 = register(Scope::repo(path));

        assert_eq!(cancel(&Scope::repo(path)), 3);

        assert!(g1.is_cancelled() && g2.is_cancelled() && g3.is_cancelled());
    }

    /// A clone's scope must not be cancelled by a repo op — cancelling a fetch
    /// on some open repository cannot take the Clone dialog's clone with it.
    #[test]
    fn a_repo_cancel_leaves_the_clone_alone() {
        let _serialized = clone_scope_lock();
        let clone_reg = register(Scope::Clone);
        let _repo_reg = register(Scope::repo(Path::new("/tmp/other")));
        cancel(&Scope::repo(Path::new("/tmp/other")));
        assert!(!clone_reg.is_cancelled());
    }

    #[test]
    fn attach_accepts_while_the_op_is_live() {
        let registration = register(Scope::repo(Path::new("/tmp/attach-live")));
        assert!(registration.attach(999_999));
    }

    /// The window `attach` exists for: Cancel clicked between `register` and
    /// the spawn. No pid is on file yet, so `cancel()` could only mark the
    /// entry — `attach` must hand that back so the caller kills the child it
    /// is holding instead of letting it run unnoticed.
    #[test]
    fn attach_refuses_after_a_cancel_has_landed_first() {
        let scope = Scope::repo(Path::new("/tmp/attach-race"));
        let registration = register(scope.clone());
        cancel(&scope);
        assert!(!registration.attach(999_999));
    }

    #[test]
    fn cancelling_before_any_op_registers_is_not_an_error() {
        assert_eq!(cancel(&Scope::repo(Path::new("/tmp/never-registered"))), 0);
    }

    /// Runs everywhere, kills only on Windows. `/T` is the load-bearing flag:
    /// without it the transport helper (`git-remote-https`, `ssh`) survives
    /// the cancel and the transfer carries on.
    #[test]
    fn the_windows_tree_kill_asks_for_the_whole_tree_by_pid() {
        assert_eq!(
            taskkill_args(4321),
            [
                "/F".to_string(),
                "/T".to_string(),
                "/PID".to_string(),
                "4321".to_string()
            ]
        );
    }

    // --- kill_tree (unix): real child processes, real signals ---
    //
    // Spawned via `crate::proc::program` rather than a bare `Command::new`, like
    // every other spawn in this crate (`tests/spawn_no_window.rs` fails the
    // build on one outside `proc.rs`) — `process_group`/`arg` are still just
    // `std::process::Command` methods, chained on afterwards.

    #[cfg(unix)]
    fn spawn_own_group(program: &str, arg: &str) -> std::process::Child {
        use std::os::unix::process::CommandExt as _;
        crate::proc::program(program)
            .arg(arg)
            .process_group(0)
            .spawn()
            .unwrap_or_else(|e| panic!("spawn {program} {arg}: {e}"))
    }

    #[cfg(unix)]
    #[test]
    fn kill_tree_soft_sends_sigterm() {
        let mut child = spawn_own_group("sleep", "30");
        kill_tree(child.id(), false);
        let status = child.wait().expect("wait");
        use std::os::unix::process::ExitStatusExt as _;
        assert_eq!(
            status.signal(),
            Some(libc::SIGTERM),
            "the first cancel must ask nicely, not SIGKILL"
        );
    }

    #[cfg(unix)]
    #[test]
    fn kill_tree_hard_sends_sigkill() {
        let mut child = spawn_own_group("sleep", "30");
        kill_tree(child.id(), true);
        let status = child.wait().expect("wait");
        use std::os::unix::process::ExitStatusExt as _;
        assert_eq!(
            status.signal(),
            Some(libc::SIGKILL),
            "a second cancel of the same op must escalate"
        );
    }

    /// The whole reason for the process group: a sibling spawned into the same
    /// group (standing in for `git-remote-https`/`ssh`) must die too, or the
    /// transfer the user cancelled carries on underneath them.
    #[cfg(unix)]
    #[test]
    fn kill_tree_reaches_every_process_in_the_group() {
        use std::os::unix::process::CommandExt as _;
        let mut leader = spawn_own_group("sleep", "30");
        let pgid = leader.id() as i32;
        let mut sibling = crate::proc::program("sleep")
            .arg("30")
            .process_group(pgid) // joins the leader's group, not its own
            .spawn()
            .expect("spawn sibling");

        kill_tree(leader.id(), true);

        use std::os::unix::process::ExitStatusExt as _;
        assert_eq!(
            leader.wait().expect("wait leader").signal(),
            Some(libc::SIGKILL)
        );
        assert_eq!(
            sibling.wait().expect("wait sibling").signal(),
            Some(libc::SIGKILL),
            "a sibling in the same process group must be reached too — this is \
             what closes the git-remote-https/ssh helper gap"
        );
    }

    /// The escalation itself, through `cancel()` — not `kill_tree` called with a
    /// literal.
    ///
    /// `kill_tree_soft_sends_sigterm`/`_hard_sends_sigkill` pin what each signal
    /// does, but neither goes through the registry, so the one line that DECIDES
    /// which signal to send (`let hard = entry.cancel_requested`) was free to be
    /// inverted or dropped with the suite still green. This is the test that
    /// fails when it is.
    ///
    /// The child ignores SIGTERM, standing in for a git that does not die on the
    /// polite ask — so surviving the first `cancel()` is itself the proof that
    /// the first one was not a SIGKILL, which nothing can ignore.
    #[cfg(unix)]
    #[test]
    fn cancel_asks_politely_first_and_escalates_on_the_second_call() {
        use std::io::BufRead as _;
        use std::os::unix::process::{CommandExt as _, ExitStatusExt as _};

        let scope = Scope::repo(Path::new("/tmp/escalation"));
        let registration = register(scope.clone());

        // `trap '' TERM` in a LOOP, not around a single `sleep 30`: the group
        // signal kills the inner `sleep` too, and a script whose only command
        // died would then simply end — exiting for a reason that has nothing to
        // do with the signal we are measuring.
        let mut child = crate::proc::program("sh")
            .arg("-c")
            .arg("trap '' TERM; echo ready; while :; do sleep 1; done")
            .process_group(0)
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("spawn the SIGTERM-ignoring child");

        // Wait for the trap to actually be installed. Without this handshake the
        // first signal races the shell's startup and kills it by the DEFAULT
        // disposition, which proves nothing about escalation — and does it only
        // on a loaded machine, i.e. in CI.
        let mut ready = String::new();
        std::io::BufReader::new(child.stdout.take().expect("stdout"))
            .read_line(&mut ready)
            .expect("read the ready handshake");
        assert_eq!(ready.trim(), "ready");

        assert!(registration.attach(child.id()));

        // First: SIGTERM, which this child ignores.
        assert_eq!(cancel(&scope), 1);
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(
            child.try_wait().expect("try_wait").is_none(),
            "the FIRST cancel must be an ignorable SIGTERM — a child that is \
             gone here was sent SIGKILL, and git never got to run \
             remove_lock_file_on_signal"
        );

        // Second: the user telling us the first one did not work.
        assert_eq!(cancel(&scope), 1);
        assert_eq!(
            child.wait().expect("wait").signal(),
            Some(libc::SIGKILL),
            "the SECOND cancel must escalate to SIGKILL"
        );
    }

    /// A future spawn site that forgot `process_group(0)` inherits OUR group —
    /// `kill_tree` must notice the target is not its own group leader and fall
    /// back to a single-process kill, or a cancel button would signal every
    /// process in the app's own group.
    #[cfg(unix)]
    #[test]
    fn kill_tree_falls_back_to_a_single_kill_when_the_pid_is_not_a_group_leader() {
        let mut unrelated = spawn_own_group("sleep", "30");
        // No `.process_group(0)`: inherits the TEST PROCESS's group, so this
        // pid is not its own leader.
        let mut not_a_leader = crate::proc::program("sleep")
            .arg("30")
            .spawn()
            .expect("spawn not_a_leader");

        kill_tree(not_a_leader.id(), true);

        use std::os::unix::process::ExitStatusExt as _;
        assert_eq!(
            not_a_leader.wait().expect("wait").signal(),
            Some(libc::SIGKILL),
            "still killed, just via a single kill() rather than killpg()"
        );
        assert!(
            unrelated.try_wait().expect("try_wait").is_none(),
            "an unrelated process group must not have been reached"
        );
        let _ = unrelated.kill();
        let _ = unrelated.wait();
    }
}
