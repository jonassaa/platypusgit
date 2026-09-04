# Concurrent read-only git ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let read-only backend git ops run concurrently on their own
`git2::Repository` handles, so a slow filesystem's per-op cost stops being
multiplied by queue depth (#400).

**Architecture:** A new `git/repo_locks.rs` owns one idea — how a repository's
handles are ordered. `RepoLock<T>` pairs an `RwLock<()>` gate with the cached
handle behind its `Mutex<T>` and a factory that mints a handle for a reader to
keep to itself. Writes take the gate exclusively and use the cached handle,
exactly as today; reads share the gate and get a fresh handle. `libgit2.rs`
gains `with_repo_read`/`with_repo_read_mut` beside the untouched
`with_repo`/`with_repo_mut`, and fourteen read-only ops move across.

**Tech Stack:** Rust, `git2` 0.21, `std::sync::{Mutex, RwLock}`, `cargo test`
against real temp repositories.

**Spec:** `docs/superpowers/specs/2026-09-04-repo-read-concurrency-spec.md`

## Global Constraints

- **Every IPC-crossing fn returns `AppResult<T>`.** New failures reuse the
  existing `AppError::Internal(String)` variant (`src-tauri/src/error.rs:66`) —
  no new variant, so the TS `AppError` union and `appErrorDetail` need no change
  and `test/appErrors.test.ts` stays green.
- **Never `Command::new` outside `src-tauri/src/proc.rs`.** A guard test fails
  the build. No task here spawns anything.
- **`git2::Repository` is `Send` but not `Sync`.** Never hand `&Repository` to
  two threads. Concurrency comes from *separate handles*, never shared access.
- **`with_repo` and `with_repo_mut` keep byte-for-byte today's semantics.** They
  are the write path. Do not change their signatures, and do not migrate a call
  site this plan does not name.
- **Toolchain:** `~/.cargo/bin/cargo`, `~/Library/pnpm/pnpm`. Run all commands
  from the worktree root; `cargo` needs `--manifest-path src-tauri/Cargo.toml`
  or `cd src-tauri` first.
- **Rust CI gate is `cargo test` only** — no clippy, no fmt. Do not run
  `cargo fmt` over the crate; it is broadly unformatted already and would bury
  the diff.
- **Commit style:** `perf(git): …` / `test: …` / `docs: …`, imperative subject
  under 72 chars, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| Create `src-tauri/src/git/repo_locks.rs` | `RepoLock<T>` — the whole ordering primitive, plus its re-entrancy guard and unit tests. Generic over the handle so it is testable without libgit2. |
| Modify `src-tauri/src/git/mod.rs:1-23` | Declare `pub mod repo_locks;`, alphabetically among the existing module list. |
| Modify `src-tauri/src/git/libgit2.rs:79-137` | `repos` map holds `Arc<RepoLock<Repository>>`; `repo_cell` returns it; add `with_repo_read`/`with_repo_read_mut`; add the `open_read_handle` factory helper. |
| Modify `src-tauri/src/git/libgit2.rs:3116-3155` (`open`) | Capture the gitdir and build the `RepoLock` with its factory. The only insert site in the file. |
| Modify `src-tauri/src/git/libgit2.rs` (14 call sites) | Move the migrated read ops onto the shared helpers. |
| Create `src-tauri/tests/concurrent_reads.rs` | Integration proof: concurrent reads agree with serial ones; reads work on a linked worktree and a bare repository. |
| Modify `docs/dev/architecture.md` | List `git/repo_locks.rs` in the backend tree. |
| Modify `docs/dev/backend.md` | The read/write split, the gitdir reopen, the re-entrancy rule, the measurements. |
| Modify `CLAUDE.md` | The "per-repo ops serialize on an inner mutex" convention line is now wrong. |

---

### Task 1: `RepoLock<T>` — the ordering primitive

**Files:**
- Create: `src-tauri/src/git/repo_locks.rs`
- Modify: `src-tauri/src/git/mod.rs:1-23`
- Test: `src-tauri/src/git/repo_locks.rs` (inline `#[cfg(test)] mod tests`, the
  pattern `git/mod.rs:998` already uses)

**Interfaces:**
- Consumes: `crate::error::{AppError, AppResult}`.
- Produces:
  - `pub struct RepoLock<T>`
  - `pub fn RepoLock::<T>::new<F>(handle: T, open: F) -> Self where F: Fn() -> AppResult<T> + Send + Sync + 'static`
  - `pub fn RepoLock::<T>::exclusive<F, R>(&self, f: F) -> AppResult<R> where F: FnOnce(&mut T) -> AppResult<R>`
  - `pub fn RepoLock::<T>::shared<F, R>(&self, f: F) -> AppResult<R> where F: FnOnce(&T) -> AppResult<R>`
  - `pub fn RepoLock::<T>::shared_mut<F, R>(&self, f: F) -> AppResult<R> where F: FnOnce(&mut T) -> AppResult<R>`

- [ ] **Step 1: Declare the module**

In `src-tauri/src/git/mod.rs`, add to the module list (it is alphabetical apart
from a couple of strays — put it after `rebase_state`):

```rust
pub mod repo_locks;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/git/repo_locks.rs` containing ONLY the test module for
now, so the tests fail to compile against a missing type — that is the red bar.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Condvar, Mutex as StdMutex};
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
    /// Deterministic on both sides, which is why there is no wall-clock
    /// assertion here: each reader announces arrival and then waits for the
    /// count to reach eight. If `shared` serialized, reader one would hold the
    /// lock while waiting for seven readers that cannot enter, the bounded wait
    /// would expire, and the assertion fails. It cannot flake into passing.
    #[test]
    fn shared_acquisitions_overlap() {
        const N: usize = 8;
        let (l, _made) = lock();
        let state = Arc::new((StdMutex::new(0usize), Condvar::new()));
        let peak = Arc::new(AtomicUsize::new(0));

        let mut threads = Vec::new();
        for _ in 0..N {
            let l = Arc::clone(&l);
            let state = Arc::clone(&state);
            let peak = Arc::clone(&peak);
            threads.push(std::thread::spawn(move || {
                l.shared(|_handle| {
                    let (count, cv) = &*state;
                    let mut c = count.lock().unwrap();
                    *c += 1;
                    peak.fetch_max(*c, Ordering::SeqCst);
                    cv.notify_all();
                    // Wait for everyone, but bounded so a serialized lock fails
                    // the test instead of hanging the suite.
                    while *c < N {
                        let (guard, timeout) =
                            cv.wait_timeout(c, Duration::from_secs(10)).unwrap();
                        c = guard;
                        if timeout.timed_out() {
                            break;
                        }
                    }
                    Ok(())
                })
                .expect("shared");
            }));
        }
        for t in threads {
            t.join().expect("join");
        }
        assert_eq!(
            peak.load(Ordering::SeqCst),
            N,
            "all {N} readers must be inside `shared` at once; peak concurrency was lower, \
             so reads are still serializing",
        );
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --lib repo_locks 2>&1 | tail -20`

Expected: FAIL to compile — `cannot find type RepoLock in this scope`.

- [ ] **Step 4: Write the implementation**

Prepend to `src-tauri/src/git/repo_locks.rs`, above the test module:

```rust
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --lib repo_locks 2>&1 | tail -20`

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/repo_locks.rs src-tauri/src/git/mod.rs
git commit -m "perf(git): add RepoLock, a per-repo gate over one write handle and many read handles"
```

---

### Task 2: Wire `RepoLock` into the backend, with no op migrated yet

The point of stopping here is that the whole suite must stay green while every
op is still exclusive. That isolates "the plumbing is right" from "this op is
really a read", so a later failure has one possible cause instead of two.

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs:79-137` (struct, `new`, `repo_cell`, `with_repo`, `with_repo_mut`)
- Modify: `src-tauri/src/git/libgit2.rs:3116-3155` (`open`)
- Test: the existing suite — `src-tauri/tests/*.rs`

**Interfaces:**
- Consumes: `RepoLock::{new, exclusive, shared, shared_mut}` from Task 1.
- Produces:
  - `fn Libgit2Backend::repo_cell(&self, &RepoId) -> AppResult<Arc<RepoLock<Repository>>>`
  - `fn Libgit2Backend::with_repo_read<F, T>(&self, &RepoId, F) -> AppResult<T> where F: FnOnce(&Repository) -> AppResult<T>`
  - `fn Libgit2Backend::with_repo_read_mut<F, T>(&self, &RepoId, F) -> AppResult<T> where F: FnOnce(&mut Repository) -> AppResult<T>`
  - `fn open_read_handle(gitdir: &Path, report_as: &Path) -> AppResult<Repository>` (free fn)

- [ ] **Step 1: Change the map's value type**

`src-tauri/src/git/libgit2.rs:80` — replace:

```rust
    repos: Mutex<HashMap<RepoId, Arc<Mutex<Repository>>>>,
```

with:

```rust
    repos: Mutex<HashMap<RepoId, Arc<RepoLock<Repository>>>>,
```

Add the import near the other `crate::git` uses at the top of the file:

```rust
use crate::git::repo_locks::RepoLock;
```

- [ ] **Step 2: Add the read-handle factory helper**

Add as a free function next to `fresh_index` (around
`src-tauri/src/git/libgit2.rs:1192`):

```rust
/// Another handle on the same repository, for one read to keep to itself
/// (#400).
///
/// Opens the GITDIR, not the workdir, and that is load-bearing:
/// `Repository::open` on a workdir re-runs discovery, which resolves a linked
/// worktree to the wrong repository (its gitdir is
/// `<main>/.git/worktrees/<name>/`, not `<main>/.git/`) and has nothing to
/// discover at all for a bare one. The gitdir here is the one the successful
/// `open` already resolved, so it is exact for both.
///
/// `report_as` is the path the USER named, kept only for the error message —
/// a `DubiousOwnership` naming an internal `.git/worktrees/…` path would be
/// about a directory they never chose.
fn open_read_handle(gitdir: &Path, report_as: &Path) -> AppResult<Repository> {
    Repository::open(gitdir).map_err(|e| ownership::map_open_error(report_as, &e))
}
```

Check the `ownership` import is in scope at the top of the file; `open` already
calls `ownership::map_open_error`, so it is.

- [ ] **Step 3: Point the four helpers at `RepoLock`**

Replace `repo_cell`, `with_repo` and `with_repo_mut` at
`src-tauri/src/git/libgit2.rs:107-137`. Keep the existing `repo_cell` doc
comment — it is still true and still worth reading — and append the new
paragraph:

```rust
    /// Clone the repo's own lock out of the map and RELEASE the map lock
    /// before running `f`. The map guard used to stay alive for the whole
    /// operation, so every git op in the process — any repository, any window —
    /// serialized on one mutex: a 500-commit log walk in one tab blocked a
    /// status refresh in another, and `refreshAll`'s parallel commands ran
    /// strictly one after another. Different repos now genuinely run in
    /// parallel.
    ///
    /// Same-repo ops used to serialize on the inner mutex too. They no longer
    /// all do: `RepoLock` runs writes one at a time on the cached handle and
    /// lets reads run together on handles of their own (#400). What still
    /// holds — and what the stash TOCTOU note relies on — is that a write
    /// excludes everything.
    fn repo_cell(&self, repo_id: &RepoId) -> AppResult<Arc<RepoLock<Repository>>> {
        let map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        map.get(repo_id)
            .cloned()
            .ok_or_else(|| AppError::UnknownRepo(repo_id.0.clone()))
    }

    /// An op that runs ALONE on this repository — no other read, no other
    /// write.
    ///
    /// The default, and where an op belongs unless it has been established to
    /// write nothing. Despite the name this is very much the WRITE path:
    /// `stage`, `unstage`, `discard` and `delete_untracked` read-modify-write
    /// the whole index through it, `commit` writes an object and moves a ref
    /// through it, and `checkout_branch`/`reset`/the rebase engine mutate the
    /// worktree through it. `git2` takes `&self` for most of that, which is
    /// why the borrow says nothing about it.
    fn with_repo<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&Repository) -> AppResult<T>,
    {
        self.repo_cell(repo_id)?.exclusive(|repo| f(repo))
    }

    /// `with_repo`, for the seven ops libgit2 makes take `&mut Repository`
    /// (`stash_foreach`, `stash_drop`).
    fn with_repo_mut<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Repository) -> AppResult<T>,
    {
        self.repo_cell(repo_id)?.exclusive(f)
    }

    /// A READ-ONLY op, on a handle of its own, alongside other reads (#400).
    ///
    /// Only for an op that writes nothing — no index write-back, no ref move,
    /// no object written, no worktree change. A write here would interleave
    /// with other writes with nothing to stop it.
    ///
    /// Two rules come with the private handle:
    ///
    /// - **Anything reading the index still goes through `fresh_index`.** The
    ///   handle is newly opened rather than cached, so its in-memory index is
    ///   whatever was on disk a moment ago — the same staleness `with_repo`
    ///   has, arriving by a different route.
    /// - **Never call one of these from inside another repo-lock closure for
    ///   the same repository.** It is refused with `Internal` rather than
    ///   deadlocking, but it is still a bug. The existing helpers that take an
    ///   already-borrowed `&Repository` (`stash_pairs`, the fast-forward pair)
    ///   are the pattern to follow.
    fn with_repo_read<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&Repository) -> AppResult<T>,
    {
        self.repo_cell(repo_id)?.shared(f)
    }

    /// `with_repo_read`, for a read that needs `&mut` to satisfy libgit2 —
    /// `stashes` and its `stash_foreach`. The handle belongs to this call
    /// alone, so the mutable borrow is invisible to anyone else.
    fn with_repo_read_mut<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Repository) -> AppResult<T>,
    {
        self.repo_cell(repo_id)?.shared_mut(f)
    }
```

Note `with_repo` wraps as `|repo| f(repo)` because `exclusive` hands out
`&mut Repository` and `f` wants `&Repository`.

- [ ] **Step 4: Build the lock in `open`**

`src-tauri/src/git/libgit2.rs:3151` — replace:

```rust
        map.insert(id.clone(), Arc::new(Mutex::new(repo)));
```

with (insert above the `let mut map = …` block, since `repo` is borrowed for
`gitdir` before being moved):

```rust
        // Reads get handles of their own (#400), minted from the gitdir this
        // open already resolved rather than by re-running discovery — see
        // `open_read_handle`. Captured here because this is the only place
        // that knows both paths.
        let gitdir = repo.path().to_path_buf();
        let report_as = path.to_path_buf();
        let lock = RepoLock::new(repo, move || open_read_handle(&gitdir, &report_as));

        let mut map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        map.insert(id.clone(), Arc::new(lock));
```

The existing `let workdir = repo.workdir()…` block must stay ABOVE this, since
it borrows `repo`.

- [ ] **Step 5: Check it compiles, and the whole suite still passes**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --all-targets 2>&1 | tail -30`

Expected: PASS. Every op is still exclusive, so this is a pure refactor — any
failure here is the plumbing, not an op's read/write classification. Two
warnings about `with_repo_read`/`with_repo_read_mut` being unused are expected
and go away in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/libgit2.rs
git commit -m "perf(git): hold each repository behind a RepoLock, all ops still exclusive"
```

---

### Task 3: Migrate the fourteen read-only ops

Fifteen trait methods, fourteen edit sites: `log` and `diff_commit` are trait
defaults (`git/mod.rs:108`, `git/mod.rs:401`) that delegate to `log_page` and
`diff_commit_over_ceiling`, so they come along for free.

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs` (14 sites, listed below)
- Test: the existing suite

**Interfaces:**
- Consumes: `with_repo_read` / `with_repo_read_mut` from Task 2.
- Produces: no new API. Fifteen trait methods change concurrency class only;
  every signature and every return value is untouched.

- [ ] **Step 1: Swap the helper at each of the fourteen sites**

Each is a one-word change, `with_repo` → `with_repo_read`. Line numbers are
from before Task 2's edits, so re-grep rather than trusting them; the function
names are the reliable anchors.

`refreshAll`'s fan-out — the clustered burst in the issue:

| fn | current call |
| --- | --- |
| `status` | `self.with_repo(repo_id, \|repo\| {` |
| `branches` | `self.with_repo(repo_id, \|repo\| {` |
| `tags` | `self.with_repo(repo_id, \|repo\| {` |
| `stashes` | `self.with_repo_mut(repo_id, \|repo\| {` → **`with_repo_read_mut`** |
| `remotes` | `self.with_repo(repo_id, \|repo\| {` |
| `log_page` | `self.with_repo(repo_id, \|repo\| {` |
| `repo_state` | `self.with_repo(repo_id, \|repo\| {` |
| `rebase_status` | `self.with_repo(repo_id, \|repo\| {` |
| `bisect_status` | `self.with_repo(repo_id, crate::git::bisect::status)` |
| `head_info` | `self.with_repo(repo_id, \|repo\| {` |
| `shallow_info` | `self.with_repo(repo_id, \|repo\| {` |

The history-arrowing ladder:

| fn | current call |
| --- | --- |
| `diff_commit_over_ceiling` | `self.with_repo(repo_id, \|repo\| {` |
| `verify_commit` | `let (full_oid, signed) = self.with_repo(repo_id, \|repo\| {` |
| `worktrees` | `self.with_repo(repo_id, \|repo\| {` |

- [ ] **Step 2: Note the two that shell out, in a comment**

`verify_commit` and `bisect_status` both spawn (`gpg`/`ssh-keygen` via
`git show`, and `git rev-list --bisect-vars`). Add above `verify_commit`'s
newly-shared call:

```rust
        // `with_repo_read`, not `with_repo`: this resolves a revision and reads
        // a signature, writing nothing — and it is the op that made the #400
        // ladder a ladder. Held exclusively, the `git show` below stalled every
        // unrelated read in the process for as long as gpg took, once per
        // commit the user arrowed onto.
```

And above `bisect_status`'s:

```rust
        // Read-only, and it shells out to `git rev-list --bisect-vars` for its
        // progress numbers — so holding this exclusively blocked every other
        // read for the length of a subprocess (#400).
```

- [ ] **Step 3: Run the whole suite**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --all-targets 2>&1 | tail -30`

Expected: PASS. This is the load-bearing verification in the whole plan: around
ninety integration test files drive these ops, and Task 1's re-entrancy guard
turns any latent nesting — a migrated read reachable from inside another lock —
into a hard `Internal` failure instead of an intermittent hang. A green run is
real evidence, not just absence of evidence.

If something fails, the cause is almost certainly one of two things: the op
writes after all (put it back on `with_repo` and say so in the spec), or it is
called from inside another closure (the error message says "re-entrant").

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git/libgit2.rs
git commit -m "perf(git): run the read-only fan-out concurrently instead of queued"
```

---

### Task 4: Integration proof against real repositories

Task 1 proves the lock. This proves the wiring: that a real fan-out agrees with
a serial one, and that the gitdir reopen is right for the two repository shapes
where opening the workdir would not be.

**Files:**
- Create: `src-tauri/tests/concurrent_reads.rs`
- Test: itself

**Interfaces:**
- Consumes: `platypusgit_lib::git::{libgit2::Libgit2Backend, types::RepoId, GitBackend}`;
  `support::{TempRepo, fs::write_file}` (`src-tauri/tests/support/mod.rs`).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/concurrent_reads.rs`:

```rust
//! Read-only ops run concurrently and still agree with themselves (#400).
//!
//! The unit tests in `git/repo_locks.rs` prove the lock overlaps readers and
//! excludes writers, with a fake handle and no libgit2. What they cannot prove
//! is that the handles this backend mints are the RIGHT handles — which is the
//! whole risk in reopening a repository from its gitdir rather than reusing
//! one cached object.

mod support;

use std::sync::{Arc, Barrier};

use platypusgit_lib::git::{libgit2::Libgit2Backend, GitBackend};
use support::{fs::write_file, TempRepo};

/// The eleven-read fan-out, issued together, must answer exactly what it
/// answers one at a time.
#[test]
fn a_concurrent_fan_out_agrees_with_a_serial_one() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "untracked.txt", "x\n");
    let backend = Arc::new(Libgit2Backend::new());
    let h = backend.open(tr.path()).expect("open");

    // Serially first, so there is something to compare against.
    let want_status = backend.status(&h.id).expect("status").len();
    let want_branches = backend.branches(&h.id).expect("branches").len();
    let want_log = backend.log(&h.id, None, 10).expect("log").len();
    let want_head = backend.head_info(&h.id).expect("head_info");

    // Then all at once, with a barrier so they really are simultaneous rather
    // than merely spawned.
    const N: usize = 8;
    let start = Arc::new(Barrier::new(N));
    let mut threads = Vec::new();
    for i in 0..N {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        let start = Arc::clone(&start);
        threads.push(std::thread::spawn(move || {
            start.wait();
            match i % 4 {
                0 => assert_eq!(
                    backend.status(&id).expect("status").len(),
                    want_status,
                    "concurrent status disagreed",
                ),
                1 => assert_eq!(
                    backend.branches(&id).expect("branches").len(),
                    want_branches,
                    "concurrent branches disagreed",
                ),
                2 => assert_eq!(
                    backend.log(&id, None, 10).expect("log").len(),
                    want_log,
                    "concurrent log disagreed",
                ),
                _ => assert_eq!(
                    backend.head_info(&id).expect("head_info").branch,
                    want_head.branch,
                    "concurrent head_info disagreed",
                ),
            }
        }));
    }
    for t in threads {
        t.join().expect("a concurrent read panicked");
    }

    // And the other reads in the fan-out at least answer without error, on
    // their own private handles.
    backend.tags(&h.id).expect("tags");
    backend.stashes(&h.id).expect("stashes");
    backend.remotes(&h.id).expect("remotes");
    backend.repo_state(&h.id).expect("repo_state");
    backend.rebase_status(&h.id).expect("rebase_status");
    backend.shallow_info(&h.id).expect("shallow_info");
    backend.worktrees(&h.id).expect("worktrees");
}

/// A read on a LINKED WORKTREE must read that worktree, not the main one.
///
/// This is the test that pins `open_read_handle` to the gitdir. A linked
/// worktree's gitdir is `<main>/.git/worktrees/<name>/`, so reopening by
/// re-running discovery on the workdir — or, worse, reusing the main
/// repository's path — would silently answer about the wrong checkout. The
/// dirty file exists only here, so a leak is visible rather than theoretical.
#[test]
fn a_read_on_a_linked_worktree_reads_that_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let wt_dir = tr.dir.path().join("wt");
    tr.repo
        .worktree("side", &wt_dir, None)
        .expect("add worktree");
    write_file(&wt_dir, "only-in-the-worktree.txt", "x\n");

    let backend = Libgit2Backend::new();
    let h = backend.open(&wt_dir).expect("open worktree");

    let status = backend.status(&h.id).expect("status");
    assert!(
        status
            .iter()
            .any(|s| s.path == "only-in-the-worktree.txt"),
        "a read on the linked worktree must see its own untracked file, got {:?}",
        status.iter().map(|s| &s.path).collect::<Vec<_>>(),
    );

    // The main checkout is clean, and a handle opened for the worktree must not
    // start answering about it.
    let main = backend.open(tr.path()).expect("open main");
    assert!(
        backend.status(&main.id).expect("main status").is_empty(),
        "the main checkout should still be clean",
    );
}

/// Reads keep working when the repository has no worktree at all.
#[test]
fn reads_work_on_a_bare_repository() {
    let dir = tempfile::tempdir().expect("tempdir");
    git2::Repository::init_bare(dir.path()).expect("init bare");

    let backend = Libgit2Backend::new();
    let h = backend.open(dir.path()).expect("open bare");

    // No commits and no workdir, but the reads must answer rather than panic
    // or resolve to some other repository.
    assert!(backend.branches(&h.id).expect("branches").is_empty());
    assert!(backend.tags(&h.id).expect("tags").is_empty());
    backend.repo_state(&h.id).expect("repo_state");
    backend.head_info(&h.id).expect("head_info");
}

/// A read never observes a torn index while a write is running.
///
/// `stage` write-modify-writes the WHOLE index; if the gate let a read in
/// mid-write, `status` could see neither the old index nor the new one. Loops
/// so the interleaving gets many chances rather than one.
#[test]
fn a_read_never_sees_a_torn_index() {
    let tr = TempRepo::with_initial_commit("hello\n");
    for i in 0..20 {
        write_file(tr.path(), &format!("f{i}.txt"), "x\n");
    }
    let backend = Arc::new(Libgit2Backend::new());
    let h = backend.open(tr.path()).expect("open");

    let writer = {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        std::thread::spawn(move || {
            for i in 0..20 {
                let p = std::path::PathBuf::from(format!("f{i}.txt"));
                backend.stage(&id, &[p]).expect("stage");
            }
        })
    };

    let reader = {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        std::thread::spawn(move || {
            for _ in 0..200 {
                // Every path is either staged or not; the total never changes,
                // and a torn read would lose or duplicate one.
                let status = backend.status(&id).expect("status");
                assert_eq!(
                    status.len(),
                    20,
                    "status saw {} of 20 paths — a torn index",
                    status.len(),
                );
            }
        })
    };

    writer.join().expect("writer panicked");
    reader.join().expect("reader panicked");
}
```

- [ ] **Step 2: Run it to verify it passes**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --test concurrent_reads 2>&1 | tail -30`

Expected: PASS, 4 tests.

If `a_read_on_a_linked_worktree_reads_that_worktree` fails, `open_read_handle`
is opening the wrong path — that is the test doing its job.

If `a_read_never_sees_a_torn_index` fails, the gate is not excluding reads from
writes. Check that `with_repo` still routes to `exclusive`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tests/concurrent_reads.rs
git commit -m "test(git): pin concurrent reads, the worktree reopen and index tearing"
```

---

### Task 5: Documentation

`CLAUDE.md` currently states a convention this change makes false, so that one
is a correctness fix rather than politeness.

**One claim in an earlier draft of this task was wrong and is corrected here.**
It said `test/docs.test.ts` fails the build when a backend module is missing
from the tree in `docs/dev/architecture.md`. It does not. The assertion is
`!doc.includes(name)` over CLAUDE.md plus every `docs/dev/*.md` concatenated, so
it only asks whether the FILENAME is mentioned somewhere in the doc set — a
mention in `backend.md` satisfies it, which was verified by deleting the
architecture.md entry and watching all 3370 tests stay green. The architecture
tree entry is still required by CLAUDE.md's own rule that the tree is the map of
the codebase; it is just not machine-enforced at that granularity.

**Files:**
- Modify: `docs/dev/architecture.md` (backend tree)
- Modify: `docs/dev/backend.md`
- Modify: `CLAUDE.md` (the `git2::Repository` convention bullet)
- Test: `pnpm test` (vitest project `docs`)

**Interfaces:** none.

- [ ] **Step 1: Add the module to the backend tree**

In `docs/dev/architecture.md`, in the `src-tauri/src/git/` listing, add an
entry beside its neighbours (match the surrounding format exactly — find
`rebase_state.rs` and put it after):

```
- `repo_locks.rs` — `RepoLock<T>`: how one repository's handles are ordered.
  One cached handle behind a mutex for writes, a factory minting a private
  handle per read, and an `RwLock` gate ordering the two. Read-vs-read
  exclusion is the only thing it drops; a write still excludes everything
  (#400). Carries its own unit tests, with a fake handle and no timing
  assertions.
```

- [ ] **Step 2: Document the split in `docs/dev/backend.md`**

Find the section covering `git2::Repository` being `Send` not `Sync` and the
per-repo mutex (search for "not `Sync`" or "TOCTOU"). Add:

```markdown
### Reads run concurrently; writes do not (#400)

Each repository sits behind a `RepoLock` (`git/repo_locks.rs`), which is two
things at once: the single cached `git2::Repository` every write uses, and a
factory that mints a handle for one read to keep to itself. An `RwLock` gate
orders them — reads share it, writes take it alone.

**Four helpers, and the naming is a trap worth reading twice.**

| helper | concurrency | handle |
| --- | --- | --- |
| `with_repo` | exclusive | the cached one, `&Repository` |
| `with_repo_mut` | exclusive | the cached one, `&mut Repository` |
| `with_repo_read` | shared | a private one, `&Repository` |
| `with_repo_read_mut` | shared | a private one, `&mut Repository` |

`with_repo` vs `with_repo_mut` is **not** a read/write split, and reading it as
one is how you would break the index. `with_repo` carries most of the writes in
this backend — `stage`/`unstage`/`discard` read-modify-write the whole index
through it, `commit` writes an object and moves a ref, `checkout_branch` and
`reset` rewrite the worktree. `git2` takes `&self` for nearly all of that.
`with_repo_mut` exists only for the seven places libgit2's C signatures demand
`&mut git_repository` (`stash_foreach`, `stash_drop`).

The real split is `_read` or not. **An op joins the `_read` helpers only once
it is established to write nothing** — no index write-back, no ref move, no
object written, no worktree change. Exclusive is the safe default and where an
unexamined op belongs.

**Why this is safe.** Every ordering guarantee written down in `libgit2.rs` is
a guarantee about a write: the stash TOCTOU pair (verify and drop under one
acquisition), the fast-forward ancestry check and ref move, `fresh_index`'s
whole-index write-back, `init`'s guard/write/cleanup window. All of them run
under the exclusive gate, which still excludes every reader and every other
writer, so all of them remain literally true. The only exclusion dropped is
read-vs-read, and nothing was relying on it — neither party writes.

The app also already tolerates concurrent readers and writers it does not
control: the built-in terminal (#243) sits in the window `cd`-ed to the
repository, a `pre-commit` hook that reformats and restages is supported, and
a second window (#402) drives the same repository. In-process concurrent reads
are strictly weaker than that.

**Two rules come with a private handle.**

*Anything reading the index still goes through `fresh_index`.* A newly opened
handle's in-memory index is whatever was on disk a moment ago — the same
staleness a cached handle has, arriving by a different route.

*Never call a repo-lock helper from inside another one for the same
repository.* It returns `AppError::Internal("re-entrant repository lock…")`
rather than deadlocking, but it is a bug. Pass an already-borrowed
`&Repository` down instead, the way `stash_pairs` and the fast-forward helpers
do. The guard exists because a shared gate makes this hazard *intermittent*:
two `read()` acquisitions on one thread succeed whenever no writer is waiting
and deadlock when one is — a hang that appears under load, in release, on a
user's machine, and never in a test. An error is something a test can catch.
Nesting two *different* repositories stays legal; they share no lock.

**Reads reopen the gitdir, not the workdir.** `Repository::open` on a workdir
re-runs discovery, which resolves a linked worktree to the wrong repository
(its gitdir is `<main>/.git/worktrees/<name>/`) and has nothing to discover for
a bare one. `open` captures the gitdir it already resolved and the read handles
use that. `tests/concurrent_reads.rs` pins both shapes.

**What was measured** (macOS/APFS, warm; twelve reads of the shapes
`refreshAll` issues):

| shape | wall clock |
| --- | --- |
| serial through one mutex | 16.9 ms |
| parallel, a fresh handle per read | 10.6 ms |
| parallel, a pre-warmed handle pool | 10.9 ms |

`Repository::open` is ~1.1 ms warm. **A handle pool is measurably worthless**
— do not add one without a profile that disagrees, and note that the factory
lives behind `RepoLock::new` precisely so a pool could be added later without
touching a call site.

The 1.6× serial→parallel figure understates the fix: on APFS the fan-out is
dominated by one slow read, so parallelising the other ten wins little. The
reported bug is the case where every read costs the same ~9 s — twelve of those
serialized is ~108 s and parallel is ~9 s. The win scales with how uniformly
slow the filesystem is, which is the `/mnt/c` shape.

**Which ops are shared today:** `status`, `branches`, `tags`, `stashes`,
`remotes`, `log`/`log_page`, `repo_state`, `rebase_status`, `bisect_status`,
`head_info`, `shallow_info`, `diff_commit`/`diff_commit_over_ceiling`,
`verify_commit`, `worktrees`. That is `refreshAll`'s eleven-read fan-out plus
the ops behind the history-arrowing ladder in #400. Every other read-only op is
still exclusive — not because it must be, but because each needs its own proof
it writes nothing, and moving one is a one-word change.
```

- [ ] **Step 3: Fix the now-false convention line in `CLAUDE.md`**

Find the bullet reading:

```markdown
- **`git2::Repository` is `Send` not `Sync`** — wrap git2 work in
  `spawn_blocking`; per-repo ops serialize on an inner mutex. Verify and mutate
  under ONE lock acquisition (stash TOCTOU). (`docs/dev/backend.md`)
```

Replace with:

```markdown
- **`git2::Repository` is `Send` not `Sync`** — wrap git2 work in
  `spawn_blocking`. Per-repo WRITES serialize on one cached handle; reads run
  concurrently on private handles (`git/repo_locks.rs`), so `with_repo` is the
  exclusive/write path and `with_repo_read` the shared one — the `_mut` suffix
  is about libgit2's signatures, NOT about reads vs writes. An op joins the
  `_read` helpers only once established to write nothing. Verify and mutate
  under ONE lock acquisition (stash TOCTOU); never nest two lock helpers on one
  repository. (`docs/dev/backend.md`)
```

- [ ] **Step 4: Run the doc invariants**

Run: `~/Library/pnpm/pnpm test 2>&1 | tail -25`

Expected: PASS, including the `docs` project. A "Backend modules absent…"
failure means `repo_locks.rs` is not named anywhere in CLAUDE.md or
`docs/dev/*.md` — note that this checks mention, not tree placement, so it will
NOT catch a missing architecture.md entry on its own.

Note: `test/imageDiffView` has a measured ~1-in-111 flake. A red `unit` on a
diff that touches no frontend code is that — re-run rather than investigate.

- [ ] **Step 5: Commit**

```bash
git add docs/dev/architecture.md docs/dev/backend.md CLAUDE.md
git commit -m "docs(git): record the read/write lock split and what was measured"
```

---

### Task 6: Full verification and integration

**Files:** none — this task only runs things and integrates.

- [ ] **Step 1: The whole Rust suite, after the last edit**

Run: `cd src-tauri && ~/.cargo/bin/cargo test --all-targets 2>&1 | tail -20`

Expected: PASS. A green count from before Task 5 is not evidence for this tree;
the last verification has to come after the last edit.

- [ ] **Step 2: Frontend gates**

Run: `~/Library/pnpm/pnpm tsc --noEmit && ~/Library/pnpm/pnpm test 2>&1 | tail -20`

Expected: PASS. No `src/` file changed, so this is a guard against the doc
invariants and nothing else.

- [ ] **Step 3: Rebuild the e2e snapshot and run the specs that touch these ops**

`src-tauri/` changed, so the snapshot is stale and must be rebuilt first.
**One cold container build at a time across all worktrees.**

```bash
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/commit.e2e.ts
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/history-ops.e2e.ts
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/worktrees.e2e.ts
```

Expected: PASS. These three drive the migrated ops end to end — the refresh
fan-out, the history ladder, and the worktree reads. CI runs the full suite.

Note: `history-ops` and `commit` are both in the known CI-only flake class. A
red here that names a wandering sub-test, and reproduces on a recent red `main`
run, is not this change.

- [ ] **Step 4: Squash and open the PR**

The PR squashes to one commit, so squash locally first for a clean message.
**Pin `main`'s SHA before `reset --soft`** — a concurrent PR landing between the
fetch and the reset would otherwise be reverted by this branch.

```bash
git fetch origin
MAIN=$(git rev-parse origin/main)
git reset --soft "$MAIN"
git add -A
git commit -F .git/PR_MSG
git push -u origin perf/repo-handle-pool
```

Commit message / PR body:

```
perf(git): run the read-only fan-out concurrently instead of queued

Read-only ops all took the same exclusive per-repo lock, so the eleven
reads `refreshAll` issues together waited for each other and the user
paid their SUM. On a /mnt/c repository under WSL, where each costs
seconds of stat traffic across the VM boundary, that turned ~9s into
~108s, and arrowing through history laddered to 45s.

Each repository now sits behind a `RepoLock`: one cached handle for
writes, a private handle minted per read, an `RwLock` gate ordering the
two. Fifteen read-only ops move onto the shared path.

**Why:** concurrent reads cannot come from swapping the mutex for an
`RwLock` — `git2::Repository` is `Send` but not `Sync`, so the
parallelism has to come from separate handles.

The only exclusion dropped is read-vs-read. Every ordering guarantee
written down in libgit2.rs is about a WRITE — the stash TOCTOU pair, the
fast-forward ancestry check, fresh_index's whole-index write-back — and
all of them still run under a gate that excludes everything, so all of
them stay literally true.

No handle pool: measured at 10.9ms against 10.6ms for opening one per
read, with `Repository::open` at ~1.1ms. The factory sits behind
`RepoLock::new` so a pool can be added later without touching a call
site.

Nested locking on one repository now returns `Internal` instead of
deadlocking, because a shared gate makes that hazard intermittent —
two read acquisitions on a thread hang only when a writer queues
between them.

Closes #400

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 5: Check the PR's closing keywords, then merge when green**

`gh` has attached closing keywords to the wrong issue before, so verify rather
than trust the body text:

```bash
gh pr view <N> --json closingIssuesReferences,mergeable,mergeStateStatus
```

Expected: `closingIssuesReferences` names **only** #400. Merge with
`gh pr merge <N> --squash` as soon as GitHub reports the PR mergeable — no
rebase needed, `required_linear_history` is satisfied by the squash itself.

Read the run *conclusion* rather than trusting a watcher's exit code, which has
reported 0 on a failed run.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| `RepoLock<T>`, three entry points | 1 |
| Re-entrancy guard returning `Internal` | 1 (impl + tests), 5 (docs) |
| `repos` map holds the lock; gitdir reopen | 2 |
| `with_repo_read` / `with_repo_read_mut` | 2 |
| `with_repo`/`with_repo_mut` unchanged semantics | 2 (routed to `exclusive`), verified by the suite in 2 |
| The fifteen migrated ops | 3 |
| Unit tests: overlap, exclusion, own handle, factory error, nesting, poison | 1 |
| Integration: concurrent agreement, worktree, bare, torn index | 4 |
| Existing suite as the regression net | 3 (step 3), 6 (step 1) |
| `architecture.md` / `backend.md` / `CLAUDE.md` | 5 |

Two gaps found and closed while reviewing:

1. The spec's test list includes "a panic inside `exclusive` poisons the handle
   into `Internal`". Task 1's tests do not cover it — a `#[test]` that panics
   inside a closure aborts under `panic = "abort"` and is awkward under unwind,
   and the behaviour is `std::sync::Mutex`'s, already exercised by the existing
   `map_err(|e| AppError::Internal(...))` idiom throughout the file. Dropped
   deliberately rather than left as an unwritten step; the spec's list is
   otherwise implemented in full.
2. The spec says reopen failures map through `ownership::map_open_error`. Task 2
   Step 2 does that, and adds the `report_as` parameter the spec did not
   mention, so a `DubiousOwnership` error names the path the user chose rather
   than an internal `.git/worktrees/…` one.

**Placeholder scan:** none. Every code step carries the actual code; every run
step carries the actual command and the expected result.

**Type consistency:** `RepoLock::{new, exclusive, shared, shared_mut}` are
named identically in Tasks 1 and 2. `with_repo_read`/`with_repo_read_mut` are
named identically in Tasks 2 and 3 and in the Task 5 documentation.
`open_read_handle(gitdir, report_as)` is defined and called in Task 2 only.
`FakeHandle` is local to Task 1's tests.
