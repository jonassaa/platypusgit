# Drag-and-drop — implementation plan

**Goal:** One pointer-event drag primitive, used by all three surfaces #91 asks
for: the rebase plan (reorder, already landed — gated and given keyboard parity
here), staging (CommitPanel + RepoBrowser), and the History graph (ref/commit
drops onto ref/commit). No new git ops, no new IPC.

**Architecture:** Frontend only. `src/features/dnd/` holds the gesture (a
module-level controller + a tiny zustand store) and the *pure* drop-resolution
functions; screens import two hooks. `features/rebase/useRowReorder.ts` moves
into `features/dnd/` so all drag lives in one place. `useRepoStore.stage` /
`unstage` / `mergeBranch` / `rebaseOnto` / `cherryPick` are reused verbatim.

**Tech Stack:** React 18 + Zustand, vitest/RTL, WebdriverIO e2e in Docker.

**Design doc:** `docs/superpowers/specs/2026-08-14-drag-and-drop-design.md`
**Issue:** [#91](https://github.com/jonassaa/platypusgit/issues/91)

## Global Constraints

- Never `window.confirm`/`window.prompt` — `pgConfirm` from `@/design`. Component
  tests that render a confirming screen need `WithDialogs` from `@/test/dialog`.
- Frontend never calls `invoke()` directly.
- **Row memoization is load-bearing.** `PGCommitRow` is `React.memo`'d and the
  History list is windowed (#68 G9/G10). No per-row `useDropZone`, no store
  subscription in a row, no new per-row closure. Hover indication is a DOM
  attribute the controller writes.
- **`PGGraphRow` draws in SVG user units** and takes its height as a NUMBER from
  `PGCommitRow`/`useDensityStep()`. Nothing here may change row height.
- No new list-row surface, so no `var(--row-step)` opt-in is owed; the drop bar
  and the ghost are chrome and stay fixed.
- Never hardcode the accent hue — `var(--accent)` / `oklch(from var(--accent) …)`.
- `PGRebaseRow` speaks exact `RebaseAction` strings; a reorder must not touch a
  row's action or message.
- Preserve mode disables reordering — in BOTH entry points, visibly.
- The plan is validated before the repo is touched: reorder stays a pure
  `setPlan` splice; nothing new calls `rebase_start`.
- Run pnpm with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- E2E only via `pnpm test:e2e:docker` — and not in this pass (concurrent agents
  share an 8GB Docker VM); CI's `e2e-linux` is the gate.

## File Structure

**Create:**
- `src/features/dnd/types.ts` — `DragPayload`, `DropResolution`, `GraphDropTarget`.
- `src/features/dnd/dragController.ts` — gesture state machine, zone registry,
  ghost, Escape/pointercancel, the `useDragStore`.
- `src/features/dnd/useDnd.ts` — `useDragSource`, `useDropZone`.
- `src/features/dnd/resolveDrop.ts` — `resolveStagingDrop`, `resolveGraphDrop`.
- `src/features/dnd/resolveDrop.test.ts`
- `src/features/dnd/dnd.test.tsx` — the primitive.
- `src/features/dnd/index.ts` — barrel.
- `src/features/dnd/StageDropBar.tsx` — RepoBrowser's drag-only Stage/Unstage bar.
- `src/screens/CommitPanel.dnd.test.tsx`
- `src/screens/RepoBrowser.dnd.test.tsx`
- `src/screens/History.dnd.test.tsx`
- `e2e/specs/drag-and-drop.e2e.ts`

**Move:**
- `src/features/rebase/useRowReorder.ts` → `src/features/dnd/useRowReorder.ts`.

**Modify:**
- `src/index.css` — `[data-pg-drop-over]`, `[data-pg-drag-source]`, ghost.
- `src/design/primitives.tsx` — `PGBranchPill` gains `refName` → `data-pg-ref`.
- `src/design/git-components.tsx` — `CommitRef.ref`; `PGCommitRow` passes it to
  the pill; `PGRebaseRow` gains `selected` + `reorderable`.
- `src/lib/derive.ts` — `mapCommitRefs` returns the original `ref`.
- `src/features/keymap/actions.ts`, `presets.ts` — `rebase.moveStepUp/Down`.
- `src/screens/Rebase.tsx` — preserve gate + note, row cursor, keyboard actions.
- `src/screens/Rebase.reorder.test.tsx` — preserve gate + keyboard cases.
- `src/screens/CommitPanel.tsx` — sources + two zones.
- `src/screens/RepoBrowser.tsx` — source + drop bar.
- `src/screens/History.tsx` — sources + one delegated zone.
- `e2e/support/app.ts` — `jsDrag`.
- `CLAUDE.md` — the `features/dnd/` entry and the pointer-events rule.

---

### Task 1: the primitive

- [x] `types.ts`: the payload union; `paths` pre-bucketed by the source.
- [x] `dragController.ts`: `useDragStore` (`payload`, `overId`), `registerZone`,
      `beginDrag`. Slop 4px; ghost created with `document.createElement` and
      moved by `style.transform` (never React state per move);
      `data-pg-drop-over` written to the resolved element; Escape and
      `pointercancel` cancel; `pointerdown` opts out of
      `button, select, textarea, input, a, [contenteditable]`; `dragstart`
      prevented on sources.
- [x] `useDnd.ts`: `useDragSource(make)` → `{ onPointerDown }` where `make(el)`
      returns a payload or null; `useDropZone(spec)` → `{ ref, isOver, active }`.
- [x] `resolveDrop.ts` + `resolveDrop.test.ts` — write the test first; it is the
      whole table from the design doc.
- [x] `dnd.test.tsx` — slop, Escape, pointercancel, control opt-out, delegated
      resolution, rejection does not call `onDrop`.
- [x] Move `useRowReorder.ts`; `index.ts` re-exports it. `pnpm tsc --noEmit`.
- [x] `index.css`: `[data-pg-drop-over]` inset accent ring + wash;
      `[data-pg-drag-source] { -webkit-user-drag: none }`; `.pg-drag-ghost`.

### Task 2: rebase — gate preserve mode, add keyboard parity

- [x] `Rebase.reorder.test.tsx` first: in preserve mode a pointer drag leaves the
      order alone; `rebase.moveStepUp/Down` move the cursor row in flatten mode
      and decline in preserve mode; a reordered row keeps its action and message.
- [x] `actions.ts`: two pane-scoped `Repository`-category actions.
      `presets.ts`: `Mod+Shift+ArrowUp` / `Mod+Shift+ArrowDown` in **both**
      presets (`presets.test.ts` requires every action bound in every preset).
- [x] `PGRebaseRow`: `selected`, `reorderable` (drag glyph dims + `cursor`).
- [x] `Rebase.tsx`: `canReorder = mergeMode === "flatten"`; conditional
      `onPointerDown`; `data-pg-reorderable`; the preserve-mode note; a `cursor`
      index + `usePaneList` + the two `useAction` registrations.

### Task 3: staging drag

- [x] `CommitPanel.dnd.test.tsx` first: flat unstaged→staged stages the path;
      staged→unstaged unstages; a multi-selected drag carries every selected row
      on that side; a tree directory row carries every file beneath it; a
      same-side drop calls nothing; an embedded repo is never in the payload.
- [x] `CommitPanel.tsx`: `dragPayloadFor(side, el)` off `closest("[data-path]")`
      reusing `splitFileSelection` + this screen's `selectionSource`; wrap each section in the
      source's `onPointerDown` and the zone's `ref`; the zone renders a "Drop to
      stage/unstage" caption while `isOver`.
- [x] `StageDropBar.tsx` + `RepoBrowser.tsx`: tree is a source, the bar is two
      zones rendered only while a files drag is active, both routed through
      `splitSelection`.
- [x] `RepoBrowser.dnd.test.tsx`: BOTH directions. The bar is an explicit command
      surface, so it must NOT go through `resolveStagingDrop` — the first cut did,
      and that function's same-side no-op rule silently killed the Unstage zone
      (it highlighted, read "Unstage", and did nothing). Caught in review; this
      file is the regression cover the surface was missing.

### Task 4: graph drag

- [x] `History.dnd.test.tsx` first, with `WithDialogs`: HEAD-ref → other ref
      confirms then calls `rebaseOnto`; other ref → HEAD row confirms then calls
      `mergeBranch`; commit → HEAD ref confirms then calls `cherryPick`;
      dismissing the confirm calls nothing; a non-HEAD → non-HEAD drop calls
      nothing and flashes.
- [x] `derive.ts` `mapCommitRefs` → `ref`; `CommitRef.ref`; `PGCommitRow` →
      `PGBranchPill refName`; `PGBranchPill` → `data-pg-ref`.
- [x] `History.tsx`: one `useDragSource` on the list wrapper (pill first, then
      row) and one delegated `useDropZone` resolving `[data-pg-ref]` /
      `[data-sha]`; `accepts` gated on `repoState === "Clean"`; drops go through
      `pgConfirm` then the store action.

### Task 5: e2e + verification

- [x] `e2e/support/app.ts`: `jsDrag(fromSel, toSel)` — one `executeOnce` script
      dispatching real `PointerEvent`s at both elements' centres.
- [x] `e2e/specs/drag-and-drop.e2e.ts`: `dirtyRepo`, Commit screen, drag a
      CHANGES row onto STAGED and back, the same-side no-op, and the hover/Escape
      affordance; asserted against `git diff --cached --name-only`. Plus the
      preserve-mode reorder gate in `rebase.e2e.ts`, where a merge range already
      exists. NOT RUN locally — concurrent agents share the 8GB Docker VM; CI's
      `e2e-linux` is the gate.
- [x] `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`,
      `pnpm test`, `pnpm vite build`.
- [x] `CLAUDE.md` entry. Squash to one Conventional Commit, push, open the PR.
