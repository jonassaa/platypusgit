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
  | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number }
  /**
   * An unchanged line from OUTSIDE every hunk, synthesized in whole-file mode.
   *
   * A distinct kind rather than a `line` row carrying a sentinel hunkIndex:
   * consumers look up `hunkActions(row.hunkIndex)` and wire
   * `onLineClick(row.hunkIndex, …)`, so a sentinel number would be one missing
   * guard away from staging the wrong hunk. This variant has no hunkIndex to get
   * wrong, and the type checker makes every consumer say what it does with it.
   */
  | { kind: "fill"; line: DiffLineData; h: number };

/**
 * Past this, whole-file mode stays chunked.
 *
 * Synthesizing a row per line of a very large file would fight the performance
 * goal whole-file mode is part of. It matches the tokenizer's own
 * MAX_HIGHLIGHT_LINES, so the ceiling where highlighting stops is also the
 * ceiling where gap filling stops.
 */
export const MAX_WHOLE_FILE_LINES = 20_000;

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

/**
 * Effective 1-based file position of a hunk side, normalizing git's zero-length
 * convention.
 *
 * For a pure deletion git writes `+3,0`, meaning "at the line BEFORE which
 * nothing was added" — new content resumes at 4, not 3. Taking `newStart`
 * literally there is an off-by-one that shifts every filler line number after
 * the hunk.
 */
function effStart(start: number, lines: number): number {
  return lines === 0 ? start + 1 : start;
}

/**
 * Context rows covering one unchanged region between hunks. Both sides advance
 * together, because an unchanged region is identical on both.
 *
 * Returns null when the arithmetic does not check out — a descending range or a
 * line past the end of the text. A whole-file view with wrong line numbers is
 * worse than no whole-file view, so callers degrade to chunked rather than
 * render something plausible and wrong.
 */
function gapRows(o: {
  oldFrom: number;
  newFrom: number;
  count: number;
  lines: string[];
  from: number;
  rowH: number;
  syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
  useNew: boolean;
}): DiffRow[] | null {
  const { oldFrom, newFrom, count, lines, from, rowH, syntax, useNew } = o;
  if (count === 0) return [];
  if (count < 0 || oldFrom < 1 || newFrom < 1 || from < 1) return null;
  if (from - 1 + count > lines.length) return null;
  const side = useNew ? syntax?.new : syntax?.old;
  const rows: DiffRow[] = [];
  for (let i = 0; i < count; i++) {
    const tokens = side?.[from - 1 + i];
    rows.push({
      kind: "fill",
      h: rowH,
      line: {
        kind: "ctx",
        lnL: oldFrom + i,
        lnR: newFrom + i,
        text: lines[from - 1 + i],
        ...(tokens ? { syntax: tokens } : {}),
      },
    });
  }
  return rows;
}

export function flattenDiffRows(
  hunks: FileDiff["hunks"],
  o: {
    headerH: number;
    rowH: number;
    collapsed?: ReadonlySet<number>;
    syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
    /**
     * Whole-file mode: fill the unchanged remainder of the file in around the
     * hunks. Both texts may be null; filling needs at least one.
     */
    wholeFile?: { newText: string | null; oldText: string | null };
  },
): DiffRow[] {
  const { headerH, rowH, collapsed, syntax, wholeFile } = o;

  const hunkRows = (h: FileDiff["hunks"][number], hunkIndex: number): DiffRow[] => {
    const rows: DiffRow[] = [
      { kind: "header", hunkIndex, header: h.header, h: headerH },
    ];
    if (collapsed?.has(hunkIndex)) return rows;
    // changedIndex FIRST, over the whole hunk, before anything slices rows.
    const lines = withWordSpans(
      withSyntax(withChangedIndices(h.lines.map(toUiLine)), syntax),
    );
    for (const line of lines) rows.push({ kind: "line", hunkIndex, line, h: rowH });
    return rows;
  };

  const chunked = (): DiffRow[] => hunks.flatMap(hunkRows);

  // Prefer the new side; a deleted file has only the old one. Either yields the
  // same characters for an unchanged region, which is all filler ever covers.
  const text = wholeFile?.newText ?? wholeFile?.oldText ?? null;
  if (!wholeFile || text == null || hunks.length === 0) return chunked();
  const useNew = wholeFile.newText != null;
  const textLines = text.split("\n");
  // A file ending in a newline splits to a trailing "" that is not a line git
  // would count — left in, it renders one phantom blank row past the end of
  // every well-formed file. Exactly one, so a genuine blank last line survives.
  if (textLines.length > 1 && textLines[textLines.length - 1] === "") {
    textLines.pop();
  }
  if (textLines.length > MAX_WHOLE_FILE_LINES) return chunked();

  const out: DiffRow[] = [];
  let oldAt = 1;
  let newAt = 1;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    const oldStart = effStart(h.oldStart, h.oldLines);
    const newStart = effStart(h.newStart, h.newLines);
    const count = newStart - newAt;
    // The same unchanged region on both sides must be the same length. When it
    // is not, this diff is not the shape assumed here — degrade rather than
    // guess.
    if (oldStart - oldAt !== count) return chunked();
    const gap = gapRows({
      oldFrom: oldAt,
      newFrom: newAt,
      count,
      lines: textLines,
      from: useNew ? newAt : oldAt,
      rowH,
      syntax,
      useNew,
    });
    if (!gap) return chunked();
    out.push(...gap, ...hunkRows(h, i));
    oldAt = oldStart + h.oldLines;
    newAt = newStart + h.newLines;
  }

  const tailFrom = useNew ? newAt : oldAt;
  const tail = gapRows({
    oldFrom: oldAt,
    newFrom: newAt,
    count: textLines.length - tailFrom + 1,
    lines: textLines,
    from: tailFrom,
    rowH,
    syntax,
    useNew,
  });
  if (!tail) return chunked();
  out.push(...tail);
  return out;
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
