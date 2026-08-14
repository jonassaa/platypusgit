// The rem↔add pairing rule for intra-line diff, lifted out of PGHunk so the
// unified hunk renderer, the split view and the commit-diff panel share ONE
// definition instead of three that drift.
//
// The rule: the i-th removed line pairs with the i-th added line, for the first
// min(rem, add) lines. wordDiff itself declines a pair too dissimilar to be "the
// same line edited", and those come back null.
import { wordDiff, type WordSpan } from "./wordDiff";

export interface LinePairSpans {
  old: WordSpan[];
  new: WordSpan[];
}

export function pairChangedLines(
  rem: string[],
  add: string[],
): Array<LinePairSpans | null> {
  const n = Math.min(rem.length, add.length);
  const out: Array<LinePairSpans | null> = [];
  for (let i = 0; i < n; i++) {
    const r = wordDiff(rem[i], add[i]);
    out.push(r ? { old: r.old, new: r.new } : null);
  }
  return out;
}
