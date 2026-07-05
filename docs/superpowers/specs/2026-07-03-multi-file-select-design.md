# Multi-File Selection — Design

Status: approved 2026-07-03 (issue #25, item 4)

## Problem

File lists are strictly single-select. Staging, unstaging, or discarding
several files means clicking each one individually (or all-or-nothing via
"Stage all"). Every serious git GUI supports Cmd/Ctrl-click and Shift-click
multi-selection; its absence is a daily-friction gap.

## Scope

Frontend only. The backend path-array IPC already exists
(`stage_paths` / `unstage_paths` / `discard_paths` in
`src-tauri/src/commands/diff.rs`, wrapped by `stagePaths` /
`unstagePaths` / `discardPaths` in `src/lib/tauri.ts`) and `useRepoStore`'s
`stage` / `unstage` / `discard` actions already take `string[]`.

Applies to two surfaces:

- **CommitPanel** — the STAGED and CHANGES lists (`PGChangeRow`s).
- **RepoBrowser** — the file tree (`PGFileTree` / `PGFileTreeRow`).

Out of scope: History/CommitDiff file lists, drag-select, Select All
shortcut, e2e specs (existing single-click flows are unchanged; multi-select
e2e can follow later).

## Selection model

Classic desktop list semantics, implemented as a pure, tested helper
(`src/lib/selection.ts`):

- **Plain click** — selects exactly that row and sets it as the *anchor*.
  Existing behavior preserved.
- **Cmd/Ctrl-click** (`metaKey || ctrlKey`) — toggles the row in/out of the
  selection. Toggling in moves the anchor to that row; toggling the anchor
  itself out moves the anchor to the last remaining selected row.
- **Shift-click** — replaces the selection with the contiguous range of
  *visible* rows between the anchor and the clicked row (either direction).
  The anchor does not move, so successive shift-clicks re-extend from the
  same origin. No anchor yet → behaves like plain click.
- **Pruning** — whenever the underlying row set changes (refresh, repo
  switch, stage/unstage moving files between lists, rev/filter change in the
  browser), selected keys that no longer exist are dropped; a vanished anchor
  falls back to the last surviving selected row.

Selection state lives in local component state per existing patterns
(CommitPanel's `selectedKey`, RepoBrowser's `selected` today) — not in a
store. The *primary* row (anchor, falling back to the last selected) drives
the existing single-file preview/diff pane, so preview behavior is unchanged
for single selection.

In CommitPanel the visible row order spans STAGED then CHANGES; a shift range
may cross the boundary. Row keys stay `side:path` so the same path staged and
unstaged remains two distinct rows.

In RepoBrowser the range is over the *flattened visible* tree rows (folders
included in the range for selection purposes); operations only ever apply to
paths that resolve to actual changed files, so folder keys are inert.

## Multi-file operations

- **Row checkbox (CommitPanel)** — toggling the checkbox of a row that is
  part of a multi-selection stages/unstages *all selected rows on that side*.
  Toggling an unselected row's checkbox affects only that row (unchanged).
- **Context menu** — right-clicking a row inside the current multi-selection
  opens a multi-file menu (`multiFileMenuItems` in
  `src/design/context-menu.tsx`): "Stage N files", "Unstage N files",
  "Copy paths", and "Discard changes in N files…" (danger). Right-clicking a
  row outside the selection first collapses the selection to that row and
  shows the existing single-file menu. Mixed selections (staged + unstaged)
  offer both Stage and Unstage, each acting on its own subset.
- **Discard** — multi-discard goes through the existing confirm/danger flow:
  a `window.confirm` naming the file count, and the menu item styled
  `danger`, matching hunk-discard's existing confirm.
- **RepoBrowser** — file rows gain a context menu (the tree had none): the
  single-file menu for one file, the multi-file menu for a selection.

## Component changes

Per the design-system rule that row components need explicit prop threading:

- `PGChangeRow` — `onClick` gains the mouse event; adds `data-selected` for
  tests/e2e.
- `PGFileTreeRow` — `onClick` gains the mouse event; new `onContextMenu`
  prop; adds `data-selected`.
- `PGFileTree` — new `selectedKeys?: ReadonlySet<string>` (multi-highlight),
  `onSelect`/`onActivate` pass the mouse event through when originating from
  a click, new `onRowContextMenu`. `flattenFileTree` is exported so callers
  can compute the visible row order for shift ranges. Keyboard navigation
  (arrows/Enter) keeps plain single-select semantics.

## Testing

- `src/lib/selection.test.ts` — pure helper: plain click, ctrl toggle in/out,
  anchor handoff, shift ranges both directions, shift without anchor, prune.
- `src/screens/CommitPanel.test.tsx` — jsdom + RTL with `mockInvoke`:
  ctrl-click toggles rows into a multi-selection, shift-click selects a
  range, multi stage via context menu dispatches one `stage_paths` call with
  the full path array, multi discard confirms before `discard_paths` and
  aborts when declined.
