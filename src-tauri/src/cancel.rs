//! Cancelling an in-flight network git subprocess (#234).
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
//! ## What killing actually kills
//!
//! Both call sites spawn with `kill_on_drop(true)` and, for the clone, an
//! explicit `start_kill()` + reap before the partial directory is removed.
//! That kills the `git` process we spawned. Git's transport helper
//! (`git-remote-https`, `ssh`) is git's own child, and a SIGKILL'd parent
//! cannot take it with it — the helper exits when its pipes close, which for a
//! helper blocked on a network read means when that read finally times out.
//! Killing the whole process group would close that gap; it also means a
//! platform-specific kill path through the one sanctioned spawner, so it is
//! deliberately not done here. The user-visible hang — an app with no way out —
//! is gone either way.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tokio::sync::watch;

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

/// The receiving half handed to a running op.
///
/// Cloneable and cheap; `cancelled()` resolves once and stays resolved, so an
/// op may await it in several places (a read loop, then the final `wait`)
/// without arming anything twice.
#[derive(Debug, Clone)]
pub struct CancelToken {
    rx: watch::Receiver<bool>,
}

impl CancelToken {
    /// Resolves when this op has been cancelled, and never otherwise.
    ///
    /// A `watch` receiver errors when every sender is gone. That means "nothing
    /// can ever cancel this op", which must NOT read as "cancelled" — a spurious
    /// resolve here would kill a healthy clone. The [`Registration`] holds a
    /// sender for as long as the op runs, so the error branch is unreachable in
    /// practice; it parks forever rather than trusting that.
    pub async fn cancelled(&mut self) {
        if self.rx.wait_for(|v| *v).await.is_err() {
            std::future::pending::<()>().await;
        }
    }

    /// Whether cancellation has already been requested, without awaiting.
    ///
    /// The call sites use this after the child has exited: a `select!` can lose
    /// the race when git dies of its own accord at the same moment, and a
    /// cancelled op must report `Cancelled` rather than whatever git's dying
    /// stderr happened to say.
    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow()
    }
}

/// A live op's entry in the registry. Removed on drop, so a finished op cannot
/// be "cancelled" into a later, unrelated one.
#[derive(Debug)]
pub struct Registration {
    id: u64,
    /// Kept so the sender outlives the op — see [`CancelToken::cancelled`].
    _tx: Arc<watch::Sender<bool>>,
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut live = registry().lock().unwrap_or_else(|e| e.into_inner());
        live.retain(|e| e.id != self.id);
    }
}

#[derive(Debug)]
struct Entry {
    id: u64,
    scope: Scope,
    tx: Arc<watch::Sender<bool>>,
}

fn registry() -> &'static Mutex<Vec<Entry>> {
    static REGISTRY: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

/// Announce a network op as cancellable, until the returned guard is dropped.
///
/// A `Vec` and not a map: this holds the ops in flight right now — a handful at
/// the very worst — and a scope legitimately has several entries (the auto-fetch
/// pile the module docs describe), which a keyed map would have had to model
/// anyway.
pub fn register(scope: Scope) -> (Registration, CancelToken) {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = watch::channel(false);
    let tx = Arc::new(tx);
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(Entry {
            id,
            scope,
            tx: Arc::clone(&tx),
        });
    (Registration { id, _tx: tx }, CancelToken { rx })
}

/// Cancel every op registered under `scope`. Answers how many were signalled,
/// which is 0 when nothing was running — not an error: the op can simply have
/// finished between the user reading the status line and clicking Cancel.
pub fn cancel(scope: &Scope) -> usize {
    let live = registry().lock().unwrap_or_else(|e| e.into_inner());
    let mut signalled = 0;
    for entry in live.iter().filter(|e| &e.scope == scope) {
        // A send failure means every receiver is gone, i.e. the op is already
        // unwinding. Still counts as handled from the caller's point of view.
        let _ = entry.tx.send(true);
        signalled += 1;
    }
    signalled
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The registry is process-wide and `cargo test` runs these in parallel, so
    /// every test below addresses a scope only it names. `Scope::Clone` is the
    /// one scope that cannot be made unique — it is a unit variant — so the two
    /// tests that touch it serialize here instead. Without this, one test's
    /// `cancel(&Scope::Clone)` reaches the other's token and both are flaky.
    fn clone_scope_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[test]
    fn cancel_signals_a_registered_op() {
        let scope = Scope::repo(Path::new("/tmp/signal-one"));
        let (_guard, token) = register(scope.clone());
        assert!(!token.is_cancelled());
        assert_eq!(cancel(&scope), 1);
        assert!(token.is_cancelled());
    }

    #[test]
    fn a_clone_is_cancellable_without_a_repository() {
        let _serialized = clone_scope_lock();
        let (_guard, token) = register(Scope::Clone);
        assert_eq!(cancel(&Scope::Clone), 1);
        assert!(token.is_cancelled());
    }

    #[test]
    fn dropping_the_guard_deregisters() {
        let (guard, _token) = register(Scope::repo(Path::new("/tmp/deregister")));
        drop(guard);
        assert_eq!(cancel(&Scope::repo(Path::new("/tmp/deregister"))), 0);
    }

    #[test]
    fn scopes_do_not_bleed_into_each_other() {
        let (_a, token_a) = register(Scope::repo(Path::new("/tmp/a")));
        let (_b, token_b) = register(Scope::repo(Path::new("/tmp/b")));

        assert_eq!(cancel(&Scope::repo(Path::new("/tmp/b"))), 1);

        assert!(!token_a.is_cancelled(), "/tmp/a must be untouched");
        assert!(token_b.is_cancelled());
    }

    /// The auto-fetch pile: several ops share one scope, and Cancel has to
    /// reach all of them or the stalled one nobody can see stays stalled.
    #[test]
    fn one_cancel_reaches_every_op_in_the_scope() {
        let path = Path::new("/tmp/pile");
        let (_g1, t1) = register(Scope::repo(path));
        let (_g2, t2) = register(Scope::repo(path));
        let (_g3, t3) = register(Scope::repo(path));

        assert_eq!(cancel(&Scope::repo(path)), 3);

        assert!(t1.is_cancelled() && t2.is_cancelled() && t3.is_cancelled());
    }

    #[tokio::test]
    async fn cancelled_resolves_after_the_signal_and_stays_resolved() {
        let (_guard, mut token) = register(Scope::repo(Path::new("/tmp/await")));
        cancel(&Scope::repo(Path::new("/tmp/await")));
        // Both awaits must return; a second one that parked would hang the
        // `select!` in `run_clone`'s final `wait`.
        token.cancelled().await;
        token.cancelled().await;
    }

    /// A clone's scope must not be cancelled by a repo op — cancelling a fetch
    /// on some open repository cannot take the Clone dialog's clone with it.
    #[test]
    fn a_repo_cancel_leaves_the_clone_alone() {
        let _serialized = clone_scope_lock();
        let (_c, clone_token) = register(Scope::Clone);
        let (_r, _repo_token) = register(Scope::repo(Path::new("/tmp/other")));
        cancel(&Scope::repo(Path::new("/tmp/other")));
        assert!(!clone_token.is_cancelled());
    }
}
