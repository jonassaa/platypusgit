import { describe, expect, it } from "vitest";
import { flattenDiffRows, rowOffset, windowVariable } from "./diffRows";
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
    expect(rows.filter((r) => r.hunkIndex === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.hunkIndex === 1)).toHaveLength(4);
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
