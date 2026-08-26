# Plan — Cancel a running clone, fetch, pull or push (issue 234)

Spec: `docs/superpowers/specs/2026-08-26-cancel-network-ops-spec.md`.
One PR. Branch `feat/cancel-net-ops`.

## Step 1 — `AppError::Cancelled`

- `src-tauri/src/error.rs`: unit variant `Cancelled`, `#[error("operation cancelled")]`,
  doc comment saying it is a *state*, not a failure, and must never reach a banner.
- `src/lib/errors.ts`: `{ kind: "Cancelled"; message?: string }` in the union
  (same shape as `NoBisect`), plus `isCancelledError(e)`.
- Test: `src/lib/errors.test.ts` — `isCancelledError` narrows, and
  `appErrorMessage` still yields the kind rather than an empty banner.

## Step 2 — `src-tauri/src/cancel.rs`

```rust
pub struct OpRegistry { ops: Mutex<HashMap<String, Arc<Op>>> }
pub struct Op { id: Option<String>, cancelled: AtomicBool, pid: Mutex<Option<u32>> }
pub struct OpGuard { registry: Arc<OpRegistry>, op: Arc<Op> }
```

- `OpRegistry::begin(self: &Arc<Self>, id: Option<&str>) -> OpGuard` — `None`
  yields a **detached** op (no map entry, never cancellable) so callers never
  branch on it.
- `Op::is_cancelled()`, `Op::attach(pid) -> bool` (false = cancel already landed,
  caller kills its own child and bails), `Op::cancel()`.
- `OpRegistry::cancel(id) -> bool`, `cancel_all()`, `finish(id)`.
- `Drop for OpGuard` → `finish`.
- `kill_tree(pid, hard: bool)`:
  - unix: `getpgid(pid) == pid` → `killpg`, else `kill`; signal `SIGTERM`, or
    `SIGKILL` when `hard`.
  - windows: `taskkill /F /T /PID` through `proc::program` (never a raw
    `Command::new` — `tests/spawn_no_window.rs` counts those).
- `Op::cancel()` sets the flag, then kills; `hard` = "the flag was **already**
  set", i.e. the user clicked Cancel twice.
- Rust unit tests: a detached op is never cancelled; `attach` after `cancel`
  returns false; `cancel` on an unknown id is `false`; `Drop` de-registers;
  `cancel_all` marks every entry. (No live child needed for any of these.)

## Step 3 — `proc.rs`: own process group

- `git_async` and `git_async_in` call a new `cfg(unix)` `own_process_group`
  (`cmd.process_group(0)`), with the doc comment explaining why the
  console-keeping constructors are excluded (SIGTTIN/SIGTTOU).
- Test: `the_console_keeping_constructors_apply_no_policy` gains a line asserting
  the two console constructors are still the only ones with no policy applied
  (`process_group` has no getter, so the assertion documents the split rather
  than reading it back).

## Step 4 — `commands/net.rs`

- `run_git_authenticated(cwd, args, creds)` keeps its signature and delegates to
  the new `run_git_cancellable(cwd, args, creds, &Op::detached())`.
- `run_git_cancellable`:
  1. bail with `Cancelled` if the op is already cancelled (no spawn at all),
  2. `.stdout(piped()).stderr(piped()).kill_on_drop(true)`, spawn,
  3. `op.attach(child.id())` — false → `start_kill()` + `Cancelled`,
  4. `wait_with_output()`, then **check `is_cancelled()` before**
     `map_git_failure`.
- `#[tauri::command] cancel_operation(registry, op_id) -> AppResult<bool>`.
- Register in `lib.rs`'s `invoke_handler!`, `.manage(Arc::new(OpRegistry))`.

## Step 5 — `commands/branches.rs`: thread `opId` through the four ops

- `fetch`, `fetch_all`, `pull`, `push` gain `op_id: Option<String>` and go through
  `run_git_cancellable` with `registry.begin(op_id.as_deref())`.
- `run_git`/`run_git_creds` keep delegating with no op — `push_tag`,
  `push_delete_branch` and the rest are untouched.

## Step 6 — `commands/create.rs`: clone

- `run_clone` gains `op: &Op` and returns `Cancelled` at three points: before the
  spawn, on a failed `attach`, and after the read loop / `wait()`.
- Read-error arm checks `is_cancelled()` before mapping to `Io`.
- `target_existed` recorded after `validate_clone_target`, before the spawn.
- New `discard_partial_clone(target, existed)` per spec decision 4, with unit
  tests over a `tempfile` dir for both branches (and for a target that git
  already removed).
- `clone_repo` gains `op_id: Option<String>`.

## Step 7 — window close

- `lib.rs`: `.on_window_event(...)`, gated on `window.label() == "main"` — the
  merge resolver window is labelled `merge` and closing it must not stop a fetch.
  `CloseRequested` → `registry.cancel_all()`.

## Step 8 — frontend plumbing

- `src/lib/opId.ts`: `newOpId(kind)` → `` `${kind}-${Date.now().toString(36)}-${random}` ``.
  Not `crypto.randomUUID()`, which needs a secure context we do not control on
  every platform's custom protocol. Unit test: unique across calls, carries the
  kind.
- `src/lib/tauri.ts`: `opId` on `fetch`, `fetchAll`, `pull`, `push`, `cloneRepo`;
  new `cancelOperation(opId)`.
- `src/features/repo/repoSlice.ts`: `netOps: NetOps` + `{}` in `emptySlice`.
- `src/features/repo/useRepoStore.ts`:
  - the four actions mint an id, set `netOps[kind]`, pass it, clear it in the
    same `finally` that clears the activity label,
  - a `Cancelled` catch is **not** an error: `setErrorFor` is skipped (the
    existing `refreshAll()`-first ordering is kept),
  - `cancelNetOp(kind)` and `cancelAllNetOps()` actions.
- `src/features/create/useCreateStore.ts`: `opId` in state, `cancelClone()`,
  and `runClone`'s catch treats `Cancelled` as "close the dialog, no error".

## Step 9 — frontend surfaces

- `CloneDialog`: Cancel is enabled while busy and calls `cancelClone()`;
  `data-testid="clone-cancel"`.
- `AppShell`: a `Stop` button in the titlebar right slot, gated on
  `netOps.fetch ?? netOps.pull ?? netOps.push`, `data-testid="net-cancel"`.
- `palette/commands.ts`: `action:cancel-net-op`, gated the same way.
- `AppShell` auto-fetch effect: skip while `activity.fetch` is set, and arm a
  120s timer that cancels the fetch it started.
- Component tests: `CloneDialog` cancel path, the Stop button's appear/disappear
  and click, the store's `Cancelled` handling (no banner), the palette row's
  gating, and the auto-fetch skip + deadline.

## Step 10 — docs + verification

- `docs/dev/architecture.md`: `cancel.rs` in the backend tree, `cancel_operation`
  on the `commands/net.rs` entry, `op_id` noted on the four ops and clone.
- `docs/dev/backend.md`: a "Cancelling a network op" section — the registry, the
  signal choice, the process group, the clone cleanup table, and the Windows
  lock-file caveat.
- `docs/dev/frontend.md`: `netOps` alongside the `RepoActivity` note, and where
  the two cancel affordances live.
- `CLAUDE.md`: one line on the one-cancel-path rule under the conventions list.
- Gates: `cargo test`, `cargo check`, `pnpm tsc --noEmit`, `pnpm test`, then
  `pnpm test:e2e:docker build` + the `create.e2e.ts` / `remote.e2e.ts` specs.

## Step 11 — e2e (attempt; drop if it cannot be made deterministic)

A cancellable op needs a remote that **stalls**, and a `file://` clone finishes
instantly. The spec process is Node, so it can open a TCP listener that accepts
and never replies, and `git clone git://127.0.0.1:<port>/x` then hangs in
"Connecting" forever — a deterministic hang with no network access. Assert:
progress → Cancel → dialog idle, no `clone-error`, destination absent.

Read `.claude/skills/e2e-testing/SKILL.md` first. If the listener cannot be
reached from the app's container, drop the spec rather than shipping a flaky one,
and say so in the PR.
