# Concurrent read-only git ops (#400)

Read-only backend ops serialize on the per-repo mutex, so a slow filesystem's
per-op cost gets multiplied by queue depth. `refreshAll` fans out eleven reads
at once; on a `/mnt/c` repository under WSL each costs ~9s of `stat` traffic,
and because they queue the user waits for the sum rather than the slowest.

The fix: give read-only ops a `git2::Repository` handle of their own so they run
concurrently, while writes keep the single cached handle and the exclusive lock
they have today.

## What the issue got wrong, and why it matters

#400 reads the problem as "`with_repo` is a read and `with_repo_mut` is a
write", and proposes splitting the trait's read and write paths on that line.
That is not what those two helpers are.

`with_repo` carries genuine writes. `stage`, `unstage`, `discard` and
`delete_untracked` all read-modify-write the **whole index** through it — which
is the entire reason `fresh_index` exists and the reason
`tests/index_staleness.rs` was written. `commit` writes an object and moves a
ref through it. `checkout_branch`, `reset` and the rebase engine's
`start_pick`/`finish_pick` all mutate the worktree through it.

The real distinction is narrower and duller: `with_repo_mut` exists **only**
because libgit2's `stash_foreach` and `stash_drop` take `&mut git_repository`.
Seven call sites. Nothing else.

So the consequence for the design is decisive: the read path cannot be a
*reinterpretation* of `with_repo`. Silently making `with_repo` shared would let
two `stage` calls interleave their whole-index writes — the exact data loss
`fresh_index` was written to prevent. The read path has to be **new and
opt-in**, with every unmigrated call site keeping today's semantics by
construction.

## Measurements

The issue asks for two things to be measured rather than assumed. Both were,
with a throwaway test against this repository (macOS, APFS, warm page cache).

**Is opening a handle cheap?** Ten consecutive `Repository::open` calls on a
repository with real history and packed refs:

```
2.08ms, 1.32ms, 1.30ms, 1.16ms, 1.06ms, 1.06ms, 1.06ms, 1.07ms, 1.09ms, 0.94ms
```

~1.1ms steady state. For comparison, one `statuses()` on the same repository is
6.3ms warm and 14.8ms cold, and a 200-commit revwalk is 2.3ms warm.

**Does a handle pool beat opening one per read?** Twelve reads of the shapes
`refreshAll` issues, on twelve threads:

| shape | wall clock |
| --- | --- |
| serial through one shared mutex (today) | 16.9 ms |
| parallel, a fresh handle opened per read | **10.6 ms** |
| parallel, handles reused from a pre-warmed pool | 10.9 ms |

The pool is indistinguishable from opening a handle per read — within noise, and
on the wrong side of it. Reusing handles buys nothing because the per-handle
cost libgit2 re-pays on open (re-mmapping pack indexes, re-reading config and
`packed-refs`) is dwarfed by the read itself, and the OS page cache is shared
across handles regardless.

Note what the 1.6× serial→parallel figure does **not** say. On APFS the fan-out
is dominated by one slow read (`status`), so parallelising the other ten wins
little. The reported bug is the case where *every* read costs about the same
~9s: twelve of those serialized is ~108s, and parallel is ~9s. The win scales
with how uniformly slow the filesystem is, which is exactly the `/mnt/c` shape.

### The soft spot

Both measurements are APFS. The claim that carries to WSL is the ratio — a ~1ms
open against a ~9,000ms status is noise by four orders of magnitude, and drvfs
would have to make `Repository::open` a thousand times more expensive than
measured for a pool to matter. That is a strong inference but it is an
inference; there is no WSL machine in the loop here.

This is why the design puts the handle factory behind `RepoLock`'s constructor
rather than at the call sites: if a `/mnt/c` profile ever shows the open cost
mattering, a pool slots in behind `with_repo_read` without touching a single one
of the migrated ops. Building the pool now on a measurement that says it is
worthless is the wrong order.

## Design

### `git/repo_locks.rs` — the ordering primitive, on its own

One new module owning one idea: how a repository's handles are ordered. Generic
over the handle type, so its concurrency can be tested without libgit2 in the
picture.

```rust
pub struct RepoLock<T> {
    /// Orders reads against writes. Reads share it; writes take it alone.
    gate: RwLock<()>,
    /// The one cached handle every write runs on — the handle this app has
    /// always had, behind the mutex it has always had.
    exclusive: Mutex<T>,
    /// Makes a handle for a reader to keep to itself.
    open: Box<dyn Fn() -> AppResult<T> + Send + Sync>,
}
```

Three entry points:

| method | gate | handle | for |
| --- | --- | --- | --- |
| `exclusive(f)` | write | the cached one, `&mut T` | every write; today's behaviour unchanged |
| `shared(f)` | read | a fresh one, `&T` | read-only ops |
| `shared_mut(f)` | read | a fresh one, `&mut T` | read-only ops needing `&mut` (`stash_foreach`) |

`shared_mut` handing out `&mut` under a *shared* gate is safe and is not a
contradiction: the handle belongs to that reader alone and dies with the call.
The `&mut` is about libgit2's C signature, not about mutating the repository.

### `libgit2.rs` — the map, and the two new helpers

```rust
repos: Mutex<HashMap<RepoId, Arc<RepoCell>>>,

struct RepoCell {
    /// The gitdir, captured at open time.
    gitdir: PathBuf,
    lock: RepoLock<Repository>,
}
```

`repo_cell` keeps its current job and its current comment: clone the `Arc` out,
release the map lock immediately.

The four helpers, none of which changes any call site's signature:

- `with_repo` / `with_repo_mut` → `cell.lock.exclusive(...)`. Byte-for-byte
  today's semantics: one cached handle, one exclusive lock.
- `with_repo_read` / `with_repo_read_mut` → `cell.lock.shared(...)` /
  `shared_mut(...)`.

**Reads reopen from the gitdir, not the path the user named.** Both work —
checked by planting the alternative and watching the tests stay green, because
`Repository::open` on a linked worktree's workdir follows the `.git` file there
and lands on the same repository. (An earlier draft of this spec asserted the
workdir "resolves a linked worktree to the wrong repository". That is false, and
it is recorded here rather than quietly deleted because it was the sort of claim
that reads as authoritative and would have been inherited by the next reader.)

The gitdir is still the better of two working choices: it is the path libgit2
itself resolved, so a read handle is the same repository as the cached one by
construction rather than by re-deriving it; it skips the `.git`-file indirection
on every read, which is a file read per op on exactly the filesystems this issue
is about; and nothing happening at the user-supplied path afterwards can change
where a read lands.

Reopen failures map through `ownership::map_open_error`, the same path `open`
uses, so a repository that becomes untrusted mid-session says so rather than
surfacing a raw libgit2 error — reported against the path the user named, not an
internal `.git/worktrees/…` one.

### What exclusion this drops, and what it keeps

It drops read-vs-read exclusion. Nothing else.

That is the whole safety argument, and it is worth stating precisely, because
every ordering guarantee documented in `libgit2.rs` is a guarantee **about a
write**:

- the stash TOCTOU rule (`stash_drop_at`, `stash_finish_rename`) — verify and
  drop under one acquisition, so no concurrent `refs/stash` **write** can shift
  the indexes underneath;
- the fast-forward pair (`git/libgit2.rs`, "Fast-forwarding a branch that is not
  checked out") — the ancestry check and the ref **move** under one acquisition;
- `fresh_index` — the staging ops' whole-index **write-back** must not revert
  what something else staged;
- `init`'s `init_lock` — guard, **write**, cleanup as one window.

Each of those is preserved literally, because each runs under
`exclusive`, and `exclusive` still excludes every reader and every other
writer. Two readers running at once cannot violate any of them: neither one
writes.

`fresh_index`'s own closing paragraph already draws the line this design sits
on — "It closes the window we own (our own stale cache), not the one we do not:
against a writer racing us right now, git's `index.lock` is the only arbiter."
The app has always had concurrent external readers and writers: the built-in
terminal (#243) sits in the window `cd`-ed to the repository, a `pre-commit`
hook that reformats and restages is a supported case, and a second window (#402)
drives the same repository. This change adds concurrent in-process *readers*,
which is a strictly weaker thing than what the code already tolerates.

### The one new hazard: intermittent re-entrancy

Today, calling a locking op from inside another locking closure for the same
repository is a **guaranteed** deadlock — std's `Mutex` is not reentrant — and
the code is written to avoid it. Two comments say so explicitly: `stash_pairs`
takes an already-borrowed `&mut Repository` "so it can run INSIDE a
`with_repo_mut` closure … std's `Mutex` is not reentrant, so calling it from
inside a closure that holds the lock would deadlock", and the fast-forward
helpers say the same.

A shared gate makes one case *worse* by making it non-deterministic. Two
`read()` acquisitions on the same thread succeed most of the time and deadlock
when a writer queues between them — a hang that appears under load, in release,
on a user's machine, and never in a test.

So `RepoLock` carries a thread-local re-entrancy guard: each acquisition records
the lock it holds and refuses a nested acquisition of the same lock with
`AppError::Internal`. A legible error beats an intermittent hang, and it is
testable, which an intermittent hang is not. Keyed per `RepoLock`, so an op on
repository A nested inside an op on repository B stays legal — that pairing has
no shared lock and no deadlock.

The guard is live in release builds too. It costs a thread-local vector push per
git op, against git ops that cost milliseconds at best.

### Which ops migrate

The fifteen the issue measured, and no more:

**`refreshAll`'s fan-out (eleven, the clustered burst):** `status`, `branches`,
`tags`, `stashes` (via `shared_mut`), `remotes`, `log_page`, `repo_state`,
`rebase_status`, `bisect_status`, `head_info`, `shallow_info`.

**The history-arrowing ladder (four):** `diff_commit`,
`diff_commit_over_ceiling`, `verify_commit`, `worktrees`.

`verify_commit` and `bisect_status` are worth naming: both shell out
(`gpg`/`ssh-keygen`, `git rev-list --bisect-vars`) while holding the exclusive
lock today, so a signature check blocks every unrelated read in the process.
That is the `verify_commit` sitting alongside each step of the issue's ladder.

Every other read-only op — `log`, `log_filtered`, `diff`, `diff_commits`,
`file_history`, `blame_file`, `read_file_content*`, `commits_since`,
`ahead_behind`, `submodules`, `lfs_status`, `commit_notes`, `read_reflog`,
`list_all_files`, `list_files_at_rev`, `commit_template`, `difftool_plan`,
`conflict_sides` — stays exclusive for now. Not because it must, but because
each needs individual proof it writes nothing, and thirty-five of those proofs
in one diff is a review nobody performs properly. Migrating one later is a
one-word change at the call site.

## Testing

**`RepoLock` unit tests, with a fake handle and no timing assertions.** A
wall-clock comparison would be a flake; these are deterministic:

- *N shared acquisitions overlap.* Eight threads take `shared`, each announces
  arrival and waits for the count to reach eight under a bounded condvar wait.
  If the lock serialized, thread one would hold it while waiting for seven that
  cannot enter — so serialization fails the assertion rather than slowing it.
- *A shared acquisition excludes an exclusive one, and vice versa.*
- *Each `shared` call gets its own handle* — the factory is invoked once per
  call, and two overlapping readers hold different handles.
- *A factory error propagates* as the op's error.
- *Nesting is refused, not hung* — all four pairings (shared-in-shared,
  shared-in-exclusive, exclusive-in-shared, exclusive-in-exclusive) return
  `Internal`; nesting across two different `RepoLock`s is allowed.
- *A panic inside `exclusive` poisons the handle into `Internal`*, not a
  silent wrong answer.

**Backend integration tests** (`src-tauri/tests/concurrent_reads.rs`):
concurrent reads on one repository return the same answers as serial ones; reads
work on a **linked worktree** and on a **bare** repository; `status` stays
coherent beside a stream of `stage` writes.

**What pins the gate, checked rather than assumed.** Removing the gate from
`shared_mut` entirely leaves the integration tests green — libgit2 writes the
index to `.git/index.lock` and renames it into place, so a reader on its own
handle sees the whole old index or the whole new one, never a half-written file.
Git's on-disk atomicity does that work, not `RepoLock`. The test that fails
without the gate is the unit test `shared_and_exclusive_never_overlap`.

That is worth stating plainly because it narrows what the gate is *for*. It is
not protecting single-file writes, which git already makes atomic. It is
protecting the **in-process, multi-call** invariants — the stash verify-then-drop
pair, the fast-forward ancestry-check-then-ref-move — where the guarantee spans
several git calls inside one closure and no single rename covers it. Those are
precisely the invariants `libgit2.rs` documents, and precisely why dropping the
gate is a separate decision from this one.

**The existing suite is the real regression net.** Around ninety integration
test files drive these ops, and the re-entrancy guard turns any latent nesting
into a hard failure — so a green `cargo test` is meaningful evidence that no
migrated op was reachable from inside another lock.

## Docs to update in the same commit

- `docs/dev/architecture.md` — `git/repo_locks.rs` in the backend tree.
  `test/docs.test.ts` fails the build otherwise.
- `docs/dev/backend.md` — the read/write split, the gitdir reopen, the
  re-entrancy rule, and the measurements above.
- `CLAUDE.md` — the convention line currently reads "per-repo ops serialize on
  an inner mutex". After this, per-repo **writes** serialize; reads do not.
  That line is load-bearing and now wrong.

## Out of scope

- **Letting reads run during a write.** Removing the gate would help a UI that
  freezes for the length of a rebase or checkout, which is a real complaint but
  not the one #400 reports and not one there is evidence for here. It would also
  be a semantic change rather than a scheduling one. Its own issue, its own
  evidence.
- **A handle pool.** Measured as worthless; see above. The interface is shaped so
  it can be added later without touching call sites.
- **Reducing the fan-out.** Eleven concurrent reads at startup may be more than
  necessary, but making them cheap and making them fewer are independent, and
  this change is the one with the evidence behind it.
- **"Move the repo off `/mnt/c`."** #400 rules it out and is right to: the
  repository lives on the Windows drive because Windows tools need it there.
