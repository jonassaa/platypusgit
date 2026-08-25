// Flat row model for a file diff, plus an exact variable-height window.
//
// A diff mixes two row heights — a fold separator is density-aware chrome, a code
// row is --fs-12 * --lh-code — so the fixed-pitch useWindowedList does not fit.
// Nothing needs measuring though: both heights are KNOWN, so prefix sums give an
// exact window with no DOM reads and no estimation.
//
// There is deliberately NO `@@` header row (#157). Whole-file mode leaves no gap
// for one to label, and where a gap IS real — chunked mode — what the reader needs
// is how much is hidden and a way to show it, which is the `fold` row.
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
  | {
      kind: "line";
      hunkIndex: number;
      line: DiffLineData;
      h: number;
      /**
       * This row is its hunk's ANCHOR: the first changed (`+`/`-`) row, or the
       * hunk's first row when it has no changed one. Exactly one row per hunk
       * carries it (#157).
       *
       * It hosts `data-hunk-index` / `data-hunk-active` for F7 and the hunk's
       * Stage/Discard cluster — both of which used to live on the `@@` header.
       * Additive and independent of `changedIndex`: nothing derives one from the
       * other, and this flag reaches no backend op.
       */
      hunkAnchor?: true;
      /**
       * This row is its hunk's LAST changed (`+`/`-`) row — the other end of the
       * extent F7 centres. Exactly one row per hunk carries it, and it is the
       * ANCHOR ITSELF for a hunk that changes a single line.
       *
       * Hosts `data-hunk-last-index`, which is the only way `DiffViewer`'s wrap
       * mode can measure the extent: `heights` describes nothing there, and every
       * other row in the hunk is anonymous in the DOM.
       */
      hunkLast?: true;
    }
  /**
   * An unchanged line from OUTSIDE every hunk, synthesized in whole-file mode
   * (and for a gap the reader expanded in chunked mode).
   *
   * A distinct kind rather than a `line` row carrying a sentinel hunkIndex:
   * consumers look up `hunkActions(row.hunkIndex)` and wire
   * `onLineClick(row.hunkIndex, …)`, so a sentinel number would be one missing
   * guard away from staging the wrong hunk. This variant has no hunkIndex to get
   * wrong, and the type checker makes every consumer say what it does with it.
   */
  | { kind: "fill"; line: DiffLineData; h: number }
  /**
   * A run of unchanged lines that is NOT rendered — chunked mode's fold
   * separator. Replaces the `@@` banner: it names the amount of file hidden and
   * where it resumes, which is what a reader of a discontinuous file needs.
   *
   * No `hunkIndex`, for the same reason `fill` has none.
   */
  | {
      kind: "fold";
      /** Gap 0 precedes hunk 0; gap N follows hunk N-1. Identifies it to `onExpandGap`. */
      gapIndex: number;
      hiddenLines: number;
      /** 1-based first hidden line, old side. */
      fromL: number;
      /** 1-based first hidden line, new side — what the separator displays. */
      fromR: number;
      h: number;
    };

/**
 * Past this, whole-file mode degrades to fold separators.
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

/**
 * Is this backend line part of the FILE, rather than diff chrome?
 *
 * `diff_to_file_diffs` — the backend's commit-diff builder — prints with
 * `DiffFormat::Patch`, so libgit2's `'H'` line lands inside the hunk's own
 * `lines[]` as `DiffLineKind::HunkHeader`: `@@ -1,3 +1,3 @@` arriving as an
 * ordinary entry in the line list, nothing to do with the `PGHunkHeader` banner
 * #157 deleted. `toUiLine` maps every non-add/rem kind to `ctx`, so it rendered as
 * a context row whose text is the `@@` range — which is why #157 removed the
 * banner and left `@@` on screen (#161). (The working-tree builder, `diff`, drops
 * `'H'` itself, so only commit diffs ever carried one.)
 *
 * Dropped HERE, in the row model, because there are two renderers —
 * `PGWindowedDiff` and `CommitDiffPanel`'s own markup — and a filter in one would
 * leave the other broken.
 *
 * The KIND stays on the wire: `git/lfs.rs` reads `HunkHeader` to reconstruct one
 * side of a diff and to size a candidate pointer, so this is a frontend-side drop
 * and not a backend change.
 */
export function isFileContent(l: FileDiff["hunks"][number]["lines"][number]): boolean {
  return l.kind.kind !== "HunkHeader";
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

export interface FlattenDiffOptions {
  /** Code-row pitch, from `--diff-row-h`. */
  rowH: number;
  /** Fold-separator height. Chrome, so density-aware — see the surfaces. */
  foldH: number;
  syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
  /**
   * The file's two sides in full, when they are available. Both may be null;
   * filling needs at least one. Read by BOTH modes — `"fill"` fills every gap
   * from it, `"fold"` needs it only for a gap the reader expanded and for the
   * length of the trailing remainder.
   */
  text?: { newText: string | null; oldText: string | null };
  /**
   * What to do with an unchanged run between (or around) the hunks.
   *
   * `"fill"` is whole-file mode, the default VIEW: the file reads continuously,
   * so there is no discontinuity and no separator. `"fold"` is chunked mode: each
   * gap becomes one `fold` row naming what it hides. Defaults to `"fold"`, which
   * is also every degradation target — see the ladder below.
   */
  gaps?: "fill" | "fold";
  /** `gaps: "fold"` only — gap indices the reader expanded, filled from `text`. */
  expandedGaps?: ReadonlySet<number>;
}

/**
 * Per-hunk base lines (kind mapping, changedIndex, word spans) and each hunk's
 * anchor index, cached by the hunks ARRAY's identity.
 *
 * None of it depends on syntax, row heights, or gap mode — yet flattenDiffRows
 * is re-run for every one of those (tokens arriving per side, a gap expanded, a
 * density change), and the word diff's LCS is by far the most expensive step of
 * the flatten. One diff object is flattened several times over its life; its
 * hunks array never changes identity, so this computes the invariant part once.
 * Weak, so a superseded diff's lines go with it.
 */
const baseLinesCache = new WeakMap<
  FileDiff["hunks"],
  { lines: DiffLineData[]; anchor: number; last: number }[]
>();

function baseHunkLines(
  hunks: FileDiff["hunks"],
): { lines: DiffLineData[]; anchor: number; last: number }[] {
  const hit = baseLinesCache.get(hunks);
  if (hit) return hit;
  const computed = hunks.map((h) => {
    // Header lines are dropped BEFORE the numbering pass, which cannot renumber
    // anything: withChangedIndices counts `+`/`-` only and a header is neither.
    // Asserted in diffRows.test.ts rather than assumed — changedIndex is the one
    // index the line-staging ops accept.
    // Then changedIndex, over the whole hunk, before anything slices rows.
    const lines = withWordSpans(
      withChangedIndices(h.lines.filter(isFileContent).map(toUiLine)),
    );
    // The hunk's anchor is its first CHANGED row — F7 means "go to the next
    // change", and the Stage/Discard cluster belongs at the change block's top.
    // `last` is its final changed row; the two bracket the extent F7 centres.
    //
    // The span between them can hold CONTEXT: git merges change runs less than
    // 2 x -U apart into one hunk, so a hunk is not necessarily one solid block of
    // `+`/`-`. Centring the whole bracket is deliberate — F7 addresses a hunk and
    // Stage/Discard act on all of it — but it does mean the row at the exact
    // middle is sometimes an unchanged one.
    //
    // A hunk with no changed row is not something git emits, but a caller can
    // construct one, so fall back to the first row: exactly one anchor and one
    // extent end per hunk, unconditionally, or F7 and the actions lose a
    // reachable host.
    const isChanged = (l: DiffLineData) => l.kind === "add" || l.kind === "rem";
    let anchor = lines.findIndex(isChanged);
    let last = anchor;
    for (let i = lines.length - 1; i > anchor; i--) {
      if (isChanged(lines[i])) {
        last = i;
        break;
      }
    }
    if (anchor < 0 && lines.length > 0) anchor = last = 0;
    return { lines, anchor, last };
  });
  baseLinesCache.set(hunks, computed);
  return computed;
}

export function flattenDiffRows(
  hunks: FileDiff["hunks"],
  o: FlattenDiffOptions,
): DiffRow[] {
  const { rowH, foldH, syntax, text, gaps = "fold", expandedGaps } = o;

  const base = baseHunkLines(hunks);
  const hunkRows = (_h: FileDiff["hunks"][number], hunkIndex: number): DiffRow[] => {
    const { lines: baseLines, anchor, last } = base[hunkIndex];
    // Syntax is the one per-flatten input, applied over the cached base. Safe to
    // attach AFTER the word spans: withSyntax spreads each line it touches, so
    // spans and changedIndex ride along untouched.
    const lines = withSyntax(baseLines, syntax);
    return lines.map((line, i) => ({
      kind: "line" as const,
      hunkIndex,
      line,
      h: rowH,
      ...(i === anchor ? { hunkAnchor: true as const } : {}),
      ...(i === last ? { hunkLast: true as const } : {}),
    }));
  };

  /**
   * The floor of the degradation ladder: hunks concatenated with NO gap markers.
   *
   * Only for a structural mismatch — a gap whose two sides disagree on length, or
   * a descending range. The hunk headers are then not the shape assumed here, so
   * a fold row's count would be as wrong as a filler row's line numbers.
   */
  const bare = (): DiffRow[] => hunks.flatMap(hunkRows);

  /**
   * The rung above it: fold separators, no filling. For every text-dependent
   * failure (no text yet, text past the ceiling, text too short) — the structure
   * is sound, only the filling is impossible. Re-entered with `expandedGaps`
   * dropped, so this recurses at most once.
   */
  const folded = (): DiffRow[] =>
    flattenDiffRows(hunks, { ...o, gaps: "fold", expandedGaps: undefined });

  if (hunks.length === 0) return [];

  // Prefer the new side; a deleted file has only the old one. Either yields the
  // same characters for an unchanged region, which is all filler ever covers.
  const src = text?.newText ?? text?.oldText ?? null;
  const useNew = text?.newText != null;
  let textLines: string[] | null = null;
  if (src != null) {
    const l = src.split("\n");
    // A file ending in a newline splits to a trailing "" that is not a line git
    // would count — left in, it renders one phantom blank row past the end of
    // every well-formed file. Exactly one, so a genuine blank last line survives.
    if (l.length > 1 && l[l.length - 1] === "") l.pop();
    // Synthesizing a row per line of a very large file would fight the
    // performance goal whole-file mode is part of.
    if (l.length <= MAX_WHOLE_FILE_LINES) textLines = l;
  }

  const needsText = gaps === "fill" || (expandedGaps?.size ?? 0) > 0;
  if (needsText && textLines === null) return folded();

  /** One gap's rows, or null when the fill arithmetic did not check out. */
  const gapOut = (
    gapIndex: number,
    oldFrom: number,
    newFrom: number,
    count: number,
  ): DiffRow[] | null => {
    if (count <= 0) return count === 0 ? [] : null;
    const fill = gaps === "fill" || !!expandedGaps?.has(gapIndex);
    if (!fill) {
      return [
        { kind: "fold", gapIndex, hiddenLines: count, fromL: oldFrom, fromR: newFrom, h: foldH },
      ];
    }
    if (!textLines) return null;
    return gapRows({
      oldFrom,
      newFrom,
      count,
      lines: textLines,
      from: useNew ? newFrom : oldFrom,
      rowH,
      syntax,
      useNew,
    });
  };

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
    // guess. Structural, so it takes the ladder's bottom rung.
    if (oldStart - oldAt !== count || count < 0) return bare();
    const gap = gapOut(i, oldAt, newAt, count);
    if (!gap) return folded();
    out.push(...gap, ...hunkRows(h, i));
    oldAt = oldStart + h.oldLines;
    newAt = newStart + h.newLines;
  }

  // The trailing remainder. Its length is only knowable from the text, so with no
  // text there is no separator here either: one that cannot say how much it hides
  // is worse than the file simply ending, and a count cannot be invented.
  if (textLines) {
    const tailFrom = useNew ? newAt : oldAt;
    const tailCount = textLines.length - tailFrom + 1;
    // A NEGATIVE tail means the text is shorter than the diff says the file is —
    // so the text cannot compose the file, but the hunk headers are still sound
    // and their gap counts still are too. Hence: fill mode degrades, fold mode
    // simply has no trailing separator to draw. (This asymmetry is also what
    // keeps `folded()` from re-entering itself: fold mode never fails here.)
    if (tailCount > 0) {
      const tail = gapOut(hunks.length, oldAt, newAt, tailCount);
      if (!tail) return folded();
      out.push(...tail);
    } else if (tailCount < 0 && gaps === "fill") {
      return folded();
    }
  }
  return out;
}

/**
 * The two flat row indices bracketing a hunk's CHANGED rows.
 *
 * `first` is the ANCHOR row — the one that hosts `data-hunk-index` and the
 * Stage/Discard cluster — so this subsumes the old anchor-only lookup rather
 * than sitting beside it.
 */
export interface HunkExtent {
  /** Flat index of the hunk's first changed row; `-1` when it has no rows. */
  first: number;
  /** Flat index of its last changed row; equals `first` for a one-line change. */
  last: number;
}

/**
 * Each hunk's extent, indexed by hunk index; `{ first: -1, last: -1 }` for a
 * hunk with no rows at all.
 *
 * The one mapping F7 needs: `useHunkNav` moves a HUNK cursor, and putting that
 * hunk on screen goes through `scrollTopForHunk`, which addresses the flat
 * array. Shared so every diff surface resolves it the same way.
 */
export function hunkExtentRows(rows: DiffRow[]): HunkExtent[] {
  const out: HunkExtent[] = [];
  rows.forEach((row, i) => {
    if (row.kind !== "line") return;
    while (out.length <= row.hunkIndex) out.push({ first: -1, last: -1 });
    if (row.hunkAnchor) out[row.hunkIndex].first = i;
    if (row.hunkLast) out[row.hunkIndex].last = i;
  });
  return out;
}

export function rowOffset(heights: number[], index: number): number {
  let sum = 0;
  for (let i = 0; i < index && i < heights.length; i++) sum += heights[i];
  return sum;
}

/**
 * Smallest `scrollTop` that brings row `index` fully into view, or the current
 * one when it already is.
 *
 * By offset, never by DOM query: a windowed diff usually has the row in question
 * unmounted, so `scrollIntoView` on a `querySelector` result silently does
 * nothing (the #68 G10 trap, restated for variable-height rows). Heights are
 * known exactly, so this needs no measurement.
 *
 * An out-of-range index or an unmeasured viewport (`viewportH <= 0`, which is
 * what jsdom and the first paint report) leaves the scroll position alone rather
 * than jumping to 0.
 */
export function scrollTopForRow(
  heights: number[],
  index: number,
  o: { scrollTop: number; viewportH: number },
): number {
  const { scrollTop, viewportH } = o;
  if (index < 0 || index >= heights.length || viewportH <= 0) return scrollTop;
  const top = rowOffset(heights, index);
  const bottom = top + heights[index];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportH) return bottom - viewportH;
  return scrollTop;
}

/** Rows of lead-in kept above a change too tall to centre. */
export const HUNK_LEAD_ROWS = 4;

/**
 * Largest row boundary at or below `y`, or the next one up when that is nearer.
 *
 * Every scroll target in a diff has always been an exact `rowOffset`, so rows
 * render crisp; a true centre lands mid-row and slices the viewport's top and
 * bottom lines in half. Snapping keeps the pixels clean. Ties go DOWN, so the
 * answer is stable for a given `y`.
 */
function nearestRowBoundary(heights: number[], y: number): number {
  if (y <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < heights.length; i++) {
    const next = acc + heights[i];
    if (next > y) return y - acc <= next - y ? acc : next;
    acc = next;
  }
  return acc;
}

/**
 * Scroll position that CENTRES a hunk's changed extent in the viewport — F7/⇧F7's
 * landing, and the file auto-open's.
 *
 * Three scroll semantics now live side by side, and they are not
 * interchangeable:
 *
 * - `scrollTopForRow` REVEALS: the smallest move that brings a row into view,
 *   unchanged when it already is. The LINE cursor wants exactly that — a cursor
 *   stepping one row should scroll one row.
 * - `scrubScrollTop` (`diffMinimap.ts`) POSITIONS a viewport around a row.
 * - this one CENTRES: the extent's midpoint lands on the viewport's midpoint,
 *   whether the change was off screen, at an edge, or already comfortably
 *   visible. That unconditional move is the point — under reveal semantics F7
 *   walking forward left each change pinned to the BOTTOM edge with no following
 *   context, and one keypress meant two different things depending on where the
 *   previous one had left the pane.
 *
 * The extent is the hunk's FIRST changed row through its LAST, any context
 * between two change runs included (see `baseHunkLines`). NOT the whole hunk:
 * git's leading and trailing context would drag the midpoint off the change by
 * however many lines `-U` happened to emit.
 *
 * A change TALLER than the viewport cannot be centred without hiding its own
 * start, so it degrades to parking its top `HUNK_LEAD_ROWS` rows below the top
 * edge — the reader lands at the beginning of the change, with a hint of file
 * above it, and scrolls down. That branch is the only surviving use of the
 * constant, and it is deliberately a hard `extentH > viewportH` test. Making the
 * transition continuous (`min(centre, top - lead)`) is the obvious refactor and
 * is wrong: the arithmetic makes it start top-parking at
 * `extentH > viewportH - 2 x lead`, pushing the bottom of an extent off screen
 * while that extent still fits.
 *
 * Three details are load-bearing:
 *
 * - The lead is `HUNK_LEAD_ROWS * rowH` PIXELS rather than the height of the
 *   four preceding rows: a tall fold separator directly above a hunk would
 *   otherwise eat the whole lead and park the change at the top after all. It is
 *   capped at `viewportH - rowH`, so a pane shorter than the lead degrades to
 *   "flush with the top", never to "not on screen".
 * - The result snaps to a row boundary, so neither edge of the viewport shows a
 *   half-sliced line.
 * - It is then clamped into `[0, contentH - viewportH]`. Overshooting the end of
 *   the document is not harmless: the DOM clamps the write, and every caller's
 *   `scrollToHunk` reads `scrollTop !== want` as "the reveal did not land",
 *   which costs the file its once-per-file auto-open. `contentH` is the sum of
 *   `heights` — TRUE BY CONSTRUCTION, since `PGWindowedDiff` renders exactly
 *   `topPad + rows + bottomPad` into the scroll container. Putting padding or a
 *   sticky child in there would break this. The clamp is also why a hunk within
 *   half a viewport of either END of the file does not land centred: no scroll
 *   position would put it there, and inventing scroll-past-end space to buy one
 *   would cost the invariant above. F7 still moves the cursor; the pane simply
 *   has nowhere left to go, and everything is on screen anyway.
 *
 * An out-of-range extent or an unmeasured viewport (`viewportH <= 0`, which is
 * what jsdom and the first paint report) leaves the scroll position alone,
 * exactly as `scrollTopForRow` does — `diffOpenReady` and the auto-open both
 * lean on that to try again on a later render.
 */
export function scrollTopForHunk(
  heights: number[],
  extent: HunkExtent,
  o: { scrollTop: number; viewportH: number; rowH: number },
): number {
  const { scrollTop, viewportH, rowH } = o;
  const { first, last } = extent;
  if (first < 0 || last < first || last >= heights.length || viewportH <= 0) {
    return scrollTop;
  }
  const top = rowOffset(heights, first);
  let extentH = 0;
  for (let i = first; i <= last; i++) extentH += heights[i];

  const lead = Math.min(
    HUNK_LEAD_ROWS * Math.max(0, rowH),
    Math.max(0, viewportH - rowH),
  );
  const want = extentH > viewportH ? top - lead : top + extentH / 2 - viewportH / 2;

  const contentH = heights.reduce((a, h) => a + h, 0);
  return Math.min(
    Math.max(0, nearestRowBoundary(heights, want)),
    Math.max(0, contentH - viewportH),
  );
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
