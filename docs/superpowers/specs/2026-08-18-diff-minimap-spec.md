# Diff minimap — scrubable canvas gutter with change markers

Issue 161, Part 2. Part 1 (dropping the `@@` `HunkHeader` rows in
`flattenDiffRows`) landed in `a6718de` and is not revisited here.

## Problem

A diff pane shows one screenful of a file. Nothing on screen says how long the
file is, where the changes sit in it, or whether the twelve lines you are looking
at are the whole change or one of nine clusters. The information exists — the flat
`DiffRow[]` model already holds every row of the file plus its exact height — but
it is only ever rendered a viewport at a time.

## What is built

A miniature of the file painted into a canvas gutter down the right of the diff,
change colour filled in, with a viewport indicator and click/drag scrubbing. It
appears on all four diff surfaces and hides itself where the pane is too narrow to
afford it.

Fidelity is level (1) from the issue — **per-line bars, width proportional to
content length, tinted by change kind.** The real-token path (level 2, colours
from `useDiffSyntax`) is deliberately left unbuilt: it is a second full pass over
the file for a picture whose purpose is shape and change distribution, and (1)
already conveys both. Nothing here forecloses it — `MinimapMark` is a per-row
record, so a token-derived variant would extend it rather than replace the
pipeline.

## The five constraints, and where each is discharged

1. **It cannot read the DOM.** Every number the minimap draws comes from the
   in-memory `DiffRow[]` and its `heights` array: `rowOffset(heights, i)` for a
   row's absolute offset, `rowOffset(heights, heights.length)` for total content
   height. Rows are windowed, so most are unmounted; there is nothing to measure.
   Consequence: the pure core (`lib/diffMinimap.ts`) imports no React and touches
   no DOM, and its whole surface is testable in node.
2. **Canvas, not DOM nodes.** `MAX_WHOLE_FILE_LINES` is 20 000. The canvas is
   sized in device pixels (`css × devicePixelRatio`) and scaled once; the paint
   loop issues at most two `fillRect`s per *device pixel row*, not per file line
   (see "Bands", below).
3. **Canvas cannot use CSS variables**, and the tokens are `oklch(…)`. Discharged
   by `lib/cssColor.ts`: the palette is read from
   `getComputedStyle(document.documentElement).getPropertyValue("--git-added")`
   and friends — custom properties compute to their declared token stream, so this
   returns the literal `oklch(0.72 0.15 155)` regardless of whether the webview
   can *parse* `oklch()` — and then converted to `rgb()`/`rgba()` in TypeScript
   before it reaches the canvas. See "Theme and colour" for why this is not
   optional.
4. **No `ResizeObserver` on WebKitGTK 605.** Measurement is `lib/useElementSize.ts`
   (landed in #166) verbatim. No second measurement hook is written, and the
   initial read is not behind a `typeof ResizeObserver` guard.
5. **Scrubbing is offset arithmetic, never `scrollIntoView`.** The target row is
   almost always unmounted. See "Scrub mapping" for the one place this spec
   deviates from `scrollTopForRow` and why.

Plus: the minimap sits **outside** the scrolling element. `html, body, #root` are
`overflow: hidden` and panes own their scrolling, so each surface grows a flex
wrapper holding the existing `FocusableScroll` and the minimap side by side.

## Geometry

One linear map from content-pixel space to minimap-pixel space, shared by the
bars, the viewport indicator and the scrub. Keeping them in one coordinate system
is what makes the indicator provably the on-screen slice rather than an
approximation of it.

```
scale = min(MINIMAP_ROW_PITCH / rowH,  canvasH / contentH)
mapH  = contentH × scale                       // ≤ canvasH by construction
```

`MINIMAP_ROW_PITCH` is 2 CSS px — the miniature's per-row pitch when it is not
compressed. `rowH` comes from `--diff-row-h` via `useDiffRowHeight()`, so the
pitch stays in step with density and never hardcodes 18.6.

The two regimes fall out of the `min`:

- **File taller than the gutter** — `canvasH / contentH` wins, the whole file is
  compressed to fit, and the minimap never scrolls. This is the point of the
  feature: distribution across the *whole* file, visible without scrolling.
- **File shorter than that** — the pitch wins, and the miniature occupies the top
  `mapH` of the gutter, leaving the remainder empty. A 20-line file is *not*
  stretched across a 900px gutter: doing so would misrepresent the scale and leave
  the viewport indicator covering everything, saying nothing.

`minimapY(offset) = clamp(offset × scale, 0, mapH)` and its exact inverse
`offsetAtMinimapY(y) = clamp(y / scale, 0, contentH)`. `scale === 0` (empty diff,
unmeasured gutter) is a defined state: both return 0 and the gutter renders
nothing.

## Bands — why the paint loop is not per line

A 20 000-line file compressed into a 900px gutter gives each row 0.045 CSS px.
Drawing a rect per row would issue 20 000 calls, and the last row to touch a pixel
would win — so a lone changed line could be painted over by the context line after
it and vanish. Both problems are solved by bucketing first:

`buildMinimapBands()` walks the marks once and accumulates, per **device pixel
row**, the column envelope of the context lines and, separately, of the changed
lines. Every row claims at least one pixel row (`p1 = max(p0 + 1, ceil(y1))`), so
**a single changed line in a 20 000-line file is guaranteed one visible device
pixel** — asserted in the tests. The painter then draws context first and changes
on top, at most two rects per pixel row.

A pixel row holding both additions and deletions is `mixed` and paints in
`--git-modified`. That is what the token means, and it keeps a dense
rewrite from resolving to whichever kind happened to be last.

Changed bars get a minimum width of 35 % of the gutter. Width is otherwise
proportional to content — `from`/`to` are tab-expanded columns over
`MINIMAP_COLS = 80`, so indentation is preserved and the miniature reads as code —
but a changed `}` would be a one-pixel dot, and a change marker that can be missed
is not a marker. Context lines get no such floor: they are shape, not signal.

## Theme and colour

`applyTheme()` writes the palette to inline custom properties on `:root` and sets
`data-theme` / `data-theme-mode`. The minimap reads seven tokens
(`--git-added`, `--git-removed`, `--git-modified`, `--bg-1`, `--fg-3`,
`--border-1`, `--accent`) through `getComputedStyle` and parses each in TypeScript
with `parseCssColor`, which handles `#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`
(comma and space forms) and `oklch()` (OKLab → linear sRGB → gamma, Ottosson's
matrices). The canvas therefore only ever sees `rgb()`/`rgba()`.

**Why the conversion is load-bearing rather than defensive:** the `--git-*` tokens
are `oklch()`, and WebKitGTK 605 — the Linux webview and the e2e target — predates
`oklch()` by several years. `ctx.fillStyle = "oklch(…)"` on an engine that cannot
parse it is a silent no-op that leaves the previous fill in place, so the minimap
would paint black-on-black there while looking correct on macOS. Converting in TS
makes the rendering byte-identical across engines instead of merely non-black.

**Repaint on theme change** is a store subscription, not an observer: the component
selects `activeThemeId` and `customThemes` from `useSettingsStore`. The first
covers switching theme, the second covers editing the live theme's colours (which
keeps the same id, so the id alone would miss it). Density changes arrive through
`rowH`. Every one of those is already a React dependency of the paint effect, so
there is no separate invalidation path to keep in sync.

**Light mode DOES need its own calibration — of the alphas, not the tokens.** This
spec first claimed it did not, and rendering it proved otherwise: the first light
screenshot had a gutter that read as an empty white column. The *colours* are fine
inherited — `SEMANTIC_TOKENS` already calibrates `--git-*` and `--fg-3` per mode
(#61 B4) and the gutter consumes them as-is. What does not carry over is **how much
of them to lay down**: dark mode puts a light `--fg-3` over a near-black gutter,
where a third of it is ample contrast, while light mode puts a mid-grey over
near-white, where the same third is almost invisible. So there is an `ALPHA` table
keyed on `data-theme-mode` — context 0.34 dark / 0.60 light, the viewport band's
fill and outline likewise — and it is documented as measured, not derived. Both
modes are in the PR screenshots.

The hardcoded fallbacks used when a token cannot be read at all (jsdom, a stripped
`:root`) are tabulated per mode for the same reason.

`devicePixelRatio` is read at paint time and re-read on `window` resize, which is
what a monitor change fires.

## Scrub mapping, and its inverse

`scrubScrollTop(geom, heights, { y, grabDy, viewportH })` is the whole gesture, and
it is pure. Two modes, chosen at `pointerdown`:

- **Press inside the viewport indicator** → `grabDy = y − band.top`, and from then
  on `scrollTop = offsetAtMinimapY(y − grabDy)`. The band keeps its grab offset,
  so the slice under the cursor does not jump when the drag starts. Without this,
  pressing near the band's edge would shift the content by up to half a viewport
  before the drag has moved at all — at a typical `scale ≈ 0.11` and a 900px
  viewport that is a 450px jump, which reads as a bug.
- **Press anywhere else** → the row under the cursor is *centred*:
  `i = rowIndexAtOffset(heights, offsetAtMinimapY(y))`, then
  `scrollTop = rowOffset(heights, i) + heights[i]/2 − viewportH/2`, clamped to
  `[0, contentH − viewportH]`. Centring is what makes "click the red band" land on
  the change rather than at the edge of the viewport, and quantising through
  `rowIndexAtOffset` means a scrub always resolves to a real line — which is
  exactly where an off-by-one would hide, so the row-boundary cases are tested
  directly.

**Deviation from `scrollTopForRow`, stated plainly.** The issue says scrubbing goes
through `scrollTopForRow`. Its *doctrine* is honoured exactly — the target is
computed from `heights` by offset arithmetic and never from a `querySelector` +
`scrollIntoView`, which is the #68 G10 trap the rule exists to prevent, and
`rowIndexAtOffset`/`rowOffset` are the row-addressing half. Its *function* is not
called, because its semantics are "the smallest scroll that reveals this row" — it
returns the current `scrollTop` unchanged when the row is already visible. In a
scrub that is a dead zone one viewport tall: dragging the pointer across the band
would move nothing, then jump. `scrollTopForRow` remains the right function for
revealing a row (F7, the line cursor) and keeps both of those call sites; a scrub
positions a viewport, which is a different operation and gets its own pure
function next to it.

## The viewport indicator, while scrolling and while scrubbing

The band is **always derived from `scrollTop` and `viewportH`**, in both states.
The pointer sets `scrollTop`; `scrollTop` sets the band. There is no optimistic
position and no second source of truth, so the band cannot disagree with what is on
screen — and a drag past either end shows the band pinned at the limit rather than
sliding away under the cursor, which is the honest feedback (the content really has
stopped moving).

Scrubbing changes only emphasis: the fill goes from 10 % to 18 % and the 1px
outline from `--border-1` to `--accent`, so it is visible what is being moved. The
pointer is captured on `pointerdown`, so the drag survives leaving the gutter — a
scrub that dies when the cursor strays 60px sideways is worse than none.

The band is clamped to `mapH`, so a file entirely on screen shows an indicator
covering the whole miniature rather than one taller than the thing it indexes.

## Decision: the width below which it hides

**`MINIMAP_MIN_CONTAINER_W = 530` CSS px, measured on the wrapper, not per
surface.**

Derived from the diff's own geometry rather than from what looked right in one
window. `PGDiffRow` spends a fixed 112px before the code column ever starts —
two 40px line-number gutters, two 1px rules, a 20px marker column and 10px of
right padding — and mono at `--fs-12` advances 7.2px per column (0.6em, the
standard monospace ratio). The gutter itself is 64px. So:

```
112  fixed diff chrome (PGDiffRow)
+ 346  48 mono columns of code   (48 × 7.2)
+  64  minimap
+   8  gap
= 530
```

48 columns is the floor because that is the point where the minimap's 64px is
about 12 % of the container — below it the gutter is taking an eighth of a pane
that is already too narrow to read code in, and the marks would be among the
widest things on screen. Above it, every additional pixel makes the gutter cost
proportionally less.

**Measured**, on the real webview at the e2e window size (1200×800, WebKitGTK
605 / xvfb) rather than computed — the widths are logged by the screenshot
harness and each one was confirmed against the image:

| Surface | Diff pane | Gutter |
|---|---|---|
| Diff screen (`diff.view`) | **874px** | shown |
| Files / repo browser (`repo.preview`) | **612px** | shown |
| History's inline commit diff (`history.diff.view`) | **571px** | shown |
| Commit panel (`commit.diff`) | **472px** | hidden |
| Diff screen, file list dragged to its sibling floor | **362px** | hidden |

So at 1200×800 three of the four surfaces earn a gutter and the commit panel does
not — and the screenshot of that case shows why: at 472px its code column is
already wrapping, so 64px is not what it can spare. Widen the window and the
commit panel crosses the gate on its own.

Two properties this design has on purpose:

- **The threshold is on the measured container, so #166 does the rest.** Now that
  pane widths are container-relative, the commit panel that hides its gutter at
  1200px shows one on a larger display without any per-surface knowledge — and
  History's inline panel, the surface the issue expected to be *too narrow*,
  measures 571px and already clears it. The narrowness the issue worried about is
  a state, not a property of a screen.
- **No hysteresis is needed, because the measured box does not change when the
  minimap appears.** `useElementSize` is attached to the *wrapper* that contains
  both the scroll area and the gutter. Adding the gutter therefore cannot shrink
  the number that decides whether to add the gutter — there is no feedback loop to
  oscillate. Measuring the scroll container instead would have created one, and a
  resize-handle drag across the threshold would flicker.

## Keyboard

None, and that is not a gap. CLAUDE.md's drag-and-drop rule ("every drag has a
keyboard equivalent") is about gestures that perform an *operation*; this one
performs a scroll, and scrolling is already bound — arrows, PageUp/PageDown,
Home/End through `FocusableScroll`, F7/⇧F7 across hunks, and the diff line cursor.
The minimap adds a faster way to do something the keyboard already does, so it
needs no new binding, and adding one would spend a chord from a full table.

It is also not a `PGPane`: like the titlebar and the tab strip it is chrome, and
it stays out of the `Alt+Arrow` spatial graph.

The gesture uses raw pointer events with pointer capture rather than
`features/dnd`. That primitive exists to carry a *payload* to a *drop zone* with a
ghost and a legality table; a scrub has none of the three. The rule it does obey is
the one that matters here — pointer events, never HTML5 drag-and-drop.

### …plus a mouse fallback, because pointer events alone are not enough here

Measured on the e2e/CI webview (WebKitGTK 605.1.15 under xvfb): a real WebDriver
pointer action delivers **`mousedown` and no `pointerdown`**, even though
`window.PointerEvent` is a function and `"onpointerdown" in window` is true. A
pointer-events-only gesture is therefore dead on that stack — the first run of the
screenshot harness failed with "minimap never entered the scrubbing state", which
is what found this.

`features/dnd` has the same exposure and it has never mattered there, because every
drag it owns has a keyboard equivalent by rule. The minimap is the one control
whose entire purpose *is* the gesture, so it carries a `mousedown` path guarded by
a `sawPointer` flag: a compliant browser fires `pointerdown` before `mousedown` for
one gesture, so the flag is already set when `mousedown` arrives and the fallback
declines. The two paths cannot both run for one press, and that is unit-tested in
both directions. The fallback follows the drag on `document` (there is no pointer
capture on that path) — the shape `PGResizeHandle` already uses, for the same
reason.

Whether this is a *driver* limitation or a *browser* one is not resolved; the
harness cannot tell them apart from inside the container. Either way the control
now works on the stack CI runs.

## Found while building this, and NOT fixed here

**The diff window under-renders until the pane has been scrolled once.** On the
Diff screen at 1200×800 the scroll container measures `clientHeight` 676, yet the
window mounts 30 rows and leaves a `bottomPad` of 29051px out of a 29609px file —
30 rows is exactly `windowVariable`'s 400px fallback for an unmeasured viewport
(`400 / 18.6 + 8` overscan). After a scroll or two the same pane renders 52 rows
and `bottomPad` drops to 15770, i.e. the height arrives late.

The likely mechanism is `useViewportH`'s dependency list: its effect runs once, on
the owning screen's mount, when the scroll element does not exist yet (the diff is
still loading), so `measure()` sees a null ref and the observer is never attached;
`remeasure()` in the scroll handler is what eventually rescues it. That is
independent of anything in this change — the minimap wrapper does not alter when
the scroller mounts — and the fix belongs to that hook (a ref callback, the way
`useElementSize` does it), across all four surfaces and their tests. **It wants its
own issue, not a drive-by here.** Numbers above are logged by the screenshot
harness so they can be reproduced.

The minimap degrades sanely in the meantime: `viewportH` of 0 gives a
minimum-height band and a scrub that centres exactly on the target row.

## Not in scope

- Token-accurate rendering (level 2).
- A settings toggle to turn the minimap off. The width gate covers the case it
  would exist for; if it is wanted later it is a persisted boolean and one
  `PGToggle`.
- Split view (`PGSideBySideDiff`) has no flat row model or heights array, so there
  is nothing for a minimap to derive from. Unified only, on all four surfaces.
