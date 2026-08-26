# Cancel a running clone, fetch, pull or push (issue 234)

Status: approved for implementation.
Issue: [234](https://github.com/jonassaa/platypusgit/issues/234).

## Goal

A clone, fetch, pull or push that hangs can be stopped from the UI, and stopping
it leaves the repository exactly as it was. Today the only escape is force-quit,
which our own source already admits at `commands/create.rs:253` ("a clone has no
cancel button, so a hang here is force-quit").

## What already exists, verified in the tree

- **Every network op is a spawned child process**, so cancellation is a signal,
  not a libgit2 problem: `run_clone` spawns `git clone --progress` via
  `proc::git_async_in`, and `net::run_git_authenticated` spawns fetch/pull/push
  via `proc::git_async`. Nothing goes through libgit2's transport.
- **`kill_on_drop(true)` is already set on the clone child**, so a *dropped
  future* kills git. That covers nothing the user can trigger — no code path
  drops those futures — which is why the comment at `create.rs:258` describes the
  window-close case as a hazard rather than a handled one.
- **Progress already streams** for clone (`clone://progress`, parsed by
  `parse_progress`) and fetch/pull/push already render a label through
  `RepoActivity` + `AppStatusBar`. So "real progress" from the issue's list is
  half-built: what is missing is a control next to it.
- **`validate_clone_target`** guarantees the clone destination is either absent
  or an existing **empty** directory. That is what makes cleanup decidable —
  see decision 4.
- `libc` is already a `cfg(unix)` dependency (declared for the `pgit` detach), so
  a signal needs no new crate.

## What is missing

1. No way to address an in-flight op from the frontend — nothing is keyed, so
   there is nothing to cancel.
2. No cancel affordance anywhere: `CloneDialog`'s Cancel button is `disabled={busy}`,
   and `useCreateStore.close()` refuses to close while busy.
3. No `AppError` variant for "the user stopped it", so a cancelled op would
   surface as a red `Network` banner quoting git's death rattle.
4. Nothing cleans up a partially-written clone directory.
5. Window close does not stop anything.
6. The auto-fetch timer can stack: `AppShell`'s `setInterval` calls `fetchAll`
   unconditionally, so a stalled fetch is joined by another one every N minutes,
   with nobody watching.

## The decisions

### 1. The frontend mints the op id, and passes it in

Every cancellable command takes an `opId: Option<String>`. The **frontend
generates it before the invoke**, so the cancel button is live from the first
frame rather than after a round trip that may never come back — which is the
whole point, since the op we most need to cancel is the one that never answers.

The alternative (backend assigns an id and emits it) has a window where the op is
running and uncancellable, and that window is unbounded for exactly the hang this
issue is about.

`opId` is `Option` on the Rust side so an omitted id means "not cancellable" and
every existing caller — `push_tag`, `push_delete_branch`, LFS, submodule update,
forge PR checkout — keeps working untouched. Those ops are short and have no
progress surface; they can opt in later by passing an id, which is a one-line
change per call site.

### 2. One registry, keyed by op id, holding a pid and a flag

New module `src-tauri/src/cancel.rs`:

- `OpRegistry` — `Mutex<HashMap<String, Arc<Op>>>`, managed as Tauri state.
- `Op` — a cancelled flag (`AtomicBool`) and the child's pid once spawned.
- `begin(id) -> OpGuard` — registers, and de-registers on `Drop` so a `?` return
  cannot leak an entry.
- `cancel(id)` / `cancel_all()`.

**No async signalling.** The registry does not tell the op to stop; it kills the
op's child directly, and the op then *notices*. Its `wait()`/`wait_with_output()`
returns because the child is dead, and it checks `op.is_cancelled()` before
mapping stderr to an error. This is what keeps the change small: no
`tokio::select!` over a `&mut Child` (which does not borrow-check), no
`Arc<Mutex<Child>>` (whose lock the killer would wait on behind `wait()`).

### 3. SIGTERM to the process group, not SIGKILL to the child

Two things are wrong with `child.kill()`:

- **It is the wrong process.** `git clone` over https spawns `git-remote-https`;
  over ssh it spawns `ssh`. Killing only `git` leaves the transfer's child holding
  the connection.
- **It is the wrong signal.** git installs signal handlers that remove its lock
  files (`lockfile.c`) and, in `clone`, the partial destination
  (`remove_junk_on_signal`). SIGKILL skips all of it, so a cancelled pull leaves
  `.git/index.lock` behind and the *next* pull fails with "Unable to create
  '.../index.lock': File exists". A cancel that breaks the next operation is
  worse than no cancel.

So: `proc::git_async`/`git_async_in` put the child in its **own process group**
(`process_group(0)`, unix only), and cancel sends **SIGTERM to that group**.
Applied in the constructors rather than at the two cancellable call sites, for the
same reason `CREATE_NO_WINDOW` is: a call site can forget. The console-keeping
constructors are deliberately excluded — a console program in a process group
other than the terminal's foreground group is stopped by SIGTTIN/SIGTTOU the
moment it touches the tty.

`kill_tree` reads `getpgid(pid)` and only uses `killpg` when the pid **is** the
group leader, falling back to `kill(pid)` otherwise. Without that check, a future
spawn site that skipped `process_group` would have us signal our own process
group — i.e. kill the app.

**A second cancel escalates to SIGKILL.** No timer, no `tokio::time`: the user
clicking Cancel again is the escalation signal, and the first click has already
given git its chance to clean up.

On Windows there is no SIGTERM and our children have no console (they are spawned
`CREATE_NO_WINDOW`, so `GenerateConsoleCtrlEvent` has nothing to signal), so
cancel runs `taskkill /F /T /PID <pid>` — the whole tree, abruptly. The lock-file
caveat above therefore stands on Windows; our own cleanup (decision 4) covers the
clone directory, and a stale `index.lock` is the remaining known gap, recorded in
`docs/dev/backend.md`.

### 4. A cancelled clone restores the pre-clone state exactly

`validate_clone_target` leaves exactly two possibilities, so `run_clone` records
which one it saw **before** spawning:

| Before the clone | On cancel |
| --- | --- |
| target did not exist | `remove_dir_all(target)` |
| target existed and was empty | remove its **contents**, keep the directory |

That restores what was there, and never removes a directory the user already had.
git's own SIGTERM handler usually gets there first (leaving `remove_dir_all` a
`NotFound` no-op); this is the backstop that makes the guarantee hold on Windows
and against a git that dies before its handler runs.

Cleanup runs **only on cancel**, not on failure: a failed `git clone` already
removes its own destination, and widening this to every failure would mean
deleting a directory on a path we did not just prove was ours.

### 5. `AppError::Cancelled` — a cancelled op is not a failure

New unit variant, 1:1 in the TS union, with `isCancelledError` in `lib/errors.ts`.
Every catch arm that would raise a banner checks it first: the user knows they
cancelled, and an error banner saying so is the app arguing with them.

It must also **not raise the credential prompt**. `withAuthRetry` narrows on
`isAuthError`, and killed git prints nothing that `classify_auth_failure` matches,
so this holds by construction — but the cancel check comes *before*
`map_git_failure` anyway, so a remote whose dying words happen to look like an
auth failure cannot pop a dialog over a cancel.

### 6. Where the cancel button goes

- **Clone:** the dialog's existing Cancel button becomes live while busy — it
  cancels instead of being disabled. That is the button the user is already
  reaching for. `close()` keeps refusing to close mid-run; the cancel path drops
  `busy` itself when the backend confirms.
- **Fetch/pull/push:** one **Stop** button in the titlebar's right slot, next to
  Push, rendered only while a cancellable op is in flight, titled with what it
  will stop. Deliberately not a mode-switch on the Fetch/Pull/Push buttons (a
  mis-click on a button whose meaning just changed under the pointer) and not the
  status-bar activity label (a label is not a control).
- **Keyboard:** a palette row, `Cancel network operation`, listed only while one
  is running — the same gating `Resolve conflicts…` uses.

### 7. Per-repo op ids live in the slice, next to the activity label

`RepoSlice` gains `netOps: { fetch?: string; pull?: string; push?: string }` — op
ids keyed the same way `activity` keys its labels, set and cleared in the same
four actions. It is per-repo state, so it belongs in `RepoSlice`/`emptySlice` or a
tab switch leaks it (CLAUDE.md).

`RepoActivity`'s values are left as plain label strings on purpose: `pull`
re-labels itself three times (stash → pull → pop), and threading an id through
each relabel is how one of them ends up dropping it.

### 8. Auto-fetch: don't stack, and give it a deadline

The timer is the one op with nobody watching, so it gets what a watched op does
not need:

- **Skip while a fetch is already in flight** — the stacking the issue names.
- **Cancel after 2 minutes.** An interactive fetch is never cancelled on a timer;
  the user is right there. A background one that has been stalled for two minutes
  is not going to finish, and leaving it there is how you accumulate four of them.

## Out of scope, deliberately

- **Cancelling `push_tag`, `push_delete_branch`, LFS, submodule update and forge
  checkout.** They take an `opId` of `None` and behave exactly as today. Each is
  one line and one UI affordance away, and none of them is the first-five-minutes
  hang this issue is about.
- **A timeout for interactive ops.** A user watching a slow clone of
  `torvalds/linux` must not have it yanked away at 120s.
- **Resuming a cancelled clone.** `git clone` has no resume; the offer would be a
  fresh clone, which the dialog already is.

## Acceptance

- Start a clone of a host that accepts the connection and stalls. The dialog
  shows progress, Cancel is enabled, clicking it returns the dialog to an idle,
  dismissable state with no error banner, and the destination directory is gone.
- Start a fetch against the same host. A Stop button appears next to Push;
  clicking it clears the status-bar activity with no banner, and the next fetch
  works (no stale `index.lock`).
- Close the window mid-clone: no `git` process survives the app.
- With auto-fetch on and a stalled remote, exactly one fetch is ever in flight,
  and it stops on its own after two minutes.
