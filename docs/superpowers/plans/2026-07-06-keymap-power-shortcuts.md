# Keymap Power Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the missing-but-expected shortcuts from the 2026-07 review: list speed-search, commit-screen chords, stage/unstage-all, new-branch, ⌃V palette, F7 diff-hunk navigation.

**Architecture:** Everything extends the existing keymap system (`src/features/keymap/`): new catalog actions + preset bindings; component-registered handlers where state is component-local (CommitPanel); default runners in `ops.ts`/catalog where state is store-global; one new dispatcher fallback (speed-search) with its own tiny store. No backend changes.

**Tech Stack:** React 18 + Zustand + Tailwind v4; vitest (jsdom) unit tests; WebdriverIO e2e (`e2e/specs/keymap.e2e.ts`).

## Global Constraints

- Chords per spec `2026-07-06-keymap-power-shortcuts-design.md` — no `Mod+Alt+letter` (AltGr), `Ctrl+V` in rider preset only.
- Both presets bind every new action (preset completeness test enforces).
- TDD: failing test before implementation, every task.
- `pnpm test`, `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, full `pnpm test:e2e` green before each commit that touches `src/`.

---

### Task 1: Commit-screen chords + stage/unstage-all + new-branch + ⌃V

**Files:**
- Modify: `src/features/keymap/actions.ts` (new ActionIds: `commit.commit`, `commit.commitAndPush`, `commit.toggleAmend`, `repo.stageAll`, `repo.unstageAll`, `branch.createNew`)
- Modify: `src/features/keymap/presets.ts` (bindings both presets; `Ctrl+V` on rider `palette.open`)
- Modify: `src/features/repo/ops.ts` (`stageAllOp`, `unstageAllOp`)
- Modify: `src/features/palette/commands.ts` (extract + export `createBranchInputStep()`)
- Modify: `src/screens/CommitPanel.tsx` (extract `doCommit`/`doCommitAndPush` from button onClicks; register the three `commit.*` handlers via `useAction`)
- Test: `src/features/keymap/presets.test.ts`, `src/features/repo/ops.test.ts` (new), `src/screens/CommitPanel.keyboard.test.tsx`

**Interfaces:**
- Produces: `stageAllOp(): boolean`, `unstageAllOp(): boolean` (ops.ts pattern: decline `false` when no repo / empty list); `createBranchInputStep(): PaletteStep`; action ids listed above.

- [ ] **Step 1: Failing preset tests** — new actions bound in both presets with the spec chords; `Ctrl+V` present on rider `palette.open`, absent from classic.
- [ ] **Step 2: Failing ops tests** — `stageAllOp` returns false with no repo; with mocked store status returns true and calls `stage` with all unstaged paths (mirror for unstage).
- [ ] **Step 3: Failing CommitPanel keyboard tests** — `Mod+Enter` dispatch triggers commit with typed message; declines (falls through) when nothing staged; `Mod+Shift+M` flips the Amend checkbox.
- [ ] **Step 4: Run vitest, verify all new tests fail for the right reason.**
- [ ] **Step 5: Implement** — catalog entries (commit.* without runners; repo.* with ops runners; branch.createNew runner pushes `createBranchInputStep()` via `usePaletteStore`), preset rows, ops functions, commands.ts extraction, CommitPanel handler registration + onClick extraction.
- [ ] **Step 6: vitest green; `pnpm tsc --noEmit` green.**
- [ ] **Step 7: e2e additions** in `keymap.e2e.ts`: ⌘⇧S stages all (porcelain truth); ⌘↵ commits typed message (log truth); ⌘⇧↵ commits and pushes (bare-remote truth); ⌘N opens palette input step and creates branch (ref truth).
- [ ] **Step 8: Full `pnpm test:e2e` green. Commit.**

### Task 2: Speed-search

**Files:**
- Create: `src/features/keymap/useSpeedSearchStore.ts`
- Modify: `src/features/keymap/useKeymapStore.ts` (fallback in `dispatch` for unbound printable keys + Backspace)
- Modify: `src/features/keymap/usePaneList.ts` (`searchText?: (i: number) => string`; jump-on-query effect; Escape-clears handler on `app.closeOverlay`)
- Modify: `src/features/keymap/PGPane.tsx` (query chip)
- Modify: `src/screens/History.tsx`, `Branches.tsx`, `CommitPanel.tsx`, `Reflog.tsx`, `FileHistory.tsx`, `DiffViewer.tsx` (pass `searchText`)
- Test: `src/features/keymap/useKeymapStore.test.tsx`, `src/features/keymap/usePaneList.test.tsx`

**Interfaces:**
- Produces: `useSpeedSearchStore`: `{ queries: Record<string, string>, append(paneId, ch), backspace(paneId), clear(paneId) }`; dispatch fallback claims unbound single-char keys only when `useSpeedSearchStore` has a registered pane (pane focused + `searchText` provided).

- [ ] **Step 1: Failing dispatcher tests** — unbound letter with list-pane speed-search registered appends to query and claims; modifier chords and editable targets never touch the query; Backspace pops; pane focus change clears.
- [ ] **Step 2: Failing usePaneList tests** — query "bra" jumps selection to first matching row; no match leaves selection; Escape with query clears it and claims; Escape without query declines.
- [ ] **Step 3: Verify RED, implement store + fallback + hook + chip, verify GREEN.**
- [ ] **Step 4: e2e** — Branches: type `feat` → selection lands on feature row → Enter checks out (repo truth). History: type a subject fragment → selection jumps (row text assert).
- [ ] **Step 5: Full gates. Commit.**

### Task 3: F7 / ⇧F7 diff-hunk navigation

**Files:**
- Modify: `src/features/keymap/actions.ts` (`diff.nextChange`, `diff.prevChange`, new `Diff` category), `presets.ts` (F7/`Shift+F7` both presets), `CheatSheet.tsx` (category order)
- Modify: `src/screens/DiffViewer.tsx`, `src/screens/CommitDiff.tsx` (`data-hunk-index` wrapper; hunk cursor + scroll handlers registered for panes `diff.view` / `commitDiff.view`)
- Test: `src/features/keymap/presets.test.ts` (bindings), `src/screens/DiffViewer.keyboard.test.tsx` (new: cursor moves/clamps, scrollIntoView called per hunk)

**Interfaces:**
- Consumes: `PGHunk` rendering at both call sites (wrapped in `<div data-hunk-index={i}>`).

- [ ] **Step 1: Failing binding + cursor tests (jsdom mocks `scrollIntoView`).**
- [ ] **Step 2: Verify RED, implement, verify GREEN.**
- [ ] **Step 3: e2e** — DiffViewer on dirtyRepo: F7 sets the second hunk active (assert via `data-hunk-index` scroll target class/attr), ⇧F7 returns. Keep the assertion DOM-truth based; no pixel scroll assertions (WebKitGTK variance).
- [ ] **Step 4: Full gates. Commit. Update v2 spec's screens/wired list if touched.**
