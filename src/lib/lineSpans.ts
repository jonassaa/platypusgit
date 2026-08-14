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

export function buildLineSpans(
  text: string,
  syntax: SyntaxToken[] | null,
  words: WordSpan[] | undefined,
): RenderSpan[] {
  const len = text.length;
  if (len === 0) return [];

  // Boundaries: line ends plus every edge of either input, clamped in range.
  const cuts = new Set<number>([0, len]);
  const clamp = (n: number) => Math.max(0, Math.min(len, n));
  for (const t of syntax ?? []) {
    cuts.add(clamp(t.start));
    cuts.add(clamp(t.end));
  }
  for (const w of words ?? []) {
    cuts.add(clamp(w.start));
    cuts.add(clamp(w.end));
  }
  const edges = [...cuts].sort((a, b) => a - b);

  const out: RenderSpan[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end <= start) continue; // duplicate edges collapse; never emit zero width
    // A segment lies wholly inside or wholly outside each input range, because
    // every range edge is a cut, so testing the midpoint is exact.
    const mid = (start + end) / 2;
    const tok = (syntax ?? []).find((t) => t.start <= mid && mid < t.end);
    const w = (words ?? []).find((s) => s.start <= mid && mid < s.end);
    out.push({ start, end, cls: tok?.cls, changed: w?.changed ?? false });
  }
  return out;
}
