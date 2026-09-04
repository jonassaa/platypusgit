//! How one repository's `git2::Repository` handles are ordered (#400).
//!
//! The backend used to keep exactly one handle per repository behind one
//! mutex, so every op on a repository — read or write — ran one at a time.
//! That is correct and it is also why a slow filesystem hurt so much: eleven
//! reads issued together by `refreshAll` waited for each other, and the user
//! paid their SUM rather than the slowest of them. On a `/mnt/c` repository
//! under WSL, where each read costs seconds of `stat` traffic across the VM
//! boundary, that turned ~9s into ~108s (#400).
//!
//! Concurrent reads cannot be had by swapping the mutex for an `RwLock`:
//! `git2::Repository` is `Send` but NOT `Sync`, so several threads may not
//! hold `&Repository` at once, and the type system is right to refuse it. The
//! parallelism has to come from separate HANDLES.
//!
//! So this type keeps two things: the one cached handle every write runs on,
//! behind the mutex it has always had, and a factory that mints a handle for a
//! reader to keep to itself. A gate orders the two against each other.
//!
//! **What this drops is read-vs-read exclusion, and nothing else.** Every
//! ordering guarantee written down in `libgit2.rs` is a guarantee about a
//! WRITE — the stash TOCTOU pair, the fast-forward ancestry check, the
//! whole-index write-back in `fresh_index`. All of them run under `exclusive`,
//! which still excludes every reader and every other writer, so all of them
//! stay literally true. Two readers cannot violate any of them: neither one
//! writes.
//!
//! Generic over the handle so the concurrency above can be tested without
//! libgit2 in the picture — see the tests at the bottom of this file, which
//! prove overlap and exclusion by counting, not by timing.

use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use crate::error::{AppError, AppResult};

/// Distinguishes one `RepoLock` from another for the re-entrancy guard.
/// A counter rather than the lock's address: an id cannot be recycled by a
/// later allocation landing where a dropped lock used to be.
static NEXT_LOCK_ID: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// Which `RepoLock`s this thread is currently inside.
    ///
    /// A vector, not a flag: nesting two DIFFERENT repositories is legal and
    /// must stay legal — it shares no lock, so there is no deadlock to prevent.
    static HELD: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
}

/// Marks this thread as holding one lock, and unmarks it on the way out.
struct Reentry(u64);

impl Reentry {
    /// Refuse a nested acquisition of a lock this thread already holds.
    ///
    /// Nesting is a deadlock either way — but the two shapes fail
    /// differently, and that is the reason this guard exists. Re-entering the
    /// exclusive path hangs every time, so it shows up the first time anyone
    /// runs it. Re-entering the SHARED path succeeds whenever no writer is
    /// waiting and hangs when one is: a bug that passes in tests, passes in
    /// review, and hangs on a user's machine under load. Converting it into an
    /// error makes it something a test can catch.
    fn enter(id: u64) -> AppResult<Self> {
        HELD.with(|held| {
            let mut held = held.borrow_mut();
            if held.contains(&id) {
                return Err(AppError::Internal(
                    "re-entrant repository lock: a git op ran inside another op on the \
                     same repository, which would deadlock"
                        .into(),
                ));
            }
            held.push(id);
            Ok(Reentry(id))
        })
    }
}

impl Drop for Reentry {
    fn drop(&mut self) {
        HELD.with(|held| {
            let mut held = held.borrow_mut();
            if let Some(i) = held.iter().rposition(|id| *id == self.0) {
                held.remove(i);
            }
        });
    }
}

/// One repository's handles, and the order they run in.
pub struct RepoLock<T> {
    id: u64,
    /// Orders reads against writes: reads share it, writes take it alone.
    gate: RwLock<()>,
    /// The one cached handle every write runs on.
    exclusive: Mutex<T>,
    /// Mints a handle for one reader to keep to itself.
    ///
    /// A factory rather than a pool, and that was measured rather than
    /// assumed: `Repository::open` costs ~1.1ms warm, and a pre-warmed pool
    /// of handles finished a twelve-read fan-out in 10.9ms against 10.6ms for
    /// opening one per read — the pool is on the wrong side of noise. Keeping
    /// it behind this field means a pool can be added later, if a `/mnt/c`
    /// profile ever justifies one, without touching a single call site.
    open: Box<dyn Fn() -> AppResult<T> + Send + Sync>,
}

impl<T> RepoLock<T> {
    /// `handle` is the cached handle writes will use; `open` mints the ones
    /// readers get.
    pub fn new<F>(handle: T, open: F) -> Self
    where
        F: Fn() -> AppResult<T> + Send + Sync + 'static,
    {
        Self {
            id: NEXT_LOCK_ID.fetch_add(1, Ordering::Relaxed),
            gate: RwLock::new(()),
            exclusive: Mutex::new(handle),
            open: Box::new(open),
        }
    }

    /// Run `f` alone: no other read and no other write on this repository.
    ///
    /// This is what every mutating op uses, and it is the behaviour the
    /// backend has always had. Verify-then-mutate inside one call is atomic
    /// against everything else in the process, which is what the stash TOCTOU
    /// rule and the fast-forward ancestry check both rest on.
    pub fn exclusive<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&mut T) -> AppResult<R>,
    {
        let _reentry = Reentry::enter(self.id)?;
        let _gate = self
            .gate
            .write()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut handle = self
            .exclusive
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        f(&mut handle)
    }

    /// Run `f` on a handle of its own, alongside any number of other readers.
    ///
    /// Read-only ops only. Writes still go through `exclusive` — a write here
    /// would run concurrently with other reads and with nothing stopping a
    /// second write from interleaving, which is exactly the whole-index
    /// clobber `fresh_index` was written to prevent.
    pub fn shared<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&T) -> AppResult<R>,
    {
        self.shared_mut(|handle| f(&*handle))
    }

    /// `shared`, for a read that needs `&mut` to satisfy libgit2.
    ///
    /// `&mut` under a SHARED gate is not the contradiction it looks like: the
    /// handle was minted for this call and dies with it, so no one else can
    /// observe it. The `&mut` is about C signatures — `git_stash_foreach` and
    /// friends take a mutable `git_repository` — not about mutating anything.
    pub fn shared_mut<F, R>(&self, f: F) -> AppResult<R>
    where
        F: FnOnce(&mut T) -> AppResult<R>,
    {
        let _reentry = Reentry::enter(self.id)?;
        let _gate = self
            .gate
            .read()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let mut handle = (self.open)()?;
        f(&mut handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    /// A stand-in for `git2::Repository`: carries a serial number so a test can
    /// tell two handles apart, and counts how many were made.
    #[derive(Debug)]
    struct FakeHandle(usize);

    /// A lock whose factory hands out numbered handles, and the mint count.
    fn lock() -> (Arc<RepoLock<FakeHandle>>, Arc<AtomicUsize>) {
        let made = Arc::new(AtomicUsize::new(0));
        let m = Arc::clone(&made);
        let l = RepoLock::new(FakeHandle(0), move || {
            Ok(FakeHandle(m.fetch_add(1, Ordering::SeqCst) + 1))
        });
        (Arc::new(l), made)
    }

    /// Eight readers must be inside `shared` AT ONCE.
    ///
    /// A `Barrier` for all eight, taken INSIDE the closure, is the whole
    /// proof: it cannot be cleared unless all eight readers hold the lock
    /// simultaneously. Serialize the lock and reader one blocks on a barrier
    /// the other seven can never reach, so nothing completes — and the
    /// bounded `recv_timeout` on the main thread turns that deadlock into a
    /// failed assertion instead of a hung suite.
    ///
    /// **This is the shape that has teeth, and it was arrived at the hard
    /// way.** The first version of this test counted arrivals into a shared
    /// peak instead, and passed against a deliberately serialized lock: the
    /// count was never decremented on the way out, so eight readers passing
    /// through one at a time still drove it to eight. A concurrency test that
    /// cannot fail is worse than no test, so if this one is ever edited, plant
    /// a `.write()` in `shared_mut` and watch it go red first.
    ///
    /// Note also that the timeout only costs anything when the test FAILS —
    /// the passing path clears the barrier immediately, so ten seconds buys
    /// robustness on a loaded CI box for free.
    #[test]
    fn shared_acquisitions_overlap() {
        const N: usize = 8;
        let (l, _made) = lock();
        let barrier = Arc::new(Barrier::new(N));
        let (tx, rx) = std::sync::mpsc::channel();

        let mut threads = Vec::new();
        for _ in 0..N {
            let l = Arc::clone(&l);
            let barrier = Arc::clone(&barrier);
            let tx = tx.clone();
            threads.push(std::thread::spawn(move || {
                l.shared(|_handle| {
                    barrier.wait();
                    Ok(())
                })
                .expect("shared");
                // Ignore a send failure: the receiver is gone only when the
                // test has already failed and is unwinding.
                let _ = tx.send(());
            }));
        }
        drop(tx);

        for got in 0..N {
            rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| {
                panic!(
                    "only {got} of {N} readers got through: `shared` is not letting reads \
                     overlap, so the first reader is holding the lock while blocked on a \
                     barrier the rest cannot reach",
                )
            });
        }
        for t in threads {
            t.join().expect("join");
        }
    }

    /// Every `shared` call gets a handle of its own — the property that makes
    /// concurrent reads sound at all, given `Repository` is not `Sync`.
    #[test]
    fn each_shared_call_mints_its_own_handle() {
        let (l, made) = lock();
        let first = l.shared(|h| Ok(h.0)).expect("first");
        let second = l.shared(|h| Ok(h.0)).expect("second");
        assert_ne!(first, second, "two reads must not share one handle");
        assert_eq!(made.load(Ordering::SeqCst), 2, "one handle minted per read");
    }

    /// The cached handle is the write handle, and it is the SAME one every time.
    #[test]
    fn exclusive_reuses_the_cached_handle() {
        let (l, made) = lock();
        l.exclusive(|h| {
            h.0 = 42;
            Ok(())
        })
        .expect("write");
        let seen = l.exclusive(|h| Ok(h.0)).expect("read back");
        assert_eq!(seen, 42, "writes must see the one cached handle");
        assert_eq!(
            made.load(Ordering::SeqCst),
            0,
            "a write must not mint a handle",
        );
    }

    /// A reader and a writer must not overlap — the exclusion every TOCTOU
    /// comment in `libgit2.rs` rests on.
    #[test]
    fn shared_and_exclusive_never_overlap() {
        let (l, _made) = lock();
        let inside = Arc::new(AtomicUsize::new(0));
        let overlapped = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(2));

        let mut threads = Vec::new();
        for is_writer in [true, false] {
            let l = Arc::clone(&l);
            let inside = Arc::clone(&inside);
            let overlapped = Arc::clone(&overlapped);
            let start = Arc::clone(&start);
            threads.push(std::thread::spawn(move || {
                start.wait();
                for _ in 0..200 {
                    let body = |_: &mut FakeHandle| {
                        if inside.fetch_add(1, Ordering::SeqCst) != 0 {
                            overlapped.fetch_add(1, Ordering::SeqCst);
                        }
                        std::thread::yield_now();
                        inside.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    };
                    if is_writer {
                        l.exclusive(body).expect("exclusive");
                    } else {
                        l.shared_mut(body).expect("shared");
                    }
                }
            }));
        }
        for t in threads {
            t.join().expect("join");
        }
        assert_eq!(
            overlapped.load(Ordering::SeqCst),
            0,
            "a read overlapped a write; the gate is not excluding them",
        );
    }

    /// A factory failure is the op's failure, not a panic.
    #[test]
    fn a_factory_error_propagates() {
        let l: RepoLock<FakeHandle> =
            RepoLock::new(FakeHandle(0), || Err(AppError::Internal("no handle".into())));
        let err = l.shared(|_| Ok(())).expect_err("must fail");
        assert!(
            matches!(err, AppError::Internal(ref m) if m.contains("no handle")),
            "got {err:?}",
        );
    }

    /// Nesting the same lock is refused with an error rather than deadlocking.
    ///
    /// All four pairings, because the hazard is asymmetric: mutex re-entry
    /// (write-in-write) is a guaranteed hang today, while read-in-read only
    /// hangs when a writer happens to queue between the two acquisitions —
    /// which is the intermittent failure this guard exists to convert into
    /// something a test can see.
    #[test]
    fn nesting_the_same_lock_is_refused() {
        let (l, _made) = lock();

        let cases: Vec<(&str, Box<dyn Fn() -> AppResult<()>>)> = vec![
            (
                "shared in shared",
                Box::new({
                    let l = Arc::clone(&l);
                    move || {
                        let inner = Arc::clone(&l);
                        l.shared(move |_| inner.shared(|_| Ok(())))
                    }
                }),
            ),
            (
                "exclusive in exclusive",
                Box::new({
                    let l = Arc::clone(&l);
                    move || {
                        let inner = Arc::clone(&l);
                        l.exclusive(move |_| inner.exclusive(|_| Ok(())))
                    }
                }),
            ),
            (
                "shared in exclusive",
                Box::new({
                    let l = Arc::clone(&l);
                    move || {
                        let inner = Arc::clone(&l);
                        l.exclusive(move |_| inner.shared(|_| Ok(())))
                    }
                }),
            ),
            (
                "exclusive in shared",
                Box::new({
                    let l = Arc::clone(&l);
                    move || {
                        let inner = Arc::clone(&l);
                        l.shared(move |_| inner.exclusive(|_| Ok(())))
                    }
                }),
            ),
        ];

        for (name, case) in cases {
            let err = case().expect_err(&format!("{name} must be refused, not hang"));
            assert!(
                matches!(err, AppError::Internal(ref m) if m.contains("re-entrant")),
                "{name}: got {err:?}",
            );
        }
    }

    /// Two DIFFERENT repositories nested on one thread stay legal — they share
    /// no lock, so there is no deadlock to prevent, and an op on repo A calling
    /// into repo B is a shape the app is allowed to have.
    #[test]
    fn nesting_two_different_locks_is_allowed() {
        let (a, _ma) = lock();
        let (b, _mb) = lock();
        let inner = Arc::clone(&b);
        let out = a
            .shared(move |_| inner.shared(|h| Ok(h.0)))
            .expect("nesting two different locks must be allowed");
        assert!(out > 0, "the inner lock's handle should have been minted");
    }

    /// The guard unwinds with the closure, so a refused nesting does not leave
    /// the thread permanently marked as holding the lock.
    #[test]
    fn a_refused_nesting_leaves_the_lock_usable() {
        let (l, _made) = lock();
        let inner = Arc::clone(&l);
        let _ = l.shared(move |_| inner.shared(|_| Ok(())));
        l.shared(|_| Ok(())).expect("the lock must still be usable");
        l.exclusive(|_| Ok(())).expect("and still writable");
    }
}
