# Conflict flow — implementation plan

**Goal:** Conflicts stop being a place you navigate to and become a state the app announces. An operation bar driven by `repoState` says what is in progress and offers the way out; the Conflicts tab and screen are deleted; the merge resolver window grows the conflicted-file list that screen was standing in for.

**Architecture:** Almost all frontend. No new `GitBackend` methods, no new commands, no IPC change — `repo_state`, `conflict_sides`, `accept_ours/theirs`, `mark_resolved`, `restart_conflict`, `save_resolution`, `abort/continue_operation` all exist. The bar is a new `features/repo/OperationBar.tsx` rendered by `AppShell`; the resolver window gains a sidebar in `features/merge/`; `screens/Conflict.tsx` and `PGConflictRow` are deleted. The one backend change (Task 0) makes `continue_operation`/`abort_operation` correct for a rebase git owns on disk — the bar puts those two buttons on every screen, so they cannot stay wrong.

**Tech Stack:** React 18 + Zustand, Tauri 2 multi-window, vitest/RTL, WebdriverIO e2e in Docker.

**Design doc:** `docs/superpowers/specs/2026-08-14-conflict-flow-design.md`
**Issue:** [#108](https://github.com/jonassaa/platypusgit/issues/108)

## Global Constraints

- Never `window.confirm`/`window.prompt` — `pgConfirm`/`pgPrompt` from `@/design`. Component tests that render a dialog-using screen need `WithDialogs` from `@/test/dialog`.
- Frontend never calls `invoke()` directly — typed wrappers in `src/lib/tauri.ts`.
- The merge window has its own store instance with **no open repo**: every `useRepoStore` git action starts `const repo = get().current; if (!repo) return;` and silently no-ops there. Merge-window code works from `?repoId=` and direct IPC wrappers only.
- New list-row surfaces opt into UI density: `height: "calc(<base>px + var(--row-step))"`. Chrome (the operation bar) stays fixed.
- Never hardcode the accent hue — `var(--accent)` or `oklch(from var(--accent) …)`.
- Danger-op error paths in the store refresh **before** setting `error`.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- E2E only via `pnpm test:e2e:docker`, and only the touched specs.

## File Structure

**Create:**
- `src/features/repo/OperationBar.tsx` — the bar: copy derivation + Resolve/Continue/Finalize/Abort.
- `src/features/repo/OperationBar.test.tsx`
- `src/features/merge/FileList.tsx` — resolver sidebar (rows + `mergeFileMenuItems`).
- `src/features/merge/MergeWindow.filelist.test.tsx`

**Modify:**
- `src/lib/derive.ts` — `isConflicted`.
- `src/AppShell.tsx` — drop the `conflict` screen/tab, whitelist the restored screen, render the bar, clickable status-bar conflict count.
- `src/features/keymap/actions.ts`, `presets.ts` — `nav.conflict` → `conflict.openResolver` on `Mod+5`.
- `src/features/palette/commands.ts` — drop the nav row, add the conditional command.
- `src/design/context-menu.tsx` — `fileMenuItems({ conflicted })` delegates to `conflictMenuItems`.
- `src/screens/RepoBrowser.tsx`, `src/screens/CommitPanel.tsx` — pass `conflicted`.
- `src/screens/Rebase.tsx` — banner copy stops pointing at the deleted screen.
- `src/design/git-components.tsx` — delete `PGConflictRow` + props.
- `src/features/merge/openMergeWindow.ts` — optional `path`.
- `src/features/merge/MergeWindow.tsx` — sidebar, file state, guarded file switching.
- `src/AppShell.screens.test.tsx` — restore list + stale-value case.
- `e2e/specs/merge-conflict.e2e.ts`, `e2e/specs/merge-window.e2e.ts`.

**Delete:**
- `src/screens/Conflict.tsx`, `src/screens/Conflict.launcher.test.tsx`.

---

### Task 0: `continue`/`abort` for a rebase git owns (see design §D)

- [x] `src-tauri/tests/cli_rebase.rs`: a two-commit rebase that conflicts on the
      first. Continue must land the queued second commit and leave HEAD on the
      branch; abort must restore the branch tip. Both fail pre-fix.
- [x] `libgit2.rs`: `cli_rebase_in_progress` + `run_rebase_flag`, used by
      `abort_operation` and `continue_operation`; hoist the latter's conflict
      pre-check above the branch.
- [x] `useRepoStore.continueOperation`: refresh before setting the error.

### Task 1: `isConflicted` in `lib/derive.ts`

Six copies of `s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted"` exist; every following task needs it again.

- [x] Add `export function isConflicted(s: FileStatus): boolean` beside `isStaged`/`isUnstaged`.
- [x] Replace the inline test in `AppShell.tsx` (status bar), `RepoBrowser.tsx` (filter + count), `MergeWindow.tsx` (local `isConflicted`), leaving `Conflict.tsx` alone — it is deleted in Task 3.
- [x] `pnpm test` + `pnpm tsc --noEmit` — pure refactor, nothing should change.

### Task 2: Operation bar

- [x] Write `OperationBar.test.tsx` first: `Merge` + 2 conflicts renders the count and a **Resolve conflicts** button; `Merge` + 0 renders **Finalize** and calls `continueOperation`; `RebaseInteractive` + live `rebaseStatus` renders "step 2 of 7" and **Continue**; `Clean` renders nothing; Abort confirms before calling `abortOperation` (needs `WithDialogs`).
- [x] Implement `OperationBar.tsx`: `operationLabel(repoState)`, `detail` from `isConflicted` count, head name from `currentBranch(branches)`. Buttons `data-testid="operation-resolve" | "operation-continue" | "operation-abort"`. Resolve calls `openMergeWindow(repoId)` with no path. Fixed-height chrome, `--git-conflict` tinted when conflicts remain, `--accent` when ready to finalize.
- [x] Render in `AppShell` between the error banner and `AppBody`, gated on `repo && repoState !== "Clean"`.

### Task 3: Delete the Conflicts screen and tab

- [x] `AppShell.tsx`: drop `"conflict"` from `ScreenId`, `ACTIVITY_ACTION`, `ACTIVITY_ITEMS`, the screens map and the import. Replace the deep-view blacklist in the `pg-screen` restore with a whitelist over the activity ids + `settings`, so a stale `"conflict"` falls back to `"repo"`. Give the status-bar conflict item an `onClick` that opens the resolver.
- [x] `actions.ts`: remove `nav.conflict`; add `conflict.openResolver` (category `Repository`, `scope: "global"`) — opens the resolver when conflicts exist, `pgFlash("No conflicts to resolve")` otherwise. `presets.ts`: `Mod+5` → the new id in both presets.
- [x] `commands.ts`: drop the `conflict` `SCREENS` row; add a **Resolve conflicts…** command with `actionId: "conflict.openResolver"`, listed only when conflicts exist, next to the continue/abort pair.
- [x] Delete `screens/Conflict.tsx` + `Conflict.launcher.test.tsx`; delete `PGConflictRow`/`PGConflictRowProps`.
- [x] `Rebase.tsx`: conflict-pause copy points at the bar, not the deleted screen.
- [x] `AppShell.screens.test.tsx`: drop `"conflict"` from `SCREENS`; add a case asserting a stale `pg-screen === "conflict"` restores `"repo"` with the shell mounted.
- [x] `pnpm tsc --noEmit` must be clean — it is what proves no reference survives.

### Task 4: Conflicted files get a resolve path in the Files/Commit screens

- [x] Extend `fileMenuItems` with `conflicted?: boolean`; when set, return `conflictMenuItems({ path })` (before the `embedded` branch — a conflicted file is not an embedded repo).
- [x] Pass `conflicted: !!st && isConflicted(st)` from `RepoBrowser.tsx:532` and `conflicted: !!f && isConflicted(f.status)` from `CommitPanel.tsx:167`.
- [x] Component test: right-clicking a conflicted row in `RepoBrowser` offers "Open merge editor".

### Task 5: Resolver window file list

- [x] `openMergeWindow(repoId, path?)`: omit `&path=` when absent; title falls back to `Resolve conflicts` until a file is selected.
- [x] `MergeWindow.filelist.test.tsx` first: with two conflicted files the sidebar lists both; clicking the second loads its sides; a file resolved in-session stays listed, dimmed, with a check; switching away from a touched file confirms first.
- [x] `FileList.tsx`: `usePaneWidth(260, { storageKey: "pg-merge-list-w" })`, `PGSectionHeader`, rows (`data-testid="merge-file-row"`, `data-path`, `data-resolved`) with `fileIconSpec` glyph, basename + dimmed dir, state glyph, density-aware height. `mergeFileMenuItems({ repoId, path, onResolved })` built on the IPC wrappers — never `useRepoStore`.
- [x] `MergeWindow.tsx`: hold `files` (conflicted from `getStatus` ∪ session-resolved) and `resolvedPaths`; derive `remaining` from it; auto-select the first unresolved file when opened without a path; route file switches through a guarded `requestSwitchTo` reusing `requestClose`'s touched check; refresh the list in `advance()` and after a sidebar menu action.

### Task 6: E2E + full verification

- [x] `merge-conflict.e2e.ts`: `startConflictedMerge` waits for `[data-testid="operation-bar"]`; accept-ours/accept-theirs drive the Files-screen conflicted context menu, then `operation-finalize`; abort drives `operation-abort`; post-op assertion waits for the bar to disappear. Keep every repo-truth assertion.
- [x] `merge-window.e2e.ts`: launch via `operation-resolve`, finalize via `operation-finalize`, and assert the sidebar lists both files in the two-file fixture.
- [x] `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, `pnpm tsc --noEmit`, `pnpm test`, `pnpm vite build`.
- [x] `pnpm test:e2e:docker build`, then `run --spec e2e/specs/merge-conflict.e2e.ts --spec e2e/specs/merge-window.e2e.ts`.
- [x] Squash to one Conventional Commit, push, open the PR against #108.
