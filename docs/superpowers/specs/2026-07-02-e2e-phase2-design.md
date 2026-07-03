# End-to-End Testing (Phase 2: danger ops) — Design

Status: approved 2026-07-02

## Problem

Phase 1 (`2026-07-02-e2e-testing-design.md`, merged as #26) covers the read
path and routine write path. The operations most likely to destroy user work —
merge conflicts, rebase, reset, cherry-pick/revert, reflog jumps — have no
webview-level coverage. These flows are also the most dialog- and
state-machine-heavy screens in the app (Conflict, Rebase, Reflog), so wiring
regressions there are both likelier and costlier.

Investigation also surfaced an app defect: `mergeBranch` and `rebaseOnto` in
`useRepoStore` set the error banner on failure but skip `refreshAll()`, so a
conflicted merge leaves the Conflicts screen, status-bar badge, and
`repoState` stale until something else refreshes. The UI lies about disk
state. Phase 2 fixes this (approach B, approved): the error path still
refreshes, making the in-app conflict flow both correct for users and
testable.

## Goals

- Cover the six danger-op areas: merge (clean + conflict + abort), conflict
  resolution (ours/theirs/mark-resolved/finalize), interactive rebase
  (execute + abort), reset (soft/hard), cherry-pick + revert, reflog jumps
  (detached checkout + dirty-tree dialog).
- Drive real user flows in-app wherever practical; seed repo state via git
  CLI fixtures only where in-app driving is impractical (rebase-conflict
  setup, dirty trees).
- Land the `refreshAll`-on-error fix with the tests that prove it.
- Pay down Phase 1 ride-alongs first so new specs build on clean helpers.

## Non-goals

- Auto-switching to the Conflicts screen when a conflict appears (UX feature,
  separate spec if wanted).
- Remote ops, command palette coverage, settings persistence (Phase 3).
- `run_mergetool` (spawns external tool — not driveable headlessly) and
  `restart_conflict` coverage.
- Multi-stash UI flows (attribute added now; specs later when needed).
- Rebase plan reordering/reword editor coverage beyond the squash flow.

## Task 0: cleanups (from Phase 1 final review, controller-triaged RIDE)

- Promote `jsContextMenu` from `e2e/specs/status-stage.e2e.ts` to
  `e2e/support/app.ts`, extended with submenu support: the commit-menu reset
  submenu opens on parent-item hover (`context-menu.tsx:57-67`), so the
  helper gains an optional submenu step (dispatch `mouseenter` on the parent
  item, wait for submenu, click the child by text).
- Move the duplicated `changeRow`/`stagedRow` selector factories
  (3 copies across specs) into `e2e/support/app.ts`.
- Add `data-stash-index` to the Branches-screen stash row.
- Align `@types/node` to `^22`.

## App changes

1. **Fix (behavior):** in `src/features/repo/useRepoStore.ts`, the `catch`
   arms of `mergeBranch` and `rebaseOnto` call `refreshAll()` after setting
   `error`, so status/`repoState`/conflict rows reflect disk truth
   immediately after a failed merge/rebase.
2. **Test attributes (inert):**
   - `PGConflictRow` (`git-components.tsx`): `data-testid="conflict-row"` +
     `data-path`.
   - Conflict screen buttons: `conflict-abort`, `conflict-finalize`,
     `accept-ours`, `accept-theirs`, `mark-resolved`.
   - Rebase screen: `rebase-row` + `data-sha` on `PGRebaseRow`;
     `rebase-start`, `rebase-continue`, `rebase-abort` buttons.
   - History `CommitActionRow`: `commit-cherry-pick`, `commit-revert`.
   - Branches stash row: `data-stash-index`.
   - Reflog dialogs need nothing: `role="dialog"` + unique button text.
3. **Fix (behavior, discovered-by-test, user-approved scope addition):** in
   `src-tauri/src/git/libgit2.rs`, `rebase_abort` only hard-reset to
   *current* HEAD, which `rebase_start`/`advance_rebase` had already moved
   forward — so aborting a conflicted rebase left the branch mid-rebase
   instead of restoring its original tip. `RebaseState` now tracks the
   pre-rebase tip in `orig_head` and `rebase_abort` restores it (mirrors
   `git rebase --abort` restoring `ORIG_HEAD`). Tightened
   `rebase_abort_resets_to_pre_rebase_head` in `src-tauri/tests/rebase.rs`
   to assert the restore instead of just documenting the gap.

## Fixtures (added to `e2e/support/tempRepo.ts`)

- `conflictRepo()` — `main` and branch `clash` edit the same lines of
  `conflict.txt`; merging `clash` into `main` conflicts. Used for in-app
  conflicted merge, resolution flows, and abort.
- `cherryRepo()` — unmerged branch `feature` with one distinct commit
  (unique file + message) on top of shared history; `main` checked out.
  Cherry-pick source; also serves revert/reset tests via its `main` commits.
- `rebaseConflictRepo()` — 4 linear commits editing the same lines of
  `conflict.txt`, dropping the middle one so the trailing pick conflicts on
  replay. Needs 4 commits, not 3: `rebase_start` resets HEAD to the parent of
  the first surviving (non-Drop) plan step, so a plan that only drops the
  *older* of two commits always resets straight to the real parent of the
  surviving pick — conflict-free by construction. The dropped commit must sit
  strictly between two surviving picks for the second pick's cherry-pick to
  actually diverge.
- Dirty trees made inline via the existing `write()` helper.

## Test cases (4 new spec files, ~13 tests)

`merge-conflict.e2e.ts` (conflictRepo unless noted):
1. Clean merge (cherryRepo — `feature` merges cleanly): Branches screen →
   "Merge into current" (confirm stubbed) → `main` has no divergent history
   from `feature`, so `git merge` fast-forwards (no merge commit); assert new
   HEAD subject matches feature's tip commit and the tree is clean.
2. Conflicted merge in-app: error banner (`role="alert"`) appears AND
   status-bar conflict badge + Conflicts screen row appear without manual
   refresh (proves the fix).
3. Resolve via accept-ours → mark resolved → Finalize → merge commit exists,
   `repoState` clean, `conflict.txt` content = ours (disk truth).
4. Accept-theirs variant → content = theirs.
5. Abort mid-merge → `MERGE_HEAD` gone, tree matches pre-merge (git truth).

`rebase.e2e.ts`:
6. Squash-into-parent from History commit context menu (prompt stubbed for
   message) → Rebase screen shows plan → Start → `rev-list --count` drops by
   one, squashed message correct.
7. Rebase that conflicts (fixture): Start → banner shows conflict pause →
   Abort → HEAD/branch restored to pre-rebase oid.

`history-ops.e2e.ts` (cherryRepo):
8. Reset soft to parent via commit context submenu → HEAD moved (git truth),
   former commit's changes staged.
9. Reset hard to parent → HEAD moved, tree clean.
10. Cherry-pick feature's commit via detail-panel button (confirm stubbed) →
    commit with same message on `main`, file present.
    **Blocked:** backend log is HEAD-only, no UI surface shows unmerged-ref
    commits; test lands as `it.skip`; see issue #27. Unskip when ref-scoped
    log ships.
11. Revert HEAD → revert commit at top, file content restored.

`reflog.e2e.ts` (basicRepo):
12. Reflog screen lists entries; select entry → "Go to this point" →
    ReflogActionDialog → "Check out (detached)" → Go → branch chip shows
    `(detached)`, `git symbolic-ref` fails (detached confirmed).
13. Dirty tree + jump → DirtyTreeDialog appears → "Stash them (auto-named)"
    → jump succeeds AND `git stash list` non-empty.

Numbering note: test 1 lives in `merge-conflict.e2e.ts` but uses a
non-conflicting fixture.

## Conventions (unchanged from Phase 1)

Repo truth as acceptance, UI as wait condition; `stubNativeDialogs` for
`window.prompt`/`confirm` (heavily used: merge confirm, squash message,
cherry-pick/revert confirms); tag-scoped text selectors; `button*=`;
timeout+timeoutMsg everywhere; no `pause()`; spec-only iterations via
`pnpm test:e2e:run`, any src/ change requires full `pnpm test:e2e`.

## Workflow

Branch `test/e2e-phase2`; small Conventional Commits; squash to one commit
before merge; PR with CI green (e2e.yml already runs on PRs + main pushes).

## Risks

- Submenu-hover helper is new ground. Fallback: palette `action:reset` path
  (deterministic nested pick, no native dialog).
- Rebase screen uses a native `<select>` per plan row — WDIO
  `selectByVisibleText` handles it; if the embedded driver balks, in-page
  value-set + change-event dispatch is the fallback.
- In-app conflicted merge depends on the store fix landing first — ordering
  constraint the plan must respect.
- `PGCommitRow` testid collides between History and Reflog screens — scope
  selectors to the active screen container.
