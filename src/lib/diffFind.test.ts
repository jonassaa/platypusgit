import { describe, expect, it } from "vitest";
import {
  MAX_FIND_MATCHES,
  findDiffMatches,
  findMarksByRow,
  firstMatchFrom,
  rowAtOffset,
  rowFindText,
  stepMatch,
} from "./diffFind";
import { flattenDiffRows } from "./diffRows";
import type { DiffRow } from "./diffRows";
import type { FileDiff } from "./types";

/** A context-only hunk of `n` lines whose text is `line <i>`. */
function ctxHunk(n: number, text: (i: number) => string): FileDiff["hunks"] {
  return [
    {
      header: `@@ -1,${n} +1,${n} @@`,
      oldStart: 1,
      oldLines: n,
      newStart: 1,
      newLines: n,
      lines: Array.from({ length: n }, (_, i) => ({
        kind: { kind: "Context" as const },
        oldLineno: i + 1,
        newLineno: i + 1,
        content: `${text(i)}\n`,
      })),
    },
  ];
}

const rowsOf = (hunks: FileDiff["hunks"]): DiffRow[] =>
  flattenDiffRows(hunks, { foldH: 22, rowH: 19 });

describe("rowFindText", () => {
  it("drops the trailing newline git puts on every line", () => {
    const rows = rowsOf(ctxHunk(1, () => "needle"));
    expect(rows[0].kind).toBe("line");
    expect(rowFindText(rows[0])).toBe("needle");
  });

  it("has no text for a fold separator — the lines it hides are not on screen", () => {
    const fold: DiffRow = {
      kind: "fold",
      gapIndex: 0,
      hiddenLines: 12,
      fromL: 1,
      fromR: 1,
      h: 22,
    };
    expect(rowFindText(fold)).toBeNull();
  });
});

describe("findDiffMatches", () => {
  it("finds a match FAR OUTSIDE any rendered window", () => {
    // The whole point of the feature: a window is a screenful, so a match 2000
    // rows down is not in the document at all. The model has it anyway.
    const rows = rowsOf(ctxHunk(2000, (i) => (i === 1873 ? "the needle" : `line ${i}`)));
    const { matches } = findDiffMatches(rows, "needle");
    expect(matches).toEqual([{ rowIndex: 1873, start: 4, end: 10 }]);
  });

  it("counts every occurrence, including several on one line", () => {
    const rows = rowsOf(ctxHunk(3, (i) => (i === 1 ? "aa bb aa" : "cc")));
    expect(findDiffMatches(rows, "aa").matches).toEqual([
      { rowIndex: 1, start: 0, end: 2 },
      { rowIndex: 1, start: 6, end: 8 },
    ]);
  });

  it("does not overlap matches with themselves", () => {
    const rows = rowsOf(ctxHunk(1, () => "aaaa"));
    expect(findDiffMatches(rows, "aa").matches).toHaveLength(2);
  });

  it("is case-insensitive by default and exact with the toggle on", () => {
    const rows = rowsOf(ctxHunk(2, (i) => (i === 0 ? "Needle" : "needle")));
    expect(findDiffMatches(rows, "needle").matches).toHaveLength(2);
    expect(
      findDiffMatches(rows, "needle", { caseSensitive: true }).matches,
    ).toEqual([{ rowIndex: 1, start: 0, end: 6 }]);
    expect(
      findDiffMatches(rows, "Needle", { caseSensitive: true }).matches,
    ).toEqual([{ rowIndex: 0, start: 0, end: 6 }]);
  });

  it("treats an empty query as no search, not as a match per row", () => {
    const rows = rowsOf(ctxHunk(5, (i) => `line ${i}`));
    expect(findDiffMatches(rows, "")).toEqual({ matches: [], truncated: false });
  });

  it("stops at the ceiling and says the count is a floor", () => {
    const rows = rowsOf(ctxHunk(MAX_FIND_MATCHES + 10, () => "x"));
    const res = findDiffMatches(rows, "x");
    expect(res.matches).toHaveLength(MAX_FIND_MATCHES);
    expect(res.truncated).toBe(true);
  });

  it("never matches the trailing newline", () => {
    const rows = rowsOf(ctxHunk(3, (i) => `line ${i}`));
    expect(findDiffMatches(rows, "\n").matches).toEqual([]);
  });
});

describe("stepMatch", () => {
  it("wraps forward off the end and backward off the start", () => {
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
    expect(stepMatch(3, 0, 1)).toBe(1);
    expect(stepMatch(3, 2, -1)).toBe(1);
  });

  it("enters at the first match forward and the last one backward", () => {
    expect(stepMatch(3, -1, 1)).toBe(0);
    expect(stepMatch(3, -1, -1)).toBe(2);
  });

  it("has no cursor with nothing to step through", () => {
    expect(stepMatch(0, -1, 1)).toBe(-1);
    expect(stepMatch(0, 4, -1)).toBe(-1);
  });
});

describe("firstMatchFrom", () => {
  it("starts at the first match at or after the reader's row", () => {
    const matches = [
      { rowIndex: 2, start: 0, end: 1 },
      { rowIndex: 40, start: 0, end: 1 },
      { rowIndex: 90, start: 0, end: 1 },
    ];
    expect(firstMatchFrom(matches, 0)).toBe(0);
    expect(firstMatchFrom(matches, 3)).toBe(1);
    expect(firstMatchFrom(matches, 90)).toBe(2);
  });

  it("wraps to the top when nothing follows, and has no answer with no matches", () => {
    expect(firstMatchFrom([{ rowIndex: 2, start: 0, end: 1 }], 500)).toBe(0);
    expect(firstMatchFrom([], 0)).toBe(-1);
  });
});

describe("findMarksByRow", () => {
  it("groups by row and flags exactly the active match", () => {
    const matches = [
      { rowIndex: 4, start: 0, end: 2 },
      { rowIndex: 4, start: 6, end: 8 },
      { rowIndex: 9, start: 1, end: 3 },
    ];
    const map = findMarksByRow(matches, 1);
    expect(map.get(4)).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 8, active: true },
    ]);
    expect(map.get(9)).toEqual([{ start: 1, end: 3 }]);
  });

  it("leaves a row with no matches undefined, so a memoized row keeps its prop", () => {
    const map = findMarksByRow([{ rowIndex: 4, start: 0, end: 2 }], 0);
    expect(map.get(5)).toBeUndefined();
  });
});

describe("rowAtOffset", () => {
  it("finds the row at a scroll position by prefix sum, never by the DOM", () => {
    const heights = [19, 19, 22, 19, 19];
    expect(rowAtOffset(heights, 0)).toBe(0);
    expect(rowAtOffset(heights, 18)).toBe(0);
    expect(rowAtOffset(heights, 19)).toBe(1);
    expect(rowAtOffset(heights, 40)).toBe(2);
    expect(rowAtOffset(heights, 10_000)).toBe(4);
  });
});
