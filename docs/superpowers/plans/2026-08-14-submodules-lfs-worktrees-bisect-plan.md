# Submodules, LFS, worktrees, bisect — implementation plan

**Goal:** Land all four #93 subsystems complete rather than four half-built ones.
Submodules and worktrees get a screen each; LFS gets a Remote-screen panel plus
pointer-aware diffs; bisect gets real ops and takes over the operation bar for
`RepoState::Bisect`, which until now was a dead label with a harmful button.

**Architecture:** Four new `git/` modules (`submodule.rs`, `worktree.rs`, `lfs.rs`,
`bisect.rs`) holding the pure logic — status mapping, pointer parsing,
`.gitattributes` scanning, `BISECT_*` reading, `--bisect-vars` parsing, argument
builders — and 14 new `GitBackend` trait methods implemented in `Libgit2Backend`
(libgit2 where it works, sync `std::process::Command` where it does not, per the
design's table). Four new `commands/` files; three network ops
(`submodule_update`, `lfs_fetch`, `lfs_pull`) additionally get the
`net::run_git_authenticated` credential path, following fetch/pull/push.
Frontend: two screens with their own Zustand stores, an LFS panel and a shared
`LfsDiffNotice`, `bisectStatus` inside `useRepoStore` next to `rebaseStatus`, and a
`bisect` `OpKind` in `OperationBar`.

**Tech Stack:** Rust + git2 0.20 + real `git`/`git-lfs` subprocesses, React 18 +
Zustand, vitest/RTL, WebdriverIO e2e.

**Design doc:** `docs/superpowers/specs/2026-08-14-submodules-lfs-worktrees-bisect-design.md`
**Issue:** [#93](https://github.com/jonassaa/platypusgit/issues/93)

## Global Constraints

- Standard path for every new op: trait method (`git/mod.rs`) → `Libgit2Backend`
  impl → `CliBackend` `NotImplemented` stub → thin command in
  `commands/<area>.rs` → `invoke_handler![]` in `lib.rs` → `lib/types.ts` type +
  `lib/tauri.ts` wrapper → store wiring.
- Every git2 call from a command is wrapped in `tokio::task::spawn_blocking`.
- New `AppError` variants land in `error.rs` **and** `src/lib/errors.ts` in the same
  commit. Two only: `LfsUnavailable`, `NoBisect`.
- Never `window.confirm`/`window.prompt` — `pgConfirm`/`pgPrompt` from `@/design`;
  component tests that reach a dialog need `WithDialogs` from `@/test/dialog`.
- Frontend never calls `invoke()` directly.
- Every new list-row surface opts into UI density: `height: "calc(<base>px +
  var(--row-step))"` or padding-sized equivalent. Chrome (the operation bar) stays
  fixed.
- Every new pane owns its own scrolling (`FocusableScroll`) — the shell is a fixed
  frame and the document will not scroll for you.
- One `<PGPane primary>` per new screen.
- Never hardcode the accent hue — `var(--accent)` / `oklch(from var(--accent) …)`.
- Store error paths for danger ops refresh **before** setting `error`.
- Tests never touch the repository they run in: worktree fixtures build their own
  `TempRepo` and put the linked worktree in a sibling tempdir.
- `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before pnpm/cargo.
- **This pass does not run `pnpm test:e2e:docker`** (five agents compiling
  concurrently would OOM the 8GB Docker VM); CI's `e2e-linux` is the gate. Specs
  must still typecheck and be written conservatively.

## File Structure

**Create (backend):**
- `src-tauri/src/git/submodule.rs` — `SubmoduleState` mapping, `submodule_update_args`.
- `src-tauri/src/git/worktree.rs` — `WorktreeInfo` assembly helpers, `worktree_remove_args`.
- `src-tauri/src/git/lfs.rs` — pointer parsing, `.gitattributes` scan, `ls-files` parsing, arg builders.
- `src-tauri/src/git/bisect.rs` — `BISECT_*` readers, `--bisect-vars` parser, term handling.
- `src-tauri/src/commands/submodule.rs`, `worktree.rs`, `lfs.rs`, `bisect.rs`.
- `src-tauri/tests/submodules.rs`, `worktrees.rs`, `bisect.rs`, `lfs.rs`.

**Create (frontend):**
- `src/features/submodules/useSubmodulesStore.ts`
- `src/features/worktrees/useWorktreesStore.ts`
- `src/features/worktrees/WorktreeAddDialog.tsx`
- `src/features/lfs/useLfsStore.ts`, `LfsPanel.tsx`, `LfsDiffNotice.tsx`
- `src/screens/Submodules.tsx`, `src/screens/Worktrees.tsx`
- Tests: `src/screens/Submodules.test.tsx`, `src/screens/Worktrees.test.tsx`,
  `src/features/lfs/LfsPanel.test.tsx`, `src/features/lfs/lfsPointer.test.ts`,
  `src/features/repo/OperationBar.bisect.test.tsx`,
  `src/features/bisect/bisectCopy.test.ts`
- `e2e/specs/worktrees.e2e.ts`, `submodules.e2e.ts`, `bisect.e2e.ts`

**Modify (backend):** `git/mod.rs`, `git/types.rs`, `git/libgit2.rs`, `git/cli.rs`,
`error.rs`, `commands/mod.rs`, `lib.rs`.

**Modify (frontend):** `lib/types.ts`, `lib/errors.ts`, `lib/tauri.ts`,
`lib/derive.ts` (`isTextualDiff`), `features/repo/useRepoStore.ts`,
`features/repo/OperationBar.tsx`, `features/keymap/actions.ts`, `presets.ts`,
`features/palette/commands.ts`, `design/icons.tsx`, `design/git-components.tsx`,
`design/context-menu.tsx`, `AppShell.tsx`, `screens/Remote.tsx`,
`screens/RepoBrowser.tsx`, `screens/CommitPanel.tsx`, `screens/DiffViewer.tsx`,
`features/diff/CommitDiffPanel.tsx`, `CLAUDE.md`.

---

### Task 1: Types, errors, trait shape

- [ ] `error.rs`: `LfsUnavailable(String)`, `NoBisect`. `src/lib/errors.ts`: same
      two, same commit.
- [ ] `git/types.rs`: `SubmoduleState`, `SubmoduleInfo`, `WorktreeInfo`,
      `WorktreeBranch`, `LfsStatus`, `LfsFile`, `LfsPointer`, `LfsDiff`,
      `BisectMark`, `BisectStatus`; `FileStatus.submodule`; `FileDiff.lfs`.
- [ ] `git/mod.rs`: 14 trait methods with doc comments naming the impl choice.
- [ ] `git/cli.rs`: 14 `NotImplemented` stubs.
- [ ] `cargo check` clean with `todo!()` bodies in `libgit2.rs`? No — implement per
      task below; this task ends at a compiling trait + stubs.

### Task 2: Submodules (backend)

- [ ] `git/submodule.rs`: `state_from_status(SubmoduleStatus) -> SubmoduleState`
      (pure, ordered uninitialized → out-of-sync → modified → up-to-date),
      `submodule_paths(&Repository) -> HashSet<String>` (empty and cheap when
      `.gitmodules` is absent), `submodule_update_args(path, recursive, init)`.
- [ ] `libgit2.rs`: `submodules`, `submodule_init`, `submodule_sync`,
      `submodule_update` (shell-out, prompt-less env, failures through
      `net::map_git_failure`).
- [ ] `status` / `list_all_files`: fill `FileStatus.submodule` from the per-listing
      path set. Assert `embedded` is unchanged for a registered submodule.
- [ ] `commands/submodule.rs`: `list_submodules`, `submodule_init`,
      `submodule_sync`, `submodule_update` (the last takes
      `credentials: Option<Credentials>` and uses `run_git_authenticated` when
      present, the trait method when not — one shared arg builder).
- [ ] `tests/submodules.rs` + a `TempRepo` fixture helper `with_submodule()`.

### Task 3: Worktrees (backend)

- [ ] `git/worktree.rs`: `worktree_remove_args(path, force)`, lock-status mapping,
      branch/head read via `Repository::open_from_worktree`.
- [ ] `libgit2.rs`: `worktrees`, `worktree_add`, `worktree_remove` (shell-out; map
      git's "contains modified or untracked files" refusal to `DirtyWorktree`),
      `worktree_lock`, `worktree_unlock`, `worktree_prune`.
- [ ] `commands/worktree.rs`: six thin commands.
- [ ] `tests/worktrees.rs` — sibling tempdirs only.

### Task 4: LFS (backend)

- [ ] `git/lfs.rs`: `parse_pointer(&str) -> Option<LfsPointer>`,
      `lfs_diff_of(&FileDiff) -> Option<LfsDiff>` (pure, over the diff's own
      lines), `patterns_from_attributes(&str) -> Vec<String>`, `lfs_available()`,
      `parse_ls_files(&str) -> Vec<LfsFile>`, `lfs_fetch_args`/`lfs_pull_args`.
- [ ] `libgit2.rs`: `lfs_status`, `lfs_checkout`; annotate `FileDiff.lfs` in
      `diff`, `diff_commit`, `diff_commits` through one shared helper.
- [ ] `commands/lfs.rs`: `lfs_status`, `lfs_checkout`, `lfs_fetch`, `lfs_pull`
      (the last two credentialed).
- [ ] `tests/lfs.rs` — pure parsers always; binary-dependent cases conditional.

### Task 5: Bisect (backend)

- [ ] `git/bisect.rs`: `bisect_in_progress(&Repository)`, `terms(&Repository)`,
      `parse_bisect_vars(&str)`, `count_refs`, `start_ref`.
- [ ] `libgit2.rs`: `bisect_status`, `bisect_start`, `bisect_mark`, `bisect_reset`,
      all via `git bisect …` with `GIT_TERMINAL_PROMPT=0` and null stdin;
      `NoBisect` when a mark/reset finds no bisect.
- [ ] `commands/bisect.rs`: four thin commands.
- [ ] `tests/bisect.rs` — including the fresh-backend restart case.

### Task 6: Register + IPC surface

- [ ] `commands/mod.rs` + `lib.rs` `invoke_handler![]`: 18 new command names.
- [ ] `lib/types.ts` mirrors; `lib/tauri.ts` wrappers.
- [ ] `cargo test` green, `pnpm tsc --noEmit` green.

### Task 7: Submodules screen

- [ ] `useSubmodulesStore` (list + init/update/sync + `recursive` persisted toggle).
- [ ] `PGSubmoduleRow` in `design/git-components.tsx` (density-aware), `submodule`
      icon, `submoduleMenuItems` in `design/context-menu.tsx`.
- [ ] `screens/Submodules.tsx`, activity-bar item, `nav.submodules` action on
      `Mod+Shift+6` in both presets (`Mod+Shift+8` went to #92's `nav.pulls`),
      palette nav row + action commands.
- [ ] `RepoBrowser` / `CommitPanel`: submodule rows use `submoduleMenuItems` and
      show the submodule glyph.
- [ ] `Submodules.test.tsx`.

### Task 8: Worktrees screen

- [ ] `useWorktreesStore`, `WorktreeAddDialog` (folder picker + branch mode),
      `PGWorktreeRow`, `worktree` icon, `worktreeMenuItems`.
- [ ] `screens/Worktrees.tsx`, activity-bar item, `nav.worktrees` on `Mod+Shift+7`
      in both presets, palette rows.
- [ ] Remove flow: `pgConfirm` → on `DirtyWorktree`, second `requireText` confirm →
      force.
- [ ] `Worktrees.test.tsx`.

### Task 9: LFS panel + pointer diffs

- [ ] `useLfsStore`, `LfsPanel` on the Remote screen, `LfsDiffNotice`.
- [ ] `lib/derive.ts`: `isTextualDiff`. Wire it (and the notice) at all four diff
      surfaces so pointer text can never render as a text diff.
- [ ] `LfsPanel.test.tsx`, `lfsPointer.test.ts`.

### Task 10: Bisect UI

- [ ] `useRepoStore`: `bisectStatus` + `bisectStart/bisectMark/bisectReset`,
      refreshed in `refreshAll` and `refreshStatus`.
- [ ] `OperationBar`: `bisect` `OpKind` — Good/Bad/Skip/**Reset** (never the generic
      Abort), progress detail, converged copy.
- [ ] `commitMenuItems` / `commitMultiMenuItems` bisect entries; palette commands.
- [ ] `OperationBar.bisect.test.tsx`, `bisectCopy.test.ts`.

### Task 11: E2E + docs + verification

- [ ] `e2e/specs/worktrees.e2e.ts`, `submodules.e2e.ts`, `bisect.e2e.ts`; fixtures
      `submoduleRepo()`, `worktreeRepo()`, `bisectRepo()` in `e2e/support/tempRepo.ts`.
- [ ] `CLAUDE.md`: new backend modules, new commands, new screens, the two new
      `AppError` variants, the bisect state-of-record decision, `RepoState::Bisect`
      no longer being a dead label.
- [ ] `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`,
      `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Squash to one Conventional Commit, push, open the PR against #93 (do not
      close it — the orchestrator does).
