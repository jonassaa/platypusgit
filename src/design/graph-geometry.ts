// Lane geometry for the History commit graph, in SVG user units.
//
// These numbers used to be four separate literals: PGGraphRow's `width = 140`
// default, `12 + col * 16` inside its path math, the PGCommitRow grid's `140px`,
// and History's matching header grid. A lane in column >= 9 was drawn outside
// the 140px viewport and disappeared, dot included — an SVG element is a
// viewport and clips by default, so there was no overflow, no scrollbar, and no
// warning (issue #68 G1). One module, one source of truth.

import type { DateFormat } from "@/lib/commitDate";

/** Left pad before the first lane centre, and the right pad after the last. */
export const GRAPH_PAD = 12;
/** Horizontal distance between adjacent lane centres. */
export const LANE_W = 16;
/** Hard ceiling on gutter width, so a pathological repo can't eat the row. */
export const GRAPH_MAX_W = 240;

/** x centre of a lane column. Node dots and lane strokes share this. */
export const laneX = (col: number): number => GRAPH_PAD + col * LANE_W;

/** Width needed to show every lane up to `maxCol`, clamped to GRAPH_MAX_W. */
export const graphWidth = (maxCol: number): number =>
  Math.min(GRAPH_MAX_W, GRAPH_PAD * 2 + maxCol * LANE_W);

/** True when `maxCol` needs more room than the clamp allows. */
export const isGraphClamped = (maxCol: number): boolean =>
  GRAPH_PAD * 2 + maxCol * LANE_W > GRAPH_MAX_W;

/** Highest column that still fits inside the clamp. */
export const maxVisibleCol = (): number =>
  Math.floor((GRAPH_MAX_W - GRAPH_PAD * 2) / LANE_W);

/**
 * Width of the Date column per date format (#354).
 *
 * Fixed-width monospace, so each entry is sized to the widest string its mode
 * can produce — `12mo ago`, `2026-08-14 13:42`, or both together — with a
 * little slack. `relative` is 90, the pre-#354 width, so the default log is
 * pixel-identical to what it was.
 */
export const DATE_COL_W: Record<DateFormat, number> = {
  relative: 90,
  absolute: 124,
  both: 200,
};

/**
 * Grid template shared by PGCommitRow and History's column header, so the two
 * cannot drift. `graphW === 0` drops the graph column entirely — that is
 * Reflog, which renders no lanes; it is NOT the same as `graphWidth(0)`, the
 * 24px a genuine one-lane log needs.
 *
 * `dateW` is the same drift argument one column over: the Date column grows
 * with the user's date format, and the header and the rows must be told the
 * same number. It defaults to the relative width so a caller with no notion of
 * the setting (tests, any surface that only ever shows "3w ago") gets exactly
 * the old template.
 */
export const commitRowGrid = (graphW: number, dateW: number = DATE_COL_W.relative): string =>
  graphW > 0 ? `${graphW}px 70px 1fr 150px ${dateW}px` : `70px 1fr 150px ${dateW}px`;
