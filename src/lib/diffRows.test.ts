import { describe, expect, it } from "vitest";
import {
  flattenDiffRows,
  rowOffset,
  scrollTopForRow,
  windowVariable,
} from "./diffRows";
import type { FileDiff } from "./types";

const hunk = (n: number): FileDiff["hunks"][number] => ({
  header: `@@ -${n} +${n} @@`,
  oldStart: n,
  oldLines: 3,
  newStart: n,
  newLines: 3,
  lines: [
    { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx" },
    { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "old" },
    { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "new" },
  ],
});

describe("flattenDiffRows", () => {
  it("emits a header row then one row per line, per hunk", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { headerH: 26, rowH: 19 });
    expect(rows).toHaveLength(8); // 2 headers + 6 lines
    expect(rows[0]).toMatchObject({ kind: "header", hunkIndex: 0, h: 26 });
    expect(rows[1]).toMatchObject({ kind: "line", hunkIndex: 0, h: 19 });
    expect(rows[4]).toMatchObject({ kind: "header", hunkIndex: 1 });
  });

  it("numbers changedIndex over the WHOLE hunk, skipping context", () => {
    const rows = flattenDiffRows([hunk(1)], { headerH: 26, rowH: 19 });
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.changedIndex).toBeUndefined();
    expect(lines[1].kind === "line" && lines[1].line.changedIndex).toBe(0);
    expect(lines[2].kind === "line" && lines[2].line.changedIndex).toBe(1);
  });

  it("restarts changedIndex per hunk, because the backend counts per hunk", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { headerH: 26, rowH: 19 });
    const second = rows.filter((r) => r.kind === "line" && r.hunkIndex === 1);
    expect(second.map((r) => (r.kind === "line" ? r.line.changedIndex : null))).toEqual([
      undefined,
      0,
      1,
    ]);
  });

  it("omits a collapsed hunk's line rows but keeps its header", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], {
      headerH: 26,
      rowH: 19,
      collapsed: new Set([0]),
    });
    expect(rows.filter((r) => r.kind !== "fill" && r.hunkIndex === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.kind !== "fill" && r.hunkIndex === 1)).toHaveLength(4);
  });

  it("attaches word spans to paired rem/add rows", () => {
    const rows = flattenDiffRows(
      [
        {
          header: "@@ -1 +1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [
            { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "let a = 1" },
            { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "let a = 2" },
          ],
        },
      ],
      { headerH: 26, rowH: 19 },
    );
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.spans?.some((s) => s.changed)).toBe(true);
    expect(lines[1].kind === "line" && lines[1].line.spans?.some((s) => s.changed)).toBe(true);
  });

  it("attaches syntax tokens by side: rem from old, add and ctx from new", () => {
    const rows = flattenDiffRows([hunk(1)], {
      headerH: 26,
      rowH: 19,
      syntax: {
        old: [[], [{ start: 0, end: 3, cls: "syn-comment" }]],
        new: [[], [{ start: 0, end: 3, cls: "syn-keyword" }]],
      },
    });
    const lines = rows.filter((r) => r.kind === "line");
    // rem row is old line 2 → old[1]; add row is new line 2 → new[1].
    expect(lines[1].kind === "line" && lines[1].line.syntax?.[0].cls).toBe("syn-comment");
    expect(lines[2].kind === "line" && lines[2].line.syntax?.[0].cls).toBe("syn-keyword");
  });
});

// Whole-file mode fills the unchanged remainder of the file in AROUND the hunks
// the backend returned, rather than asking libgit2 for a huge context — that
// would collapse the file into hunk 0 and break every stage-hunk index.
describe("flattenDiffRows whole-file mode", () => {
  function h(o: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: Array<["ctx" | "add" | "rem", number | null, number | null, string]>;
  }): FileDiff["hunks"][number] {
    const kindOf = { ctx: "Context", add: "Addition", rem: "Deletion" } as const;
    return {
      header: `@@ -${o.oldStart},${o.oldLines} +${o.newStart},${o.newLines} @@`,
      oldStart: o.oldStart,
      oldLines: o.oldLines,
      newStart: o.newStart,
      newLines: o.newLines,
      lines: o.lines.map(([k, ol, nl, content]) => ({
        kind: { kind: kindOf[k] },
        oldLineno: ol,
        newLineno: nl,
        content,
      })),
    };
  }

  // A 6-line file where only line 4 changed, fetched with 0 context lines.
  const oneChange = [
    h({
      oldStart: 4,
      oldLines: 1,
      newStart: 4,
      newLines: 1,
      lines: [
        ["rem", 4, null, "old four"],
        ["add", null, 4, "new four"],
      ],
    }),
  ];
  const NEW_TEXT = "one\ntwo\nthree\nnew four\nfive\nsix";
  const OLD_TEXT = "one\ntwo\nthree\nold four\nfive\nsix";
  const whole = (
    hunks: FileDiff["hunks"],
    newText: string | null,
    oldText: string | null,
  ) =>
    flattenDiffRows(hunks, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText, oldText },
    });
  const fillsOf = (rows: ReturnType<typeof flattenDiffRows>) =>
    rows.flatMap((r) => (r.kind === "fill" ? [r.line] : []));

  it("fills the leading and trailing unchanged regions", () => {
    const rows = whole(oneChange, NEW_TEXT, OLD_TEXT);
    expect(fillsOf(rows).map((l) => l.text)).toEqual([
      "one",
      "two",
      "three",
      "five",
      "six",
    ]);
  });

  it("numbers filler rows on both sides", () => {
    const rows = whole(oneChange, NEW_TEXT, OLD_TEXT);
    expect(fillsOf(rows).map((l) => [l.lnL, l.lnR])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [5, 5],
      [6, 6],
    ]);
  });

  // The staging-safety invariant. Filler must be purely additive: if any hunk row
  // differs, a hunk index or changedIndex has shifted and staging would apply the
  // wrong lines.
  it("leaves hunk rows byte-identical to chunked mode", () => {
    const plain = flattenDiffRows(oneChange, { headerH: 26, rowH: 19 });
    const rows = whole(oneChange, NEW_TEXT, OLD_TEXT);
    expect(rows.filter((r) => r.kind !== "fill")).toEqual(plain);
  });

  it("keeps filler rows out of every hunk, so they can never be staged", () => {
    const rows = whole(oneChange, NEW_TEXT, OLD_TEXT);
    for (const r of rows) {
      if (r.kind === "fill") expect("hunkIndex" in r).toBe(false);
    }
  });

  it("handles a pure-deletion hunk, whose new side is zero-length", () => {
    // Old lines 4-5 deleted from a 6-line file. Git writes +3,0 — the line
    // BEFORE the deletion — so new content resumes at 4, not 3. Reading newStart
    // literally here shifts every filler number after the hunk by one.
    const rows = whole(
      [
        h({
          oldStart: 4,
          oldLines: 2,
          newStart: 3,
          newLines: 0,
          lines: [
            ["rem", 4, null, "four"],
            ["rem", 5, null, "five"],
          ],
        }),
      ],
      "one\ntwo\nthree\nsix",
      "one\ntwo\nthree\nfour\nfive\nsix",
    );
    expect(fillsOf(rows).map((l) => [l.lnL, l.lnR, l.text])).toEqual([
      [1, 1, "one"],
      [2, 2, "two"],
      [3, 3, "three"],
      [6, 4, "six"],
    ]);
  });

  it("handles a pure-addition hunk, whose old side is zero-length", () => {
    const rows = whole(
      [
        h({
          oldStart: 3,
          oldLines: 0,
          newStart: 4,
          newLines: 1,
          lines: [["add", null, 4, "inserted"]],
        }),
      ],
      "one\ntwo\nthree\ninserted\nfour",
      "one\ntwo\nthree\nfour",
    );
    expect(fillsOf(rows).map((l) => [l.lnL, l.lnR, l.text])).toEqual([
      [1, 1, "one"],
      [2, 2, "two"],
      [3, 3, "three"],
      [4, 5, "four"],
    ]);
  });

  it("fills between two hunks", () => {
    const rows = whole(
      [
        h({
          oldStart: 2,
          oldLines: 1,
          newStart: 2,
          newLines: 1,
          lines: [
            ["rem", 2, null, "old two"],
            ["add", null, 2, "new two"],
          ],
        }),
        h({
          oldStart: 5,
          oldLines: 1,
          newStart: 5,
          newLines: 1,
          lines: [
            ["rem", 5, null, "old five"],
            ["add", null, 5, "new five"],
          ],
        }),
      ],
      "one\nnew two\nthree\nfour\nnew five\nsix",
      "one\nold two\nthree\nfour\nold five\nsix",
    );
    expect(fillsOf(rows).map((l) => l.text)).toEqual([
      "one",
      "three",
      "four",
      "six",
    ]);
  });

  it("does not invent a blank row for a file ending in a newline", () => {
    const rows = whole(oneChange, `${NEW_TEXT}\n`, `${OLD_TEXT}\n`);
    expect(fillsOf(rows).map((l) => l.text)).toEqual([
      "one",
      "two",
      "three",
      "five",
      "six",
    ]);
  });

  it("keeps a genuine blank last line", () => {
    const rows = whole(oneChange, `${NEW_TEXT}\n\n`, `${OLD_TEXT}\n\n`);
    expect(fillsOf(rows).map((l) => l.text)).toEqual([
      "one",
      "two",
      "three",
      "five",
      "six",
      "",
    ]);
  });

  it("degrades to chunked rows when the text is too short to fill the gap", () => {
    const rows = whole(oneChange, "one\ntwo", "one\ntwo");
    expect(rows.some((r) => r.kind === "fill")).toBe(false);
    expect(rows).toEqual(flattenDiffRows(oneChange, { headerH: 26, rowH: 19 }));
  });

  it("degrades to chunked rows when the two sides disagree on the gap length", () => {
    const bad = [
      h({
        oldStart: 4,
        oldLines: 1,
        newStart: 9,
        newLines: 1,
        lines: [
          ["rem", 4, null, "old four"],
          ["add", null, 9, "new four"],
        ],
      }),
    ];
    expect(whole(bad, NEW_TEXT, OLD_TEXT).some((r) => r.kind === "fill")).toBe(false);
  });

  it("renders chunked when there is no text at all", () => {
    expect(whole(oneChange, null, null)).toEqual(
      flattenDiffRows(oneChange, { headerH: 26, rowH: 19 }),
    );
  });

  it("falls back to the old side when only it has text, as for a deleted file", () => {
    const rows = whole(oneChange, null, OLD_TEXT);
    expect(fillsOf(rows).map((l) => l.text)).toEqual([
      "one",
      "two",
      "three",
      "five",
      "six",
    ]);
  });

  it("still resolves syntax tokens for filler rows", () => {
    const rows = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: NEW_TEXT, oldText: OLD_TEXT },
      // New-side line 1 is "one"; filler reads the new side.
      syntax: { old: null, new: [[{ start: 0, end: 3, cls: "syn-keyword" }]] },
    });
    expect(fillsOf(rows)[0].syntax?.[0].cls).toBe("syn-keyword");
  });
});

describe("windowVariable", () => {
  const heights = [26, 19, 19, 19, 26, 19, 19]; // 147px total

  it("renders everything that fits plus overscan", () => {
    const w = windowVariable(heights, { scrollTop: 0, viewportH: 1000, overscan: 0 });
    expect(w).toEqual({ start: 0, end: heights.length, topPad: 0, bottomPad: 0 });
  });

  it("skips rows scrolled past and pads for them exactly", () => {
    const w = windowVariable(heights, { scrollTop: 45, viewportH: 38, overscan: 0 });
    expect(w.start).toBe(2);
    expect(w.topPad).toBe(45);
  });

  it("keeps topPad + rendered + bottomPad equal to the total height", () => {
    for (const overscan of [0, 1, 4]) {
      for (const scrollTop of [0, 20, 45, 100, 147]) {
        const w = windowVariable(heights, { scrollTop, viewportH: 38, overscan });
        const rendered = heights.slice(w.start, w.end).reduce((a, b) => a + b, 0);
        expect(w.topPad + rendered + w.bottomPad).toBe(147);
      }
    }
  });

  it("handles an empty list", () => {
    expect(windowVariable([], { scrollTop: 0, viewportH: 100, overscan: 4 })).toEqual({
      start: 0,
      end: 0,
      topPad: 0,
      bottomPad: 0,
    });
  });

  it("renders a screenful before first layout, when the viewport measures 0", () => {
    const w = windowVariable(heights, { scrollTop: 0, viewportH: 0, overscan: 0 });
    expect(w.end).toBeGreaterThan(0);
  });
});

describe("rowOffset", () => {
  it("sums the heights before an index", () => {
    expect(rowOffset([26, 19, 19], 0)).toBe(0);
    expect(rowOffset([26, 19, 19], 2)).toBe(45);
    expect(rowOffset([26, 19, 19], 99)).toBe(64);
  });
});

describe("scrollTopForRow", () => {
  // Ten 20px rows in a 60px viewport — three rows visible at a time.
  const hs = Array.from({ length: 10 }, () => 20);
  const at = (index: number, scrollTop: number) =>
    scrollTopForRow(hs, index, { scrollTop, viewportH: 60 });

  it("leaves the scroll position alone when the row is already fully visible", () => {
    // scrollTop 40 shows rows 2,3,4 (offsets 40..100).
    expect(at(2, 40)).toBe(40);
    expect(at(3, 40)).toBe(40);
    expect(at(4, 40)).toBe(40);
  });

  it("scrolls up to the row's own top when it is above the viewport", () => {
    expect(at(1, 40)).toBe(20);
    expect(at(0, 40)).toBe(0);
  });

  it("scrolls down by the minimum that shows the row's bottom", () => {
    // Row 5 ends at 120; a 60px viewport must start at 60, not jump to the row.
    expect(at(5, 40)).toBe(60);
    expect(at(9, 0)).toBe(140);
  });

  it("holds still for an out-of-range index", () => {
    // The keyboard cursor is -1 before it has moved, and a shrinking diff can
    // leave it past the end — neither may yank the pane to the top.
    expect(at(-1, 40)).toBe(40);
    expect(at(10, 40)).toBe(40);
  });

  it("holds still when the viewport has not been measured yet", () => {
    // jsdom and the first paint both report 0; scrolling on that would compute a
    // position from a viewport that does not exist.
    expect(scrollTopForRow(hs, 9, { scrollTop: 40, viewportH: 0 })).toBe(40);
  });

  it("works with the diff's mixed row heights", () => {
    // A header (26) then two code rows (18), twice.
    const mixed = [26, 18, 18, 26, 18, 18];
    // Row 4 spans 88..106; a 40px viewport at 0 must scroll to 66.
    expect(scrollTopForRow(mixed, 4, { scrollTop: 0, viewportH: 40 })).toBe(66);
    expect(scrollTopForRow(mixed, 0, { scrollTop: 66, viewportH: 40 })).toBe(0);
  });
});
