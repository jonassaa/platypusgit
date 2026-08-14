// Flat row model for a file diff, plus an exact variable-height window.
//
// A diff mixes two row heights — a hunk header is density-aware chrome, a code
// row is --fs-12 * --lh-code — so the fixed-pitch useWindowedList does not fit.
// Nothing needs measuring though: both heights are KNOWN, so prefix sums give an
// exact window with no DOM reads and no estimation.
//
// `DiffLineData` is imported TYPE-ONLY on purpose. src/design/PGWindowedDiff.tsx
// imports DiffRow from this module, so a value import of the design barrel here
// would close a runtime require cycle; `import type` is erased and cannot.
import type { DiffLineData } from "@/design";
import type { SyntaxLine, SyntaxToken } from "./syntax";
import type { WindowRange } from "./useWindowedList";
import type { FileDiff } from "./types";
import { pairChangedLines } from "./pairChangedLines";

export type DiffRow =
  | { kind: "header"; hunkIndex: number; header: string; h: number }
  | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number };

/**
 * Number the changed (+/-) lines of a hunk from 0, leaving context unnumbered.
 *
 * Moved here from git-components so the flat model and PGHunk share ONE
 * definition. It must count exactly the add/rem rows: it is the wire contract
 * shared with the backend's Patch::line_in_hunk, which counts +/- origins the
 * same way, and it is numbered over the WHOLE hunk — numbering a windowed slice
 * would address the wrong line when staging (#61 D7).
 */
export function withChangedIndices(lines: DiffLineData[]): DiffLineData[] {
  let n = 0;
  return lines.map((l) =>
    l.kind === "add" || l.kind === "rem" ? { ...l, changedIndex: n++ } : l,
  );
}

function toUiLine(l: FileDiff["hunks"][number]["lines"][number]): DiffLineData {
  const k = l.kind.kind;
  if (k === "Addition") return { kind: "add", lnR: l.newLineno ?? undefined, text: l.content };
  if (k === "Deletion") return { kind: "rem", lnL: l.oldLineno ?? undefined, text: l.content };
  return {
    kind: "ctx",
    lnL: l.oldLineno ?? undefined,
    lnR: l.newLineno ?? undefined,
    text: l.content,
  };
}

/**
 * Attach intra-line spans to adjacent rem/add runs, through the shared rule.
 *
 * Works on the flat line list rather than PGHunk's kind-grouped chunks, so it
 * scans for a removed run followed immediately by an added one.
 */
export function withWordSpans(lines: DiffLineData[]): DiffLineData[] {
  const out = lines.map((l) => ({ ...l }));
  let i = 0;
  while (i < out.length) {
    if (out[i].kind !== "rem") {
      i++;
      continue;
    }
    let r = i;
    while (r < out.length && out[r].kind === "rem") r++;
    let a = r;
    while (a < out.length && out[a].kind === "add") a++;
    if (a > r) {
      const paired = pairChangedLines(
        out.slice(i, r).map((l) => l.text ?? ""),
        out.slice(r, a).map((l) => l.text ?? ""),
      );
      paired.forEach((p, k) => {
        if (!p) return;
        out[i + k].spans = p.old;
        out[r + k].spans = p.new;
      });
    }
    i = a > i ? a : i + 1;
  }
  return out;
}

/** Same side rule as everywhere else: rem reads the old file, add and ctx the new. */
export function withSyntax(
  lines: DiffLineData[],
  syntax: { old: SyntaxLine[] | null; new: SyntaxLine[] | null } | undefined,
): DiffLineData[] {
  if (!syntax) return lines;
  return lines.map((l) => {
    const side = l.kind === "rem" ? syntax.old : syntax.new;
    if (!side) return l;
    const raw = l.kind === "rem" ? l.lnL : (l.lnR ?? l.lnL);
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1) return l;
    const tokens: SyntaxToken[] | undefined = side[n - 1];
    return tokens ? { ...l, syntax: tokens } : l;
  });
}

export function flattenDiffRows(
  hunks: FileDiff["hunks"],
  o: {
    headerH: number;
    rowH: number;
    collapsed?: ReadonlySet<number>;
    syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
  },
): DiffRow[] {
  const { headerH, rowH, collapsed, syntax } = o;
  const rows: DiffRow[] = [];
  hunks.forEach((h, hunkIndex) => {
    rows.push({ kind: "header", hunkIndex, header: h.header, h: headerH });
    if (collapsed?.has(hunkIndex)) return;
    // changedIndex FIRST, over the whole hunk, before anything slices rows.
    const lines = withWordSpans(
      withSyntax(withChangedIndices(h.lines.map(toUiLine)), syntax),
    );
    for (const line of lines) rows.push({ kind: "line", hunkIndex, line, h: rowH });
  });
  return rows;
}

export function rowOffset(heights: number[], index: number): number {
  let sum = 0;
  for (let i = 0; i < index && i < heights.length; i++) sum += heights[i];
  return sum;
}

/**
 * Window a list of known-height rows. Returns the same shape useWindowedList
 * produces, so consumers and the `window?: WindowRange` prop are unchanged.
 */
export function windowVariable(
  heights: number[],
  o: { scrollTop: number; viewportH: number; overscan: number },
): WindowRange {
  const { scrollTop, overscan } = o;
  if (heights.length === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  // Before first layout the viewport measures 0. Render a screenful anyway so the
  // list is never blank on first paint and e2e can find a row immediately.
  const viewportH = o.viewportH || 400;

  let first = 0;
  let acc = 0;
  while (first < heights.length && acc + heights[first] <= scrollTop) {
    acc += heights[first];
    first++;
  }
  let topPad = acc;
  let start = first;
  for (let k = 0; k < overscan && start > 0; k++) {
    start--;
    topPad -= heights[start];
  }

  let end = first;
  let filled = acc - scrollTop; // partial height of the first visible row
  while (end < heights.length && filled < viewportH) {
    filled += heights[end];
    end++;
  }
  for (let k = 0; k < overscan && end < heights.length; k++) end++;

  const total = heights.reduce((a, b) => a + b, 0);
  const rendered = heights.slice(start, end).reduce((a, b) => a + b, 0);
  return { start, end, topPad, bottomPad: Math.max(0, total - topPad - rendered) };
}
