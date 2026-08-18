// Pure core of the diff minimap (#161 part 2): geometry, marks, bands, scrub.
//
// No React and no DOM. Everything the gutter draws is derived from the in-memory
// `DiffRow[]` and its `heights` array, because the rows are WINDOWED — most of the
// file is unmounted at any moment, so there is nothing to measure and a
// `querySelector` would find nothing. `rowOffset` gives a row's absolute offset
// and `rowOffset(heights, heights.length)` the total content height; those two
// plus a scale are the whole coordinate system.
//
// The consequence worth stating: every number in this file is testable in node,
// which is where an off-by-one in the scrub would otherwise only show up as
// "landed on the wrong line" in a screenshot.
import type { DiffRow } from "./diffRows";
import { rowOffset } from "./diffRows";

/** Gutter width in CSS px. */
export const MINIMAP_W = 64;

/**
 * Columns mapped across the gutter's width. 80 is the width most code is written
 * to, so a full-width bar reads as "a long line" rather than "any line at all".
 * Beyond it, bars clamp.
 */
export const MINIMAP_COLS = 80;

/** Minimap px per code row when the file is short enough not to be compressed. */
export const MINIMAP_ROW_PITCH = 2;

/** Tab expansion for column arithmetic — 8 is the default `tab-size` the rows use. */
export const MINIMAP_TAB_COLS = 8;

/** Floor on the viewport indicator's height, so it stays grabbable. */
export const MINIMAP_MIN_BAND_H = 8;

/**
 * Floor on a CHANGED bar's width, as a fraction of the gutter.
 *
 * Width is otherwise proportional to content, but a changed `}` would be a
 * one-pixel dot — and a change marker that can be missed is not a marker. Context
 * lines get no floor: they are shape, not signal.
 */
export const MINIMAP_MIN_CHANGED_FRAC = 0.35;

/**
 * Container width below which the gutter hides rather than eat the diff.
 *
 * Derived from the diff's own geometry, not from what looked right in one window.
 * `PGDiffRow` spends a fixed 112px before the code column starts (two 40px
 * line-number gutters, two 1px rules, a 20px marker column, 10px right padding)
 * and mono at `--fs-12` advances 7.2px per column. So:
 *
 *   112 chrome + 48 columns (346px) + 64 gutter + 8 gap = 530
 *
 * 48 columns is the floor because that is where the gutter's 64px is about an
 * eighth of the container: below it the minimap is taking a large share of a pane
 * already too narrow to read code in, and the marks would be among the widest
 * things on screen. Above it, each extra pixel makes the gutter cost less.
 *
 * Measured on the WRAPPER that holds the scroll area and the gutter together, so
 * showing the gutter cannot change the number that decides whether to show it —
 * no feedback loop, so no hysteresis and no flicker while dragging a resize
 * handle across the threshold.
 */
export const MINIMAP_MIN_CONTAINER_W = 530;

export type MinimapMarkKind = "add" | "rem" | "ctx" | "fold";

export interface MinimapMark {
  kind: MinimapMarkKind;
  /** First content column, tabs expanded. 0 for a blank or fold row. */
  from: number;
  /** One past the last content column. Equals `from` when there is no content. */
  to: number;
}

/**
 * Tab-expanded content extent of a line, capped at `MINIMAP_COLS`.
 *
 * Leading whitespace is excluded from `from` so indentation survives into the
 * miniature — that is most of what makes it read as code. Trailing whitespace is
 * excluded from `to` for the same reason in reverse: a line padded with spaces is
 * not a long line.
 */
export function lineColumns(
  text: string,
  tabCols: number = MINIMAP_TAB_COLS,
  maxCols: number = MINIMAP_COLS,
): { from: number; to: number } {
  let col = 0;
  let from = -1;
  let to = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\t") {
      col += tabCols - (col % tabCols);
      continue;
    }
    if (ch === " " || ch === "\r" || ch === "\n") {
      col += 1;
      continue;
    }
    if (from < 0) from = col;
    col += 1;
    to = col;
    if (to >= maxCols) return { from, to: maxCols };
  }
  return from < 0 ? { from: 0, to: 0 } : { from, to };
}

/**
 * One mark per row, in row order — the same index space as `heights`.
 *
 * `info` and `empty` line kinds fold into `ctx`: after #161 part 1 no header row
 * reaches here, and the remaining two are chrome that carries no change.
 */
export function minimapMarks(rows: DiffRow[]): MinimapMark[] {
  return rows.map((row) => {
    if (row.kind === "fold") return { kind: "fold" as const, from: 0, to: 0 };
    const k = row.line.kind;
    const kind: MinimapMarkKind = k === "add" ? "add" : k === "rem" ? "rem" : "ctx";
    const { from, to } = lineColumns(row.line.text ?? "");
    return { kind, from, to };
  });
}

export interface MinimapGeom {
  /** Content px → minimap px. 0 means "nothing to draw" and is a valid state. */
  scale: number;
  /** Total scrollable content height in px. */
  contentH: number;
  /** Painted height of the miniature. `contentH * scale`, always ≤ `canvasH`. */
  mapH: number;
  /** The gutter's own height in CSS px. */
  canvasH: number;
}

/**
 * The one linear map, shared by the bars, the viewport indicator and the scrub.
 *
 * `min` of two regimes:
 *  - `canvasH / contentH` — a file taller than the gutter is compressed to fit, so
 *    the minimap never scrolls and the WHOLE file's change distribution is visible
 *    at once. That is the point of the feature.
 *  - `pitch / rowH` — a shorter file keeps a fixed small pitch and occupies only
 *    the top of the gutter. Stretching a 20-line file across 900px would
 *    misrepresent the scale and leave the indicator covering everything.
 */
export function minimapGeom(o: {
  contentH: number;
  canvasH: number;
  rowH: number;
  pitch?: number;
}): MinimapGeom {
  const pitch = o.pitch ?? MINIMAP_ROW_PITCH;
  const contentH = Math.max(0, o.contentH);
  const canvasH = Math.max(0, o.canvasH);
  if (contentH <= 0 || canvasH <= 0 || o.rowH <= 0 || pitch <= 0) {
    return { scale: 0, contentH, mapH: 0, canvasH };
  }
  const scale = Math.min(pitch / o.rowH, canvasH / contentH);
  return { scale, contentH, mapH: contentH * scale, canvasH };
}

const clamp = (n: number, lo: number, hi: number) =>
  n < lo ? lo : n > hi ? hi : n;

/** Content offset → minimap y. */
export function minimapY(g: MinimapGeom, offset: number): number {
  if (g.scale <= 0) return 0;
  return clamp(offset * g.scale, 0, g.mapH);
}

/** Minimap y → content offset. The exact inverse of `minimapY` inside range. */
export function offsetAtMinimapY(g: MinimapGeom, y: number): number {
  if (g.scale <= 0) return 0;
  return clamp(y / g.scale, 0, g.contentH);
}

/**
 * Index of the row occupying `offset`, treating each row as `[top, top + h)`.
 *
 * Clamps rather than returning -1 past the end, because a scrub at the very
 * bottom of the gutter must land on the last line, not nowhere. Empty heights is
 * the one case with no answer: -1.
 */
export function rowIndexAtOffset(heights: number[], offset: number): number {
  if (heights.length === 0) return -1;
  if (offset <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    acc += heights[i];
    if (offset < acc) return i;
  }
  return heights.length - 1;
}

/**
 * The on-screen slice, as a rect in minimap space.
 *
 * Derived from `scrollTop`/`viewportH` in EVERY state, scrubbing included: the
 * pointer sets `scrollTop` and `scrollTop` sets this, so the band can never
 * disagree with what is rendered, and a drag past either end shows it pinned at
 * the limit rather than sliding away under the cursor.
 *
 * Clamped to `mapH`, so a file entirely on screen shows a band covering the whole
 * miniature rather than one taller than the thing it indexes.
 */
export function viewportBand(
  g: MinimapGeom,
  o: { scrollTop: number; viewportH: number },
): { top: number; height: number } {
  if (g.scale <= 0 || g.mapH <= 0) return { top: 0, height: 0 };
  const height = Math.min(
    g.mapH,
    Math.max(MINIMAP_MIN_BAND_H, o.viewportH * g.scale),
  );
  const top = clamp(o.scrollTop * g.scale, 0, Math.max(0, g.mapH - height));
  return { top, height };
}

/**
 * Grab offset within the viewport band, or null when the press missed it.
 *
 * Non-null selects the band-drag mode below. Without it, pressing near the band's
 * edge would shift the content by up to half a viewport before the drag had moved
 * at all — at a typical scale of 0.11 and a 900px viewport, a 450px jump.
 */
export function grabDyFor(
  g: MinimapGeom,
  o: { y: number; scrollTop: number; viewportH: number },
): number | null {
  const band = viewportBand(g, o);
  if (band.height <= 0) return null;
  if (o.y < band.top || o.y > band.top + band.height) return null;
  return o.y - band.top;
}

/**
 * Scroll position a scrub gesture asks for. The whole gesture, in one pure
 * function.
 *
 * `grabDy != null` — dragging the band: its top follows the pointer keeping the
 * grab offset, so the slice under the cursor does not jump when the drag starts.
 *
 * `grabDy == null` — a bare click: the row under the cursor is CENTRED. Centring
 * is what makes "click the red band" land on the change instead of at the edge of
 * the viewport, and quantising through `rowIndexAtOffset` means a scrub always
 * resolves to a real line.
 *
 * Deliberately not `scrollTopForRow`, whose semantics are "the smallest scroll
 * that reveals this row" — it returns the current scrollTop unchanged when the row
 * is already visible, which in a scrub is a dead zone one viewport tall: the
 * pointer would cross the band moving nothing, then jump. Its DOCTRINE is what
 * matters and is kept exactly: the target comes from `heights` by offset
 * arithmetic, never from a `querySelector` + `scrollIntoView` (#68 G10).
 * `scrollTopForRow` stays the function for REVEALING a row — F7 and the line
 * cursor still use it; positioning a viewport is a different operation.
 */
export function scrubScrollTop(
  g: MinimapGeom,
  heights: number[],
  o: { y: number; grabDy: number | null; viewportH: number },
): number {
  const max = Math.max(0, g.contentH - o.viewportH);
  if (g.scale <= 0) return 0;
  if (o.grabDy != null) {
    return clamp(offsetAtMinimapY(g, o.y - o.grabDy), 0, max);
  }
  const i = rowIndexAtOffset(heights, offsetAtMinimapY(g, o.y));
  if (i < 0) return 0;
  const centre = rowOffset(heights, i) + heights[i] / 2;
  return clamp(centre - o.viewportH / 2, 0, max);
}

export interface MinimapBand {
  /** Column envelope of the context rows landing in this device pixel row. */
  ctx: { from: number; to: number } | null;
  /** Column envelope of the CHANGED rows, and which kinds they were. */
  change: { from: number; to: number; kind: "add" | "rem" | "mixed" } | null;
  /** A fold separator landed here — a run of the file that is not rendered. */
  fold: boolean;
}

function widen(
  cur: { from: number; to: number } | null,
  m: MinimapMark,
): { from: number; to: number } | null {
  if (m.to <= m.from) return cur; // blank line: real shape, nothing to draw
  if (!cur) return { from: m.from, to: m.to };
  return { from: Math.min(cur.from, m.from), to: Math.max(cur.to, m.to) };
}

/**
 * Bucket every row into DEVICE PIXEL ROWS, accumulating context and change
 * envelopes separately.
 *
 * Two problems this solves at once, both of which a rect-per-row loop has:
 *
 *  1. 20 000 rows compressed into a 900px gutter give each row 0.045 CSS px, so a
 *     per-row loop issues 20 000 draw calls for at most 1 800 distinct pixels.
 *     Here the paint loop is bounded by the gutter's height instead.
 *  2. In that same file the LAST row to touch a pixel would win, so a lone changed
 *     line could be painted over by the context line after it and vanish. Every
 *     mark claims at least one pixel row (`max(p0 + 1, ceil(y1))`) and changes
 *     accumulate apart from context, so a single changed line among 20 000 is
 *     guaranteed one visible pixel.
 *
 * A pixel row holding both additions and deletions is `mixed`, painted in
 * `--git-modified`: that is what the token means, and it keeps a dense rewrite
 * from resolving to whichever kind happened to come last.
 */
export function buildMinimapBands(o: {
  marks: MinimapMark[];
  heights: number[];
  geom: MinimapGeom;
  dpr: number;
}): MinimapBand[] {
  const { marks, heights, geom, dpr } = o;
  const rows = Math.min(marks.length, heights.length);
  const px = Math.floor(geom.mapH * dpr);
  if (rows === 0 || geom.scale <= 0 || px <= 0) return [];

  const bands: MinimapBand[] = new Array(px);
  for (let i = 0; i < px; i++) bands[i] = { ctx: null, change: null, fold: false };

  const k = geom.scale * dpr;
  let offset = 0;
  for (let i = 0; i < rows; i++) {
    const y0 = offset * k;
    offset += heights[i];
    const y1 = offset * k;
    const p0 = clamp(Math.floor(y0), 0, px - 1);
    const p1 = clamp(Math.max(p0 + 1, Math.ceil(y1)), p0 + 1, px);
    const m = marks[i];
    for (let p = p0; p < p1; p++) {
      const band = bands[p];
      if (m.kind === "fold") {
        band.fold = true;
      } else if (m.kind === "ctx") {
        band.ctx = widen(band.ctx, m);
      } else {
        // A changed row registers even when its content is EMPTY — an added blank
        // line is still an addition, and the painter's minimum-width floor is what
        // makes it visible. `widen` would drop it, which is right for context and
        // wrong here.
        const prev = band.change;
        band.change = {
          from: prev ? Math.min(prev.from, m.from) : m.from,
          to: prev ? Math.max(prev.to, m.to) : m.to,
          kind: prev == null || prev.kind === m.kind ? m.kind : "mixed",
        };
      }
    }
  }
  return bands;
}
