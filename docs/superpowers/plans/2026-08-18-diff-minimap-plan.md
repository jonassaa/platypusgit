# Plan — diff minimap (issue 161, Part 2)

Spec: `docs/superpowers/specs/2026-08-18-diff-minimap-spec.md`.
Part 1 landed in `a6718de`; nothing below touches it.

## 1 — `src/lib/cssColor.ts` (+ test)

Pure. `parseCssColor(value): Rgba | null` and `rgbaCss(c, alpha?)`.

- `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`.
- `rgb()`/`rgba()`, comma and space-separated, alpha as number or `%`.
- `oklch(L C H)` / `oklch(L C H / A)`, `L` as number or `%`; OKLab → linear sRGB
  (Ottosson matrices) → sRGB transfer function → clamp → 0–255.
- Anything else → `null`, so callers fall back rather than hand a canvas a string
  it will silently ignore.

Tests: each syntax; `oklch(0.72 0.15 155)` is green (g dominant) and round-trips
into a `rgb(…)` string; `oklch(0 0 0)`/`oklch(1 0 0)` clamp to black/white;
garbage → `null`; alpha carried through.

## 2 — `src/lib/diffMinimap.ts` (+ test)

Pure, no React, no DOM. Constants: `MINIMAP_W = 64`, `MINIMAP_COLS = 80`,
`MINIMAP_ROW_PITCH = 2`, `MINIMAP_TAB_COLS = 8`, `MINIMAP_MIN_BAND_H = 8`,
`MINIMAP_MIN_CHANGED_FRAC = 0.35`, `MINIMAP_MIN_CONTAINER_W = 530`.

- `lineColumns(text)` → tab-expanded `{ from, to }`, trailing whitespace excluded,
  early exit at `MINIMAP_COLS`.
- `minimapMarks(rows)` → one `MinimapMark { kind, from, to }` per row; `fold` rows
  are their own kind; `info`/`empty` line kinds fold into `ctx`.
- `minimapGeom({ contentH, canvasH, rowH, pitch? })` → `{ scale, contentH, mapH, canvasH }`.
- `minimapY` / `offsetAtMinimapY` — exact inverses.
- `rowIndexAtOffset(heights, offset)`.
- `viewportBand(geom, { scrollTop, viewportH })` → `{ top, height }`, clamped to `mapH`.
- `grabDyFor(geom, { y, scrollTop, viewportH })` → number inside the band, else null.
- `scrubScrollTop(geom, heights, { y, grabDy, viewportH })`.
- `buildMinimapBands({ marks, heights, geom, dpr })` → per-device-pixel-row
  envelopes, `≥ 1` pixel row per mark, context and change accumulated separately,
  add+rem in one pixel → `mixed`.

Tests, per the brief's "unit-test the pure parts hard":

- **file longer than the gutter**: `scale === canvasH / contentH`, `mapH === canvasH`.
- **file shorter than the gutter**: `scale === pitch / rowH`, `mapH < canvasH`.
- **empty diff**: `scale === 0`, `mapH === 0`, every accessor defined and 0.
- mapping ⇄ inverse round-trip across the range, including both endpoints.
- `rowIndexAtOffset` on exact row boundaries (0, h, h−ε, contentH, past the end).
- scrub inverse: y at a known row's top/middle/bottom all centre that row; clamped
  at both ends; grab mode preserves the offset exactly.
- one changed line among 20 000 produces at least one band with a change envelope.

## 3 — `src/features/diff/DiffMinimap.tsx` (+ test)

Props: `rows`, `heights`, `rowH`, `scrollTop`, `viewportH`, `scrollRef`,
`onScrollTop`, `containerWidth`, `containerHeight`, `testId`.

- Returns `null` when `containerWidth > 0 && containerWidth < MINIMAP_MIN_CONTAINER_W`,
  or when there are no rows. `0` means unmeasured, so it does **not** hide (that is
  the `useElementSize` contract).
- Palette: `useMinimapPalette()` reads the seven tokens off `:root`, parses via
  `parseCssColor`, falls back per `data-theme-mode`. Recomputed on `activeThemeId`
  and `customThemes`.
- Paint effect: size the canvas by `devicePixelRatio`, guard a null 2D context
  (jsdom), clear, background, then the band loop — context envelope, then change
  envelope with the 35 % floor, then fold bands, then the viewport indicator.
- Pointer: `pointerdown` → capture, `grabDyFor` decides grab vs centre, then
  `scrubScrollTop` on every `pointermove`; `pointerup`/`pointercancel` release.
  Writes `scrollRef.current.scrollTop` and reports the clamped value back through
  `onScrollTop`.

Tests: hidden below the threshold, shown above it, not hidden at width 0, no crash
without a canvas context, `pointerdown` scrolls the referenced element.

## 4 — Wire the four surfaces

Each gets a `useElementSize()` on a new flex wrapper around its existing
`FocusableScroll`, and passes the values it already has.

- `src/screens/DiffViewer.tsx` — unified branch only.
- `src/screens/CommitPanel.tsx` — unified branch only.
- `src/screens/RepoBrowser.tsx` — the preview pane's diff branch only (not the
  plain file-content branch, which has no rows).
- `src/features/diff/CommitDiffPanel.tsx` — hides itself in History's beside
  layout by width, per the spec.

## 5 — Verify

`pnpm tsc --noEmit`, `pnpm test`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`.
Then `pnpm test:e2e:docker build` and the `history-diff` spec, plus a throwaway
screenshot spec (deleted before commit) covering: a long file's distribution, the
viewport indicator, mid-scrub, a narrow pane with the minimap hidden, and the same
long file in a light theme. Images land in
`docs/superpowers/specs/assets/2026-08-18-diff-minimap/`.
