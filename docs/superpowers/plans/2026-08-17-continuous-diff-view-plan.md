# Continuous diff view — implementation plan (#157)

Spec: `docs/superpowers/specs/2026-08-17-continuous-diff-view-spec.md`.

Order matters: the row model first, then the two renderers, then the four
surfaces, then the keymap, then tests and docs. Each step leaves the tree
type-checking.

## 1. Row model — `src/lib/diffRows.ts`

- `DiffRow`: drop `header`; add `hunkAnchor?: true` to `line`; add
  `fold` (`gapIndex`, `hiddenLines`, `fromL`, `fromR`, `h`).
- `flattenDiffRows` options: `headerH` → `foldH`; `wholeFile` →
  `text` + `gaps: "fill" | "fold"` (default `"fold"`) + `expandedGaps`.
- `hunkRows(h, i)` marks the first `add`/`rem` row `hunkAnchor`, falling back to
  the hunk's first row when the hunk has none.
- One walk for both modes. Per gap, `gapOut(gapIndex, oldFrom, newFrom, count)`
  returns fill rows (`gaps: "fill"`, or `"fold"` + `expandedGaps.has`), a single
  fold row, or `[]` for a zero-length gap.
- Degradation: structural mismatch → `hunks.flatMap(hunkRows)` (no separators);
  text-dependent failure → re-enter in `"fold"` mode with `expandedGaps`
  dropped (bounded, one re-entry).
- Trailing gap: fill/fold only when the text length is known.
- Export `hunkAnchorRows(rows): number[]` — flat row index per hunk index, `-1`
  when absent. Used by every surface's F7 scroll.

## 2. Design system — `src/design/git-components.tsx`

- Delete `PGHunkHeader` (barrel is `export *`, so no index edit).
- Add `PGHunkActions({ staged, onStage, onDiscard, actionsDisabledReason,
  selCount })`: `pointer-events: none` wrapper, `auto` buttons, stage button keeps
  `data-testid="hunk-stage"` and shows `N lines` only when `selCount > 0`.
- Add `PGFoldSeparator({ hiddenLines, fromR, height?, onExpand? })`.

## 3. `src/design/PGWindowedDiff.tsx`

- Drop `collapsed` / `onToggleHunk`; add `onExpandGap`.
- `fold` → `PGFoldSeparator`. `line` with `hunkAnchor` → `position: relative`
  wrapper carrying `data-hunk-index` / `data-hunk-active`, containing the row and
  (when `hunkActions` yields handlers) `PGHunkActions`.
- Delete the `@@` strip/re-add round trip with the header.

## 4. `src/index.css`

`[data-pg-hunk-actions]` idle opacity + `:hover` / `[data-hunk-active]` reveal;
`--fold-h` style hook if needed.

## 5. Gap plumbing — `src/features/diff/`

- `useWholeFile.ts` → `useDiffGaps.ts`: `useDiffGaps(syntax, { disabled? })` →
  `{ gaps, text }`, plus `useExpandedGaps(resetKey)` → `{ expanded, expand }`.

## 6. Surfaces

- `CommitPanel.tsx`, `RepoBrowser.tsx`, `DiffViewer.tsx`: drop the `collapsed`
  state and `toggleHunk`; `headerH` → `foldH = 22 + useDensityStep()`; pass
  `text` / `gaps` / `expandedGaps` / `onExpandGap`; add `useHunkNav` +
  `activeHunk` where missing (commit panel, repo browser) with an offset
  `scrollToHunk`; DiffViewer's F7 effect targets the anchor row.
- `CommitDiffPanel.tsx`: header branch → `PGFoldSeparator`; anchor attrs on the
  anchor row; add/rem background + gutter stripe; offset `scrollToHunk`;
  `expandedGaps`.

## 7. Keymap

- `actions.ts`: `diff.stageHunk`, `diff.discardHunk` — category `Diff`, scope
  `pane`, no default runner.
- `presets.ts` `COMMON`: `Mod+Shift+H`, `Mod+Shift+Backspace`.
- `useHunkNav.ts`: optional `scrollToHunk`, DOM query as fallback.
- Register the handlers in `CommitPanel` and `RepoBrowser` against the hunk
  cursor / line cursor, gated by `actionsDisabledReason`.

## 8. Tests

- `diffRows.test.ts`: header → fold assertions, anchor assertions, the new
  degradation ladder, `hunkAnchorRows`, expanded gaps.
- `PGWindowedDiff.test.tsx`: anchor row carries the attributes; fold separator
  renders and expands; collapse test removed.
- `useDiffLineFocus.test.tsx`: drop the collapsed-hunk case.
- `CommitPanel.lineStaging / whitespace / lineFocus`, `CommitDiffPanel.syntax /
  window`, `syntaxRender`, `wordDiffRender`: `headerH` → `foldH` and any
  header-shaped expectation.
- `pnpm tsc --noEmit`, `pnpm test`, `pnpm exec tsc -p e2e/tsconfig.json
  --noEmit`, `cargo check`.

## 9. e2e

Expected to need **no** spec changes — `[data-hunk-index="0"]` is now the first
changed row (inside the initial window for `keymap.e2e.ts`'s fixture) and
`[data-testid="hunk-stage"]` is still displayed. Verify in Docker:
`pnpm test:e2e:docker build` then `run --spec history-diff --spec keymap`.

## 10. Docs

Update CLAUDE.md: the "Hunk headers stay in whole-file mode" bullet, the
`features/diff/` tree entry (`useWholeFile` → `useDiffGaps`), the `lib/diffRows.ts`
tree entry (`header | line | fill` → `line | fill | fold`), and the two-cursors
bullet's mention of the header as the `data-hunk-*` host.

## 11. Screenshots

Throwaway spec driving whole-file mode (additions + deletions), chunked mode (fold
separator) and the hover state; `browser.saveScreenshot()`; delete the spec before
committing; attach with `gh pr comment`.
