# Multi-File Selection — Implementation Plan

Spec: `docs/superpowers/specs/2026-07-03-multi-file-select-design.md`

## 1. Pure selection helper

`src/lib/selection.ts` (new):

- `interface Selection { keys: string[]; anchor: string | null }` +
  `emptySelection`.
- `clickSelection(order, prev, key, { toggle, range }): Selection` — plain /
  ctrl-toggle / shift-range semantics per spec. Range is over `order` (the
  visible row order); unknown anchor or key degrades to plain click.
- `pruneSelection(prev, valid: ReadonlySet<string>): Selection` — drops dead
  keys, re-homes a dead anchor to the last surviving key. Returns `prev`
  unchanged (same reference) when nothing changed, so it can be used in
  `setState` without re-render churn.
- `primarySelectedKey(sel): string | null` — anchor if still selected, else
  last selected key. Drives the preview pane.

Tests in `src/lib/selection.test.ts`.

## 2. Design-system threading

`src/design/git-components.tsx`:

- `PGChangeRow`: `onClick?: (e: MouseEvent) => void`; render
  `data-selected={selected ? "true" : undefined}`.
- `PGFileTreeRow`: same `onClick` change, new `onContextMenu?`, same
  `data-selected`.
- `PGFileTree`: new `selectedKeys?: ReadonlySet<string>` prop (a row is
  selected when in `selectedKeys` or equal to `selected`); `onSelect` /
  `onActivate` gain an optional trailing `MouseEvent`; new
  `onRowContextMenu?: (e, key, node) => void`; export `flattenFileTree`.

`src/design/context-menu.tsx`: new `multiFileMenuItems({ stagedPaths,
unstagedPaths })` — Stage/Unstage subset items, Copy paths, and a
danger "Discard changes in N files…" gated by `window.confirm`.

## 3. CommitPanel

- Replace `selectedKey: string | null` with `sel: Selection`.
- Visible order = `[...staged, ...unstaged].map(keyOf)`.
- Row `onClick` → `clickSelection` with `toggle = e.metaKey || e.ctrlKey`,
  `range = e.shiftKey`.
- Prune effect on `[staged, unstaged]`; reset on `repo?.id` change.
- Preview file = row for `primarySelectedKey(sel)`, falling back to
  `unstaged[0] ?? staged[0]` as today.
- Checkbox toggle: row in a multi-selection → act on all selected paths on
  that row's side; else single path as today.
- Context menu: clicked row in a multi-selection → `multiFileMenuItems`
  (split by side); else collapse selection to the row + existing
  `fileMenuItems`.

## 4. RepoBrowser

- Replace `selected: string | null` with `sel: Selection` over tree keys.
- Order = `flattenFileTree(tree, expanded).map(f => f.key)`.
- `selectedKeys` prop for multi-highlight; prune on tree change; reset on
  repo change and rev change (existing resets keep working).
- Preview = `primarySelectedKey`.
- New context menu on file rows: multi-selection → `multiFileMenuItems`
  (staged/unstaged split derived from each path's `FileStatus`); single file
  → `fileMenuItems`. Suppressed while browsing a committed revision (no
  worktree to stage from).

## 5. Tests & validation

- `src/lib/selection.test.ts` (pure) + `src/screens/CommitPanel.test.tsx`
  (component; `mockInvoke` for `get_diff`, refresh commands, `stage_paths`,
  `discard_paths`; `vi.spyOn(window, "confirm")` for the danger flow).
- Gates: `pnpm tsc --noEmit`, `pnpm test`. E2E untouched (plain-click flows
  unchanged); CI runs the suite on the PR.
