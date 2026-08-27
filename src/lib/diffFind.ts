// Find-in-diff, over the ROW MODEL rather than the rendered window.
//
// Why this exists at all is the same reason `lib/diffCopy.ts` does: every diff
// surface is windowed, so only about a screenful of rows is in the document at
// any moment. The webview's own find would therefore search a few dozen rows and
// report "no results" for a match two thousand lines down — not a degraded
// answer, a wrong one. These helpers scan `DiffRow[]`, which is the whole file,
// and hand back positions the surfaces reach BY OFFSET (`scrollTopForRow`).
//
// Pure and DOM-free on purpose: the hook that drives it (`features/diff/
// useDiffFind.ts`) owns the React state and the scrolling, and everything worth
// pinning about matching, counting and wrapping is pinned here.
import type { DiffRow } from "./diffRows";

/** One match, addressed in the flat row model's index space. */
export interface DiffFindMatch {
  /**
   * Index into the flat `DiffRow[]` — NOT into the rendered window, and not a
   * `changedIndex`. This is what `scrollTopForRow` addresses.
   */
  rowIndex: number;
  /** Character offsets into the row's `line.text`. */
  start: number;
  end: number;
}

/**
 * A highlight range handed to a renderer. `active` marks the ONE match the
 * cursor sits on, which every surface must draw differently — a find that
 * highlights ten matches identically cannot tell you which one Enter just moved
 * you to.
 */
export interface FindMark {
  start: number;
  end: number;
  active?: boolean;
}

export interface DiffFindResult {
  matches: DiffFindMatch[];
  /** True when the scan stopped at `MAX_FIND_MATCHES` and the count is a floor. */
  truncated: boolean;
}

/**
 * Ceiling on collected matches.
 *
 * A one-character query over a whole-file diff of `MAX_WHOLE_FILE_LINES` rows can
 * match hundreds of thousands of times, and the scan re-runs on every keystroke.
 * Scanning that much text is cheap; ALLOCATING that many match objects is not, so
 * the collection stops and the count is reported as a floor ("5000+"). Nobody
 * navigates match 6000 of 400000 — they type another character.
 */
export const MAX_FIND_MATCHES = 5000;

/**
 * The text of a row as the reader sees it, or null for a row that has none.
 *
 * `fold` rows are chrome (a separator naming a hidden run), so they are not
 * searchable — the lines they hide are not on screen to be found. A trailing
 * newline is dropped: `DiffLine.content` is git's raw line, so it usually carries
 * one, and it is not something the reader can see or would mean to search for.
 * Dropping it from the END cannot shift any earlier offset, so match positions
 * still index straight into `line.text`.
 */
export function rowFindText(row: DiffRow): string | null {
  if (row.kind === "fold") return null;
  const text = row.line.text;
  if (text == null) return null;
  return text.replace(/\r?\n$/, "");
}

/**
 * Every match of `query` in the row model, in reading order.
 *
 * Matches are non-overlapping and left-to-right, the way every editor's find
 * counts them: a search for "aa" in "aaaa" is two matches, not three.
 *
 * An empty query is not a search — it returns nothing rather than one zero-width
 * match per row, which is what an unguarded `indexOf("")` loop produces.
 */
export function findDiffMatches(
  rows: readonly DiffRow[],
  query: string,
  o?: { caseSensitive?: boolean },
): DiffFindResult {
  const matches: DiffFindMatch[] = [];
  if (query.length === 0) return { matches, truncated: false };
  const caseSensitive = o?.caseSensitive ?? false;
  const needle = caseSensitive ? query : query.toLowerCase();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const raw = rowFindText(rows[rowIndex]);
    if (raw == null || raw.length === 0) continue;
    const hay = caseSensitive ? raw : raw.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ rowIndex, start: at, end: at + needle.length });
      if (matches.length >= MAX_FIND_MATCHES) return { matches, truncated: true };
      from = at + needle.length;
    }
  }
  return { matches, truncated: false };
}

/**
 * The next/previous match index, WRAPPING at both ends.
 *
 * `current` is `-1` for "no cursor yet" — the state right after a query is typed
 * and before anything has been stepped. From there forward means the first match
 * and backward means the last, so ⇧Enter as the first keypress lands at the end
 * of the file rather than doing nothing.
 */
export function stepMatch(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (((base + delta) % count) + count) % count;
}

/**
 * Index of the first match at or after `rowIndex`, else 0.
 *
 * Opening the find bar deep inside a file should not yank the reader back to the
 * top of it, so the cursor starts at the first match from where they are reading.
 * Wrapping to 0 when nothing follows is the same wrap `stepMatch` does.
 */
export function firstMatchFrom(
  matches: readonly DiffFindMatch[],
  rowIndex: number,
): number {
  if (matches.length === 0) return -1;
  const at = matches.findIndex((m) => m.rowIndex >= rowIndex);
  return at < 0 ? 0 : at;
}

/**
 * Matches grouped by row, with the active one flagged — the shape a renderer
 * wants.
 *
 * A `Map` rather than an array per row: only rows that MATCH get an entry, so a
 * row with no matches looks up `undefined`, and `undefined` is a stable prop that
 * does not defeat `PGDiffRow`'s `React.memo` for the (usually vast) majority of
 * the window.
 */
export function findMarksByRow(
  matches: readonly DiffFindMatch[],
  activeIndex: number,
): Map<number, FindMark[]> {
  const out = new Map<number, FindMark[]>();
  matches.forEach((m, i) => {
    const arr = out.get(m.rowIndex);
    const mark: FindMark = { start: m.start, end: m.end };
    if (i === activeIndex) mark.active = true;
    if (arr) arr.push(mark);
    else out.set(m.rowIndex, [mark]);
  });
  return out;
}

/**
 * The row occupying scroll offset `y`, by prefix sum over the known heights.
 *
 * Same arithmetic `windowVariable` opens with, and the reason find never reads
 * the DOM to answer "where is the reader": the rows around `y` are frequently
 * unmounted.
 */
export function rowAtOffset(heights: readonly number[], y: number): number {
  if (y <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    acc += heights[i];
    if (acc > y) return i;
  }
  return Math.max(0, heights.length - 1);
}
