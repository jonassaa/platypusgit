# Clone options + shallow honesty — Implementation Plan

**Goal:** Add depth / blobless / single-branch / submodules to the Clone dialog
behind a collapsed **Advanced** section, and make a shallow or single-branch
clone say so on every surface it distorts — with one-click `git fetch
--unshallow`.

**Architecture:** Options are flags on the existing `run_clone` — one clone
implementation, one credential path. Shallow state is READ from git
(`Repository::is_shallow()` + `<commondir>/shallow`), never remembered. Unshallow
is a fetch and goes through `commands::net::run_git_authenticated_with_progress`
like every other network op.

**Spec:** `docs/superpowers/specs/2026-08-30-clone-options-spec.md`

## Global constraints

- Every IPC-crossing fn returns `AppResult<T>`; new `AppError` variants (if any)
  land with their TS counterpart in the same commit.
- Never `Command::new` outside `proc.rs`; end option parsing with `--` before
  any user-supplied value; secrets in env, never argv.
- One credential path — `commands::net::run_git_authenticated*`; on the frontend
  `useRepoStore`'s exported `withAuthRetry`, with `{ key, label }` so the
  activity indicator survives the credential prompt.
- `shallowInfo` is a per-repo field → `RepoSlice` **and** `emptySlice`.
- git2 work inside `spawn_blocking`.
- Register every new command in `invoke_handler![…]` **and** in
  `docs/dev/architecture.md`, or `test/docs.test.ts` fails the build. A new
  `src-tauri/src/**/*.rs` module must be named there too.
- `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before pnpm/cargo.

## Tasks

### 1. Backend types

- [ ] `git/types.rs`: `CloneOptions { recurse_submodules, depth: Option<u32>,
      blobless, single_branch }` (Deserialize, camelCase, `Default`) and
      `ShallowInfo { shallow, boundary_count, single_branch }` (Serialize,
      camelCase).

### 2. `git/shallow.rs` — the pure half

- [ ] `count_shallow_roots(text) -> usize` (non-empty lines of `.git/shallow`).
- [ ] `refspec_is_pinned(src) -> bool` — the source side of a fetch refspec
      carries no `*`.
- [ ] `single_branch_from_refspecs(per_remote: &[Vec<String>]) -> bool`.
- [ ] Unit tests in the module, no repository needed.

### 3. `clone_args` grows the flags

- [ ] `clone_args(url, name, &CloneOptions)`; `--depth N`, `--filter=blob:none`,
      `--single-branch` / `--no-single-branch` (the `--depth` implication),
      `--recurse-submodules`, all BEFORE `--`.
- [ ] `run_clone` takes `&CloneOptions`; `clone_repo` takes `options` and refuses
      `depth: Some(0)` with `InvalidArgument`.

### 4. `GitBackend::shallow_info`

- [ ] Trait method + `Libgit2Backend` impl (`is_shallow()`, read
      `<commondir>/shallow`, walk remote fetch refspecs) + `CliBackend` stub.
- [ ] `commands/repo.rs::shallow_info` (thin, `spawn_blocking`).

### 5. `unshallow`

- [ ] `commands/branches.rs::unshallow` → `AppResult<bool>`; `Ok(false)` when the
      repository is already complete; `unshallow_args()` unit-tested.
- [ ] Register both new commands in `lib.rs`.

### 6. Frontend plumbing

- [ ] `lib/types.ts`: `CloneOptions`, `ShallowInfo`.
- [ ] `lib/tauri.ts`: `cloneRepo(…, options, credentials)`, `shallowInfo`,
      `unshallow`.
- [ ] `repoSlice.ts`: `shallowInfo` + `DEFAULT_SHALLOW_INFO`.
- [ ] `useRepoStore`: eleventh `trackLoad` in `refreshAll`; `unshallow()` action
      through `withAuthRetry` under the `fetch` activity key.

### 7. The dialog

- [ ] `CloneDialog`: collapsed **Advanced** disclosure — depth (checkbox + count),
      blobless, single branch; submodules moves inside it. Form resets on
      reopen like every other field.

### 8. The notices

- [ ] `features/repo/shallowNotice.ts` — pure `shallowNoticeText(info, surface)`.
- [ ] `features/repo/ShallowNotice.tsx` — the strip + Unshallow button.
- [ ] Mount on History, FileHistory, Blame, Compare.
- [ ] `test/shallowSurfaces.test.ts` guard.

### 9. Tests

- [ ] Rust: `tests/clone_options.rs` — every flag combination cloned from a local
      `file://` source, shallow detection, boundary count, single-branch
      detection, unshallow restoring full history, unshallow on a complete repo.
- [ ] Rust: update `clone_init.rs` for the new `clone_args`/`run_clone` shape.
- [ ] vitest: dialog Advanced section, `shallowNoticeText`, `ShallowNotice`,
      `useRepoStore.unshallow`, updated `loading` id set.

### 10. Docs

- [ ] `docs/dev/architecture.md`: `git/shallow.rs`, `CloneOptions`/`ShallowInfo`
      in `types.rs`, `shallow_info` on `commands/repo.rs`, `unshallow` on
      `commands/branches.rs`, `ShallowNotice` under `features/repo/`.
- [ ] `docs/dev/backend.md` + `docs/dev/frontend.md`: the rules worth keeping.

### 11. Verify

- [ ] `pnpm tsc --noEmit`, `pnpm test`, `cargo test`.
