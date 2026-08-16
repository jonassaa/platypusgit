# Stash improvements — implementation plan

**Goal:** Stash a selection of paths instead of the whole worktree; rename a
stash entry without losing it; and make "look inside this stash" answer what
the stash changed, plus a second target answering how it stands against the
working tree.

**Architecture:** Three additive `GitBackend` ops on the standard six-step path,
two of which shell out to real `git` (prompt-less, local — NOT the credentialed
runner), plus two new fields on `StashInfo`. One new pure backend module
(`git/stash.rs`) for the argv builders. Frontend: one new `Target` case and one
fixed case in `CommitDiff`, three new menu entries, three `useRepoStore`
actions. No new screen, no new `RepoSlice` field, no new `AppError` variant.

**Tech Stack:** Rust + libgit2 (`git2`) + `std::process::Command`, Tauri 2
commands, React 18 + Zustand, vitest/RTL.

**Design doc:** `docs/superpowers/specs/2026-08-16-stash-improvements-spec.md`
**Issue:** [#133](https://github.com/jonassaa/platypusgit/issues/133)

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`. No new `AppError` variants —
  `InvalidArgument` / `InvalidRef` / `Git` cover every failure here. TS
  `AppError` therefore needs no change.
- Wrap every backend call in `spawn_blocking` from the command layer.
- Frontend never calls `invoke()` directly — typed wrappers in `src/lib/tauri.ts`.
- UI primitives from `@/design`; never `window.confirm`/`window.prompt`.
- The two shell-outs are **local**: `libgit2.rs::run_git_capture`'s prompt-less
  family, never `commands::net::run_git_authenticated`.
- `--` before any user-supplied argv value; `GIT_LITERAL_PATHSPECS=1` wherever a
  pathspec is passed.
- `useRepoStore`/`RepoSlice` gain no per-repo field (the stash list is already
  `stashes`, already in the slice).
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run e2e in this change.** Specs may be written, never executed.

## File Structure

**Create:**
- `src-tauri/src/git/stash.rs` — pure argv builders + their unit tests.
- `src-tauri/tests/stash_diff.rs`
- `src-tauri/tests/stash_rename.rs`
- `src-tauri/tests/stash_partial.rs`
- `src/screens/CommitDiff.stash.test.tsx`
- `src/design/context-menu.stash.test.tsx`

**Modify:**
- `src-tauri/src/git/types.rs` — `StashInfo { oid, untracked }`.
- `src-tauri/src/git/mod.rs` — `pub mod stash;` + three trait methods.
- `src-tauri/src/git/libgit2.rs` — `stashes` fills the new fields; the three
  impls; `run_git_capture` gains an env-carrying sibling.
- `src-tauri/src/git/cli.rs` — three `NotImplemented` stubs.
- `src-tauri/src/commands/stash.rs` — three thin commands.
- `src-tauri/src/lib.rs` — register them.
- `src/lib/types.ts` — `StashInfo`.
- `src/lib/tauri.ts` — three wrappers.
- `src/features/repo/useRepoStore.ts` — `stashSavePaths`, `stashRename`.
- `src/features/nav/useNavStore.ts` — `stash-diff` carries the full oid + index;
  new `stash-vs-wt`.
- `src/screens/CommitDiff.tsx` — the two stash targets.
- `src/design/context-menu.tsx` — `stashMenuItems` (Rename, the two compares),
  `multiFileMenuItems` (Stash selection).
- `src/screens/Branches.tsx` — pass oid/message/untracked into the menu; the
  detail pane's Diff button + a Rename button.
- `src/features/compare/compareSides.ts` + `.test.ts` — abbreviate a full-oid rev.
- `e2e/specs/stash.e2e.ts` — rename round trip (written, not run).
- `CLAUDE.md` — the spec list + the stash conventions worth pinning.

## Phases

### Phase 1 — `StashInfo` carries oid + untracked

**Task 1.1** — `types.rs`: add `oid: String` and `untracked: bool`.
**Task 1.2** — `libgit2.rs::stashes`: `stash_foreach` cannot call `find_commit`
(the repo is mutably borrowed), so collect `(index, oid, message)` in the
closure and resolve `parent_count()` in a second pass.
**Task 1.3** — `src/lib/types.ts` mirror.
**Verify:** `cargo test --test stash`, `pnpm tsc --noEmit`.

### Phase 2 — Piece (3): compare a stash properly

**Task 2.1** — trait + impl `stash_diff(repo_id, oid, context_lines,
ignore_whitespace, include_untracked)`. Resolve the oid to a commit
(`InvalidRef` on failure), diff `parent(0).tree()` → `commit.tree()`, then when
the flag is on and `parent_count() > 2` append
`diff_tree_to_tree(None, Some(parent(2).tree()))`. `CliBackend` stub.
**Task 2.2** — command + registration + TS type/wrapper.
**Task 2.3** — `tests/stash_diff.rs` (see the spec's list). The load-bearing one:
commit something AFTER the stash and assert it is absent from the diff.
**Task 2.4** — `NavIntent`: `stash-diff` carries `{ oid, index, untracked }`;
add `stash-vs-wt` with the same payload. `CommitDiff` fetches `stashDiff` and
`diffRefToWorkdir` respectively, with the right `syntaxSides`
(`{kind:"rev"}` → `{kind:"worktree"}` for the workdir target) and the two
notices.
**Task 2.5** — menu + Branches wiring; `compareSides.sideLabel` abbreviation.
**Task 2.6** — `CommitDiff.stash.test.tsx`.
**Verify:** `cargo test`, `pnpm test`, `pnpm tsc --noEmit`.

### Phase 3 — Piece (2): rename

**Task 3.1** — `git/stash.rs::stash_store_args(message, oid)` + unit tests
(`--` present, oid last, message after `-m`).
**Task 3.2** — `libgit2.rs::stash_rename` exactly as the spec's six steps,
including the verification that gates the drop.
**Task 3.3** — command + registration + wrapper + `useRepoStore.stashRename`
(`refreshAll` after, never a local list patch).
**Task 3.4** — `tests/stash_rename.rs`, including the **`stash@{0}` case** and
the injected-failure case.
**Task 3.5** — `stashMenuItems` Rename entry (`pgPrompt`, defaulted to the
current message) + a Rename button in the Branches detail pane.
**Verify:** `cargo test --test stash_rename`, `pnpm test`.

### Phase 4 — Piece (1): path-level partial stash

**Task 4.1** — `git/stash.rs::stash_push_args(opts, paths)` + unit tests.
**Task 4.2** — `run_git_capture_env` (env-carrying sibling; `run_git_capture`
delegates with `&[]`) and `stash_save_paths`, reading `refs/stash` before/after
to return `Option<String>`. Empty path list → `InvalidArgument`.
**Task 4.3** — command + registration + wrapper + `useRepoStore.stashSavePaths`.
**Task 4.4** — `multiFileMenuItems` entry: non-embedded paths, `pgPrompt` for the
message, `includeUntracked` derived from the untracked bucket.
**Task 4.5** — `tests/stash_partial.rs` + `context-menu.stash.test.tsx`.
**Verify:** full gate.

### Phase 5 — Docs + e2e spec

**Task 5.1** — `e2e/specs/stash.e2e.ts` rename round trip. **Not executed.**
**Task 5.2** — `CLAUDE.md`: spec list entry, the `StashInfo` oid-vs-index rule,
the `git stash store` no-op trap, and the deferred hunk-level note.
**Verify:** `pnpm exec tsc -p e2e/tsconfig.json --noEmit` + the full gate.

## Risks

- **The `stash store` elision.** The whole rename design turns on it. Pinned by
  a test that renames `stash@{0}` and asserts the count is unchanged — that test
  fails loudly against any implementation that reverts to storing the old oid.
- **Verification-before-drop.** The only step that can lose data. Its failure
  path must leave a duplicate, never a gap; tested by injecting a mismatch.
- **libgit2 reading refs a subprocess just wrote.** `refs/stash` is a loose ref
  and the existing shell-outs already re-read after mutating, so this follows
  the established pattern rather than a new one.
- **`StashInfo` gaining fields** touches every mocked stash list. They are all
  `[]` today; a grep before and after keeps that true.
