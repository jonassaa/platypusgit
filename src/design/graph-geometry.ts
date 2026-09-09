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

/** The short-oid column. Seven hex digits of monospace, plus the gap. */
export const SHA_COL_W = 70;

/**
 * Gutter kept clear at the right of a column whose content can fill it — the
 * subject cell, the author cell, and every caption in History's header.
 *
 * A shared number because it is load-bearing in two places at once: it is what
 * makes a full-width value TRUNCATE instead of touching the column beside it
 * (a 19-character author name ran into the date at every pane width, and the
 * header captions read "AUTHORDATE"), and it is a term in `AUTHOR_MIN_W` — the
 * avatar has to clear the date too.
 */
export const COL_PAD = 10;

/**
 * The narrowest the subject column may become, and the narrowest the author
 * column may become — the row's YIELD ORDER, in two numbers.
 *
 * Every other track is fixed, so before these existed the subject was the only
 * one that could give, and it gave everything: measured in Chrome at 420px, a
 * five-lane row left the subject **22px** while the author name held a rigid
 * 150. The subject is the column people read, so it is the column with a floor,
 * and the author name is what yields instead — down to `AUTHOR_MIN_W`: the
 * avatar (16px), the flex gap after it, and `COL_PAD`, so the narrowest author
 * column is an avatar that still clears the date. The name truncates, then
 * disappears, and the avatar still says who.
 *
 * Anything under the sum of these minimums overflows the pane rather than
 * squeezing further, which drops the DATE column off the right edge — see
 * `COMMIT_LIST_MIN_W`, and the guard in `git-components.narrow.test.tsx` that
 * keeps the two in agreement.
 */
export const SUBJECT_MIN_W = 140;
export const AUTHOR_COL_W = 150;
export const AUTHOR_MIN_W = 16 + 6 + COL_PAD;

/**
 * Floor for what is left of the commit list when a detail panel is dragged
 * open (#162), and therefore the narrowest row the columns above are designed
 * for: exactly `graphWidth(4) + SHA + SUBJECT_MIN + AUTHOR_MIN + DATE`, the
 * five-lane log at the relative date format.
 *
 * It lives here, beside the widths it is the sum of, because that is the only
 * place the arithmetic can be checked.
 */
export const COMMIT_LIST_MIN_W = 420;

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
 *
 * The two `minmax()`es are the whole of the narrow-pane behaviour, and the
 * order they are written in is not free: CSS grid grows a track with a fixed
 * maximum to that maximum BEFORE it hands anything to an `fr` track, so the
 * author column fills to `AUTHOR_COL_W` first and only then does the subject
 * grow past its floor. That is why the author's maximum stays a number rather
 * than a second `fr` — a fractional author track never stops growing, and
 * `fit-content()` sizes each ROW to its own author, which un-aligns the
 * columns from each other and from the header.
 */
export const commitRowGrid = (graphW: number, dateW: number = DATE_COL_W.relative): string => {
  const cols =
    `${SHA_COL_W}px minmax(${SUBJECT_MIN_W}px, 1fr) ` +
    `minmax(${AUTHOR_MIN_W}px, ${AUTHOR_COL_W}px) ${dateW}px`;
  return graphW > 0 ? `${graphW}px ${cols}` : cols;
};
