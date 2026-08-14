# Conflict flow: operation bar, no Conflicts tab, resolver owns the file list

**Issue:** [#108](https://github.com/jonassaa/platypusgit/issues/108)

## Problem

Conflict resolution is discoverable only through a permanent activity-bar tab that is empty 99% of the time, and the app never says a merge or rebase is in progress. `repoState` — the one piece of state that knows — is read by `screens/Conflict.tsx` and one palette gate, nothing else.

Three concrete failures:

1. **The tab is dead weight, and duplicates the resolver window worse than the resolver does.** Its 3-column pane is read-only; its rows carry placeholder metadata (`resolved={false} hunkCount={1} additions={0} deletions={0}`) with `const resolved = 0` hardcoded, so the progress bar never moves. Its real job is launching the resolver window. With all files resolved but the merge still open, its header reads "No merge in progress" above an uppercase "Merging in progress".
2. **No mid-operation indicator.** The only feedback after a conflicting merge is the generic dismissible error banner (`ConflictsDetected: …`) with no CTA. Reopen the app mid-conflict and the UI looks normal. A conflicted file in the Files screen has no conflict-specific context menu — `fileMenuItems` is conflict-blind.
3. **The resolver window has no file list.** It already walks files (`findNextConflict`, `advance()`, "N files remaining") but you cannot see the set, choose an order, skip a file, or tell what is done.

## Design

### A. Operation bar (`features/repo/OperationBar.tsx`)

A bar between the error banner and the screen body, rendered when `repo && repoState !== "Clean"`. Driven by `repoState`, which is on-disk truth (`git2::Repository::state()`), so it survives banner dismissal, screen switches and restarts — the error banner cannot do any of that.

| `repoState` | Conflicts | Reads | Actions |
| --- | --- | --- | --- |
| `Merge` | 2 | "Merge in progress on `main` — 2 conflicts to resolve" | **Resolve conflicts** · Abort |
| `Merge` | 0 | "Merge in progress on `main` — no conflicts left" | **Finalize** · Abort |
| `Rebase*` | 1 | "Rebase in progress — 1 conflict to resolve" (+ "step 2 of 7" when an interactive session is live) | **Resolve conflicts** · Abort |
| `Rebase*` | 0 | "Rebase in progress — no conflicts left" | **Continue** · Abort |
| `CherryPick*` / `Revert*` | any | same shape | same |
| `Bisect`, `ApplyMailbox*` | any | label only | Abort |
| `Clean` | — | not rendered | — |

One primary button, never two: while anything is conflicted it is **Resolve
conflicts**, and only once nothing is does the finish verb appear. Offering
Continue next to Resolve would be offering a click that `continue_operation`
rejects by design (it refuses while conflicts remain).

Deliberate limits, both to keep the change frontend-only:

- **No source branch in the copy.** "Merging `feature/x` into `main`" would need a new backend op to read `MERGE_HEAD`. The bar names the operation and the current branch, which are already in the store.
- **Unresolved count only, never "3 of 5".** A resolved file becomes an ordinary staged entry, indistinguishable from other staged work, so the original conflict total is not recoverable from `status`. Tracking it in the store would be session state that a restart invalidates.
- **Rebase step counts only when `rebaseStatus.inProgress`.** `rebase_status` reads an in-process `HashMap` populated by the interactive `rebase_start` flow, so it is empty for `rebase_onto` and after a restart. `repoState` drives the bar; step counts are additive detail when they happen to exist.

Continue/Abort call `useRepoStore.continueOperation()` / `abortOperation()`, which already dispatch to `rebaseContinue`/`rebaseAbort` when an interactive rebase is live. Abort keeps the existing `pgConfirm` gate. **Finalize** and **Continue** are the same action (`continueOperation`) under two labels: "Finalize" when no conflicts remain and the operation is a merge/cherry-pick/revert, "Continue" for a rebase, which has more steps ahead of it.

### B. The Conflicts tab goes away

Delete `screens/Conflict.tsx`, the `conflict` `ScreenId`, the activity-bar item, `nav.conflict`, and the palette nav row. `PGConflictRow` + `PGConflictRowProps` go too — the deletion is what makes them dead.

`Mod+5` rebinds to a new `conflict.openResolver` action ("Resolve conflicts") in both presets, which opens the resolver window when conflicts exist and flashes otherwise. The palette gains a **Resolve conflicts…** command listed only when conflicts exist, alongside the existing continue/abort pair.

Compensating discoverability, now that no screen is dedicated to conflicts:

- `fileMenuItems` takes `conflicted` and delegates to `conflictMenuItems` for a conflicted file, so the Files and Commit screens can resolve, accept a side, run the mergetool, mark resolved or restart from the row itself.
- The status-bar conflict count becomes clickable (`PGStatusItem` already accepts `onClick`) and opens the resolver.
- `RepoBrowser`'s "Conflicts (n)" filter chip stays as-is.

A stale `localStorage["pg-screen"] === "conflict"` from an older build must not render `screens["conflict"]` — `undefined`. The restore guard becomes a whitelist check against the known screen ids rather than a deep-view blacklist.

The duplicated `s.worktree.kind === "Conflicted" || s.index.kind === "Conflicted"` test (six copies across `AppShell`, `Conflict`, `RepoBrowser`, `MergeWindow`) collapses into `isConflicted` in `lib/derive.ts`.

### C. The resolver window owns the file list

A resizable sidebar in the `merge` window listing every conflicted file, Rider-style: compact rows with the file-type glyph from `fileIconSpec`, basename plus dimmed directory, and a state glyph — conflict marker while unresolved, check once applied in this session.

- **List contents:** conflicted paths from `getStatus` **union** the session's already-resolved paths, so the list does not shrink out from under the user as they work. Rows sort by path; resolved rows dim rather than disappear.
- **`openMergeWindow(repoId, path?)`** — path becomes optional. No path means "open on the list", which is what the operation bar's CTA and `conflict.openResolver` use; the window then auto-selects the first unresolved file so the common case still lands straight in the editor.
- **Switching files** goes through the same unapplied-progress check `requestClose` uses, upgrading the known "retarget silently drops in-editor work" limitation (`MergeWindow.tsx:96-100`) into a `pgConfirm`.
- **Row context menu** cannot reuse `conflictMenuItems`: that menu calls `useRepoStore` actions, and every one of them starts with `const repo = get().current; if (!repo) return;`. The merge window is a separate Tauri window whose store instance has no open repo — it works from `?repoId=` and direct IPC. So the sidebar gets `mergeFileMenuItems`, built on the same IPC wrappers `MergeWindow` already imports (`acceptOurs`, `acceptTheirs`, `markResolved`, `restartConflict`, `openInEditor`).
- **Finalizing stays in the main window.** Apply resolves the file, advances to the next unresolved one, and closes the window after the last — at which point the main window's bar reads "no conflicts left" with **Finalize**. The resolver does per-file work; the repo-level verb lives where the repo lives.

### D. Continue and abort for a rebase git owns (backend)

Found while wiring the bar, and not optional once its buttons are on every
screen: `merge_branch` and `rebase_onto` **shell out to real git**
(`commands/branches.rs`), so a conflicting rebase leaves git's own
`.git/rebase-merge` state and `repoState` reports `Rebase*`. For that state both
generic paths in `Libgit2Backend` are wrong:

- `continue_operation` commits the resolved tree and calls `cleanup_state()`,
  which **abandons every step still queued** in the rebase.
- `abort_operation` hard-resets to HEAD, which mid-rebase is wherever the rebase
  stopped — leaving the user **detached at a half-rebased position** instead of
  back on their branch.

Both now detect that case and hand off to `git rebase --continue` / `--abort`
with `GIT_EDITOR=true` so git cannot block on an editor. `continue_operation`'s
conflict pre-check moved above the branch, so both paths still refuse with
`ConflictsDetected`. No trait or IPC change, so the frontend is unaffected.

`cli_rebase_in_progress` excludes the app's own rebase through #110's
`rebase_in_progress`, which covers the in-memory plan **and** the rehydratable
`.git/platypusgit-rebase.json`. Checking only the `rebases` HashMap would read
one of our own rebases as git's after a restart and hand `git rebase --abort` a
repository git sees no rebase in; #110's `a_restarted_app_can_still_abort` /
`…_continue` (fresh `Libgit2Backend`, state file on disk) are the tests that
hold that line. With ours ruled out, `repo_state` cannot be returning #110's
override either, so what remains is libgit2's own read of git's `rebase-*` dirs.
The three branches run in order: ours, then git's, then the generic path.

`src-tauri/tests/cli_rebase.rs` pins it with a two-commit rebase that conflicts
on the first: continue must land the second commit and leave HEAD on the branch;
abort must restore the branch tip. Both tests fail on the pre-fix code (verified
by disabling the detection), which is the point of writing them.

Merge state needs no equivalent: libgit2's commit-with-two-parents and
reset-plus-cleanup match `git commit`/`git merge --abort` semantics. A
cherry-pick or revert **sequence** a user started in a terminal is still handled
by the generic path only — out of scope, and it is not a state the app creates.

`useRepoStore.continueOperation`'s catch arm also now refreshes before setting
the error, per the store convention: a `--continue` that stops on the *next*
conflict fails with the repository already moved on, so the bar must re-read
disk.

## Testing

- **Rust:** `cli_rebase.rs` — the section D hand-off, asserted against repo truth.
- **Component:** `OperationBar.test.tsx` (per-state copy and button wiring, including the rebase-dispatch and abort-confirm paths), `MergeWindow.filelist.test.tsx` (list contents, selection switches file, resolved marking, dirty-switch confirm), a `RepoBrowser` case for the conflicted row's menu. `AppShell.screens.test.tsx` drops `"conflict"` from its restore list and gains a stale-value fallback case. `Conflict.launcher.test.tsx` is deleted with its screen.
- **E2E:** `merge-conflict.e2e.ts` drives the operation bar instead of `switchScreen("conflict")`; the accept-ours/accept-theirs tests move to the Files-screen conflicted context menu (which also covers B). `merge-window.e2e.ts` finalizes through the bar and gains a sidebar-navigation assertion.

## Out of scope

The merge model and 3-pane editor internals. Mergetool configuration. Syntax highlighting in the resolver panes (#104 PR2). Automatic resolution strategies. The Rebase screen's plan UI, which keeps its own banner for non-conflict pauses (its copy is corrected to stop pointing at the deleted screen). Reading `MERGE_HEAD` for richer copy.
