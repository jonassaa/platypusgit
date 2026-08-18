// Syntax tokens and word-diff spans are two independent range sets over one
// line. This is the ONE place they reconcile, so every renderer becomes a flat
// spans.map() with no gap handling and no overlap reasoning.
//
// Output tiles the line: concatenating every span reproduces the text exactly.
// wordDiff.ts already guarantees that property for word spans alone; this keeps
// it once syntax joins in.
import type { SyntaxToken } from "./syntax";
import type { WordSpan } from "./wordDiff";

export interface RenderSpan {
  start: number;
  end: number;
  /** Syntax class, or undefined for text no grammar scoped. */
  cls?: string;
  /** True when the word diff marked this range as changed. */
  changed: boolean;
}

interface Range {
  start: number;
  end: number;
}

/** Ranges sorted by start, clamped into [0, len]; zero-width ones dropped. */
function normalized<T extends Range>(
  ranges: readonly T[] | undefined | null,
  len: number,
): readonly T[] {
  if (!ranges || ranges.length === 0) return [];
  // Fast path: both producers (Shiki tokens, wordDiff tilings) already emit
  // in-bounds, sorted, non-empty ranges — return the array as-is, no copies.
  let clean = true;
  let prev = 0;
  for (const r of ranges) {
    if (r.start < prev || r.end <= r.start || r.start < 0 || r.end > len) {
      clean = false;
      break;
    }
    prev = r.start;
  }
  if (clean) return ranges;
  const out: T[] = [];
  for (const r of ranges) {
    const start = Math.max(0, Math.min(len, r.start));
    const end = Math.max(0, Math.min(len, r.end));
    if (end > start) out.push({ ...r, start, end });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export function buildLineSpans(
  text: string,
  syntax: SyntaxToken[] | null,
  words: WordSpan[] | undefined,
): RenderSpan[] {
  const len = text.length;
  if (len === 0) return [];

  // Both inputs arrive sorted and non-overlapping (Shiki emits tokens in
  // order; wordDiff emits a tiling), so a single merge walk resolves each
  // segment — but sortedness is re-established here rather than assumed, since
  // this is a public helper and a `.find` scan per segment was the alternative.
  const syn = normalized(syntax, len);
  const wrd = normalized(words, len);

  // Boundaries: line ends plus every edge of either input.
  const cuts = new Set<number>([0, len]);
  for (const t of syn) {
    cuts.add(t.start);
    cuts.add(t.end);
  }
  for (const w of wrd) {
    cuts.add(w.start);
    cuts.add(w.end);
  }
  const edges = [...cuts].sort((a, b) => a - b);

  const out: RenderSpan[] = [];
  let si = 0;
  let wi = 0;
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    // A segment lies wholly inside or wholly outside each input range, because
    // every range edge is a cut, so testing the midpoint is exact. The walk
    // advances two cursors instead of scanning each list per segment.
    const mid = (start + end) / 2;
    while (si < syn.length && syn[si].end <= mid) si++;
    while (wi < wrd.length && wrd[wi].end <= mid) wi++;
    const tok = si < syn.length && syn[si].start <= mid ? syn[si] : undefined;
    const w = wi < wrd.length && wrd[wi].start <= mid ? wrd[wi] : undefined;
    out.push({ start, end, cls: tok?.cls, changed: w?.changed ?? false });
  }
  return out;
}
