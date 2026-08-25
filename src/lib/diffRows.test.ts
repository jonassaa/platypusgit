import { describe, expect, it } from "vitest";
import {
  flattenDiffRows,
  HUNK_LEAD_ROWS,
  hunkExtentRows,
  rowOffset,
  scrollTopForHunk,
  scrollTopForRow,
  windowVariable,
  type DiffRow,
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
  // There is no `@@` header row any more (#157). Two adjacent hunks with a gap
  // between them get one fold separator; a hunk's own lines are all there is.
  it("emits one row per line per hunk, and no header row", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { foldH: 22, rowH: 19 });
    expect(rows.some((r) => (r as { kind: string }).kind === "header")).toBe(false);
    expect(rows[0]).toMatchObject({ kind: "line", hunkIndex: 0, h: 19 });
    expect(rows.filter((r) => r.kind === "line")).toHaveLength(6);
  });

  it("marks each hunk's first CHANGED row as its anchor — the F7 target", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { foldH: 22, rowH: 19 });
    const anchors = rows.flatMap((r, i) =>
      r.kind === "line" && r.hunkAnchor ? [[r.hunkIndex, i, r.line.kind]] : [],
    );
    // hunk(n)'s lines are [ctx, rem, add] — the rem row is the first change.
    expect(anchors).toEqual([
      [0, 1, "rem"],
      [1, 4, "rem"],
    ]);
  });

  it("anchors a hunk with no changed line at all on its first row", () => {
    // Not something git emits, but a caller can construct one — and F7 plus the
    // hunk actions both need every hunk index to have exactly one host.
    const allContext = {
      ...hunk(1),
      lines: [
        { kind: { kind: "Context" as const }, oldLineno: 1, newLineno: 1, content: "a" },
        { kind: { kind: "Context" as const }, oldLineno: 2, newLineno: 2, content: "b" },
      ],
    };
    const rows = flattenDiffRows([allContext], { foldH: 22, rowH: 19 });
    expect(rows.filter((r) => r.kind === "line" && r.hunkAnchor)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "line", hunkAnchor: true });
  });

  it("numbers changedIndex over the WHOLE hunk, skipping context", () => {
    const rows = flattenDiffRows([hunk(1)], { foldH: 22, rowH: 19 });
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.changedIndex).toBeUndefined();
    expect(lines[1].kind === "line" && lines[1].line.changedIndex).toBe(0);
    expect(lines[2].kind === "line" && lines[2].line.changedIndex).toBe(1);
  });

  it("restarts changedIndex per hunk, because the backend counts per hunk", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { foldH: 22, rowH: 19 });
    const second = rows.filter((r) => r.kind === "line" && r.hunkIndex === 1);
    expect(second.map((r) => (r.kind === "line" ? r.line.changedIndex : null))).toEqual([
      undefined,
      0,
      1,
    ]);
  });

  it("drops every gap marker when the two sides disagree structurally", () => {
    // hunk(2) starts BEFORE hunk(1) ends, so the gap arithmetic is nonsense and
    // no fold count would be trustworthy — the ladder's bottom rung.
    const rows = flattenDiffRows([hunk(1), hunk(2)], { foldH: 22, rowH: 19 });
    expect(rows.every((r) => r.kind === "line")).toBe(true);
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
      { foldH: 22, rowH: 19 },
    );
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.spans?.some((s) => s.changed)).toBe(true);
    expect(lines[1].kind === "line" && lines[1].line.spans?.some((s) => s.changed)).toBe(true);
  });

  it("attaches syntax tokens by side: rem from old, add and ctx from new", () => {
    const rows = flattenDiffRows([hunk(1)], {
      foldH: 22,
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

/**
 * The `@@` #157 missed (#161).
 *
 * `diff_to_file_diffs` (the backend's COMMIT-diff builder) prints with
 * `DiffFormat::Patch` and pushes libgit2's `'H'` line into the hunk's own
 * `lines[]` as `DiffLineKind::HunkHeader` — so `@@ -1,3 +1,3 @@` arrives as an
 * ordinary entry in the line list, nothing to do with the banner #157 deleted.
 * `toUiLine` maps every non-add/rem kind to `ctx`, so it used to render as a
 * context row whose text is the `@@` range.
 *
 * The kind stays on the wire: `git/lfs.rs` reads `HunkHeader` to tell a pointer
 * diff from a real one. The drop is frontend-side, and it is HERE rather than in a
 * renderer because there are two renderers (`PGWindowedDiff` and
 * `CommitDiffPanel`'s own) and a fix in one would leave the other broken.
 */
describe("flattenDiffRows hunk-header lines", () => {
  /** Byte-for-byte what the backend hands over, trailing newline included. */
  const header = (n: number): FileDiff["hunks"][number]["lines"][number] => ({
    kind: { kind: "HunkHeader" },
    oldLineno: null,
    newLineno: null,
    content: `@@ -${n},3 +${n},3 @@\n`,
  });
  const headered = (n: number): FileDiff["hunks"][number] => ({
    ...hunk(n),
    lines: [header(n), ...hunk(n).lines],
  });

  it("emits no row for the header line, so no `@@` reaches a renderer", () => {
    const rows = flattenDiffRows([headered(1)], { foldH: 22, rowH: 19 });
    expect(rows).toHaveLength(3);
    const text = rows.map((r) => (r.kind === "line" ? r.line.text : "")).join("\n");
    expect(text).not.toContain("@@");
  });

  /**
   * The one thing that would silently corrupt staging, so it is asserted rather
   * than assumed: `changedIndex` is the ONLY index `stage_lines` /
   * `unstage_lines` / `discard_lines` accept, and it is read off the row.
   * `withChangedIndices` counts `+`/`-` lines only and a header line is neither,
   * so dropping one cannot renumber them.
   */
  it("leaves changedIndex — and every other row field — untouched", () => {
    const withHeader = flattenDiffRows([headered(1)], { foldH: 22, rowH: 19 });
    const without = flattenDiffRows([hunk(1)], { foldH: 22, rowH: 19 });
    expect(withHeader).toEqual(without);
    expect(
      withHeader.map((r) => (r.kind === "line" ? [r.line.kind, r.line.changedIndex] : null)),
    ).toEqual([
      ["ctx", undefined],
      ["rem", 0],
      ["add", 1],
    ]);
  });

  /**
   * `rowIndex` DOES shift, and that is fine — it is derived. But every surface
   * derives its heights array from `rows` too (`rows.map((r) => r.h)`), and
   * `scrollTopForRow` / `hunkExtentRows` / F7 all address the flat array, so the
   * two must be built from the same filtered list. A stale heights array is what
   * renders a blank strip or scrolls to the wrong row.
   */
  it("keeps the heights array and the extent map in step with the filtered rows", () => {
    const rows = flattenDiffRows([headered(1), headered(2)], { foldH: 22, rowH: 19 });
    const heights = rows.map((r) => r.h);
    expect(heights).toEqual([19, 19, 19, 19, 19, 19]);
    // Extents start at the two rem rows — not at rows 2 and 5, where they would
    // sit if the header rows were still occupying an index each.
    expect(hunkExtentRows(rows)).toEqual([
      { first: 1, last: 2 },
      { first: 4, last: 5 },
    ]);
    expect(rowOffset(heights, 4)).toBe(76);
    expect(scrollTopForRow(heights, 4, { scrollTop: 0, viewportH: 40 })).toBe(55);
  });

  it("does not disturb whole-file gap arithmetic", () => {
    const changed: FileDiff["hunks"][number]["lines"] = [
      { kind: { kind: "Deletion" }, oldLineno: 4, newLineno: null, content: "old four" },
      { kind: { kind: "Addition" }, oldLineno: null, newLineno: 4, content: "new four" },
    ];
    const base = { header: "@@ -4,1 +4,1 @@", oldStart: 4, oldLines: 1, newStart: 4, newLines: 1 };
    const opts = {
      foldH: 22,
      rowH: 19,
      gaps: "fill" as const,
      text: {
        newText: "one\ntwo\nthree\nnew four\nfive\nsix",
        oldText: "one\ntwo\nthree\nold four\nfive\nsix",
      },
    };
    const withHeader = flattenDiffRows([{ ...base, lines: [header(4), ...changed] }], opts);
    const without = flattenDiffRows([{ ...base, lines: changed }], opts);
    expect(withHeader).toEqual(without);
    expect(withHeader.filter((r) => r.kind === "fill")).toHaveLength(5);
  });

  it("leaves a header-only hunk with no rows and no extent to address", () => {
    // Not something git emits — but the guard matters, because `scrollToHunk`
    // and the action cluster both look a hunk index up in the extent map.
    const rows = flattenDiffRows([{ ...hunk(1), lines: [header(1)] }], {
      foldH: 22,
      rowH: 19,
    });
    expect(rows).toEqual([]);
    expect(hunkExtentRows(rows)).toEqual([]);
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
      foldH: 22,
      rowH: 19,
      text: { newText, oldText },
      gaps: "fill",
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
    const plain = flattenDiffRows(oneChange, { foldH: 22, rowH: 19 });
    const rows = whole(oneChange, NEW_TEXT, OLD_TEXT);
    const lines = (rs: ReturnType<typeof flattenDiffRows>) =>
      rs.filter((r) => r.kind === "line");
    expect(lines(rows)).toEqual(lines(plain));
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
    expect(rows).toEqual(flattenDiffRows(oneChange, { foldH: 22, rowH: 19 }));
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
      flattenDiffRows(oneChange, { foldH: 22, rowH: 19 }),
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
      foldH: 22,
      rowH: 19,
      text: { newText: NEW_TEXT, oldText: OLD_TEXT },
      gaps: "fill",
      // New-side line 1 is "one"; filler reads the new side.
      syntax: { old: null, new: [[{ start: 0, end: 3, cls: "syn-keyword" }]] },
    });
    expect(fillsOf(rows)[0].syntax?.[0].cls).toBe("syn-keyword");
  });
});

// Chunked mode's answer to the `@@` banner (#157): the gap is real there, so it is
// named — how much is hidden and where it resumes — and it can be expanded.
describe("flattenDiffRows fold separators", () => {
  const h = (
    oldStart: number,
    newStart: number,
  ): FileDiff["hunks"][number] => ({
    header: `@@ -${oldStart},1 +${newStart},1 @@`,
    oldStart,
    oldLines: 1,
    newStart,
    newLines: 1,
    lines: [
      { kind: { kind: "Deletion" }, oldLineno: oldStart, newLineno: null, content: `old ${oldStart}` },
      { kind: { kind: "Addition" }, oldLineno: null, newLineno: newStart, content: `new ${newStart}` },
    ],
  });
  // Lines 3 and 6 of an 8-line file changed.
  const twoChanges = [h(3, 3), h(6, 6)];
  const TEXT = "1\n2\nnew 3\n4\n5\nnew 6\n7\n8";
  const foldsOf = (rows: DiffRow[]) => rows.flatMap((r) => (r.kind === "fold" ? [r] : []));
  const chunked = (o?: { text?: string | null; expandedGaps?: ReadonlySet<number> }) =>
    flattenDiffRows(twoChanges, {
      foldH: 22,
      rowH: 19,
      gaps: "fold",
      ...(o?.text === undefined ? {} : { text: { newText: o.text, oldText: null } }),
      expandedGaps: o?.expandedGaps,
    });

  it("names the leading and inter-hunk gaps with their length and range", () => {
    expect(foldsOf(chunked()).map((f) => [f.gapIndex, f.hiddenLines, f.fromR])).toEqual([
      [0, 2, 1], // lines 1–2 before the first change
      [1, 2, 4], // lines 4–5 between the two
    ]);
  });

  it("emits no trailing separator without the text, because its length is unknowable", () => {
    expect(foldsOf(chunked()).map((f) => f.gapIndex)).not.toContain(2);
  });

  it("emits the trailing separator once the text is there", () => {
    const folds = foldsOf(chunked({ text: TEXT }));
    expect(folds.map((f) => [f.gapIndex, f.hiddenLines, f.fromR])).toEqual([
      [0, 2, 1],
      [1, 2, 4],
      [2, 2, 7], // lines 7–8 after the last change
    ]);
  });

  it("carries no hunkIndex, so a fold can never reach a staging path", () => {
    for (const f of foldsOf(chunked({ text: TEXT }))) {
      expect("hunkIndex" in f).toBe(false);
    }
  });

  it("expands one gap in place, leaving the others folded", () => {
    const rows = chunked({ text: TEXT, expandedGaps: new Set([1]) });
    expect(rows.flatMap((r) => (r.kind === "fill" ? [r.line.text] : []))).toEqual([
      "4",
      "5",
    ]);
    expect(foldsOf(rows).map((f) => f.gapIndex)).toEqual([0, 2]);
  });

  it("still folds an expanded gap when there is no text to expand from", () => {
    const rows = chunked({ expandedGaps: new Set([1]) });
    expect(rows.some((r) => r.kind === "fill")).toBe(false);
    expect(foldsOf(rows).map((f) => f.gapIndex)).toEqual([0, 1]);
  });
});

describe("hunkExtentRows", () => {
  const hunkAt = (n: number): FileDiff["hunks"][number] => ({
    header: `@@ -${n},1 +${n},1 @@`,
    oldStart: n,
    oldLines: 1,
    newStart: n,
    newLines: 1,
    lines: [
      { kind: { kind: "Context" }, oldLineno: n, newLineno: n, content: "ctx" },
      { kind: { kind: "Deletion" }, oldLineno: n, newLineno: null, content: "old" },
      { kind: { kind: "Addition" }, oldLineno: null, newLineno: n, content: "new" },
    ],
  });

  it("brackets each hunk's FIRST and LAST changed rows, in FLAT row indices", () => {
    // Gap rows shift the flat indices, which is exactly why F7 cannot compute
    // this itself from a hunk index.
    const rows = flattenDiffRows([hunkAt(4), hunkAt(9)], { foldH: 22, rowH: 19 });
    const extents = hunkExtentRows(rows);
    expect(extents).toHaveLength(2);
    for (const [hunkIndex, { first, last }] of extents.entries()) {
      const a = rows[first];
      const b = rows[last];
      expect(a.kind === "line" && a.hunkIndex).toBe(hunkIndex);
      expect(a.kind === "line" && a.hunkAnchor).toBe(true);
      expect(b.kind === "line" && b.hunkIndex).toBe(hunkIndex);
      expect(b.kind === "line" && b.hunkLast).toBe(true);
      // The del and the add. The LEADING context row is outside the extent —
      // centring the whole hunk instead would drag the midpoint off the change
      // by however many lines `-U` happened to emit.
      expect(last - first).toBe(1);
    }
  });

  it("collapses to a single row when the hunk changes one line", () => {
    const rows = flattenDiffRows(
      [
        {
          header: "@@ -4,1 +4,1 @@",
          oldStart: 4,
          oldLines: 1,
          newStart: 4,
          newLines: 1,
          lines: [
            { kind: { kind: "Context" }, oldLineno: 3, newLineno: 3, content: "before" },
            { kind: { kind: "Addition" }, oldLineno: null, newLineno: 4, content: "new" },
            { kind: { kind: "Context" }, oldLineno: 4, newLineno: 5, content: "after" },
          ],
        },
      ],
      { foldH: 22, rowH: 19 },
    );
    const [extent] = hunkExtentRows(rows);
    // One row wears both markers — which is why PGWindowedDiff stamps them from
    // a single branch, and why wrap mode's `last` lookup may return the anchor.
    expect(extent.first).toBe(extent.last);
    const row = rows[extent.first];
    expect(row.kind === "line" && row.hunkAnchor).toBe(true);
    expect(row.kind === "line" && row.hunkLast).toBe(true);
    // The TRAILING context row is outside it, for the same reason as the leading
    // one — otherwise every extent would be three lines longer than its change.
    expect(extent.last).toBe(rows.length - 2);
  });

  it("spans the CONTEXT sitting between two change runs in one hunk", () => {
    // git merges runs less than 2 x -U apart into a single hunk, so an extent is
    // NOT necessarily a solid block of +/-. F7 addresses the hunk and
    // Stage/Discard act on all of it, so the unchanged rows in the middle are
    // part of what gets centred.
    const rows = flattenDiffRows(
      [
        {
          header: "@@ -1,7 +1,7 @@",
          oldStart: 1,
          oldLines: 7,
          newStart: 1,
          newLines: 7,
          lines: [
            { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "a" },
            { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "b" },
            { kind: { kind: "Context" }, oldLineno: 3, newLineno: 2, content: "c" },
            { kind: { kind: "Context" }, oldLineno: 4, newLineno: 3, content: "d" },
            { kind: { kind: "Context" }, oldLineno: 5, newLineno: 4, content: "e" },
            { kind: { kind: "Addition" }, oldLineno: null, newLineno: 5, content: "f" },
            { kind: { kind: "Context" }, oldLineno: 6, newLineno: 6, content: "g" },
          ],
        },
      ],
      { foldH: 22, rowH: 19 },
    );
    const [extent] = hunkExtentRows(rows);
    // del, ctx, ctx, ctx, add — five rows, with a context row at the very middle.
    expect(extent.last - extent.first).toBe(4);
  });

  it("is empty for an empty diff", () => {
    expect(hunkExtentRows([])).toEqual([]);
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

describe("scrollTopForHunk", () => {
  // Twenty 20px rows (400px of content) in a 200px, ten-row viewport.
  const hs = Array.from({ length: 20 }, () => 20);
  const centre = (first: number, last: number, scrollTop = 0, viewportH = 200) =>
    scrollTopForHunk(hs, { first, last }, { scrollTop, viewportH, rowH: 20 });

  it("puts the middle of the change on the middle of the viewport", () => {
    // Rows 8-9 span 160..200, so their midpoint is 180. A 200px viewport starting
    // at 80 is centred on 180 too.
    expect(centre(8, 9)).toBe(80);
  });

  it("centres the WHOLE extent, not its first row", () => {
    // Same starting row, different amounts of change below it: the answer moves,
    // which is the whole difference between this and parking the anchor.
    expect(centre(8, 9)).toBe(80);
    expect(centre(8, 13)).toBe(120);
  });

  it("repositions a change that is ALREADY fully visible", () => {
    // Where this parts company with scrollTopForRow: F7 puts the change in the
    // same physical spot every time, rather than leaving it wherever the previous
    // scroll happened to strand it — bottom edge, top edge, or anywhere else.
    expect(scrollTopForRow(hs, 8, { scrollTop: 100, viewportH: 200 })).toBe(100);
    expect(centre(8, 9, 100)).toBe(80);
  });

  it("clamps at the top of the file rather than scrolling negative", () => {
    expect(centre(0, 1)).toBe(0);
    expect(centre(1, 2, 300)).toBe(0);
  });

  it("clamps at the end of the file, where nothing could centre it", () => {
    // Rows 18-19 want scrollTop 280; 400px of content in a 200px viewport tops
    // out at 200, so the last hunks in a file land low rather than centred. There
    // is no scroll position that would centre them, and buying one with
    // scroll-past-end space would cost the `contentH === sum(heights)` invariant
    // that windowing depends on. Overshooting is worse than useless: the DOM
    // CLAMPS the write, and scrollToHunk reads the mismatch as "the reveal did
    // not land", quietly costing the file its auto-open.
    expect(centre(18, 19)).toBe(200);
  });

  it("falls back to a lead-in above a change TALLER than the viewport", () => {
    // Rows 8-19 are 240px of change in a 200px viewport: centring would hide the
    // start of it, so the top parks HUNK_LEAD_ROWS rows down instead and the
    // reader scrolls from the beginning.
    expect(centre(8, 19)).toBe((8 - HUNK_LEAD_ROWS) * 20);
  });

  it("switches to that fallback ONLY when the change cannot fit", () => {
    // Exactly ten rows fills the viewport exactly: still centred, flush at both
    // edges.
    expect(centre(5, 14)).toBe(100);
    // Eleven rows cannot, so it top-parks: 100 - 4 x 20.
    expect(centre(5, 15)).toBe(20);
    // Eight rows fit with 40px to spare, and MUST still centre. The tempting
    // branchless form `min(centre, top - lead)` fails exactly here — it would
    // answer 20 and shove the bottom of a change that fits off the screen.
    expect(centre(5, 12)).toBe(80);
  });

  it("caps the lead so a short pane cannot hide the change", () => {
    // A 60px viewport with the full 80px lead would put row 9 (offset 180) at
    // scrollTop 100 — showing 100..160, with the change off the bottom.
    expect(centre(9, 15, 0, 60)).toBe(140);
    // One row tall: no lead at all, change flush with the top.
    expect(centre(9, 15, 0, 20)).toBe(180);
  });

  it("measures the lead in PIXELS, not in preceding rows", () => {
    // A header (26) then two code rows (18), then another header, then ten code
    // rows. The extent is rows 4-13 — 180px of change in a 100px viewport, so the
    // lead-in branch applies. Row 4 starts at 88, and the four rows above it are
    // 88px tall together: a rows-based lead would eat the whole thing and answer
    // 0, flush with the top. 4 x rowH is 72px, which asks for 16 and snaps to the
    // row boundary at 26.
    const mixed = [26, 18, 18, 26, ...Array.from({ length: 10 }, () => 18)];
    expect(scrollTopForHunk(mixed, { first: 4, last: 13 }, {
      scrollTop: 0,
      viewportH: 100,
      rowH: 18,
    })).toBe(26);
  });

  it("snaps to a row boundary so neither edge shows a sliced line", () => {
    // Row 3 of [26,18,18,18,18,18] starts at 62; centring one 18px row in a 60px
    // viewport asks for 41, which is 15px into row 1. The nearest boundary is 44.
    const mixed = [26, 18, 18, 18, 18, 18];
    expect(scrollTopForHunk(mixed, { first: 3, last: 3 }, {
      scrollTop: 0,
      viewportH: 60,
      rowH: 18,
    })).toBe(44);
    // Uniform rows: a one-row change in a ten-row viewport centres half a row off
    // a boundary, and ties resolve DOWN so the answer is stable.
    expect(centre(8, 8)).toBe(60);
  });

  it("holds still for an out-of-range extent or an unmeasured viewport", () => {
    // Same guards as scrollTopForRow: jsdom and the first paint both report a
    // 0px viewport, and the auto-open leans on this to try again later.
    expect(centre(-1, -1, 40)).toBe(40);
    expect(centre(20, 20, 40)).toBe(40);
    expect(centre(9, 8, 40)).toBe(40);
    expect(scrollTopForHunk(hs, { first: 9, last: 9 }, {
      scrollTop: 40,
      viewportH: 0,
      rowH: 20,
    })).toBe(40);
  });
});
