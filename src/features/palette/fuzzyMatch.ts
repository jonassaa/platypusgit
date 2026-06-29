/**
 * Pure fuzzy subsequence matcher used by the command palette.
 *
 * A query matches a target when every query character appears in the target
 * in order (a subsequence). Matching is case-insensitive and greedy: each
 * query char takes the earliest available target position. Score rewards
 * consecutive runs, matches at word boundaries (path/word separators and
 * camelCase humps), and earlier matches — so the best-feeling hits sort first.
 *
 * No dependency on any store or DOM — kept pure and unit-tested.
 */

export interface FuzzyResult {
  matched: boolean;
  /** Higher is better. 0 when the query is empty or there's no match. */
  score: number;
  /** Matched character positions in `target`, for highlighting. */
  indices: number[];
}

const SEPARATORS = new Set(["/", "\\", "-", "_", ".", " ", ":"]);

function isBoundary(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  if (SEPARATORS.has(prev)) return true;
  // camelCase hump: lower/digit followed by upper.
  const cur = target[i];
  const prevLower = prev === prev.toLowerCase() && prev !== prev.toUpperCase();
  const curUpper = cur === cur.toUpperCase() && cur !== cur.toLowerCase();
  if (prevLower && curUpper) return true;
  return false;
}

export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (query.length === 0) {
    return { matched: true, score: 0, indices: [] };
  }
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatchIndex = -2; // so a match at index 0 is not "consecutive"

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) {
      return { matched: false, score: 0, indices: [] };
    }

    // Base point for matching a character.
    let charScore = 1;
    // Consecutive with the previous matched char.
    if (found === prevMatchIndex + 1) charScore += 8;
    // Word boundary in the original (case-preserved) target.
    if (isBoundary(target, found)) charScore += 6;
    // Earlier-position bonus: rewards hits near the front of the string.
    charScore += Math.max(0, 4 - found * 0.25);

    score += charScore;
    indices.push(found);
    prevMatchIndex = found;
    ti = found + 1;
  }

  // Shorter targets (relative to query) are tighter matches.
  score += Math.max(0, 6 - (target.length - query.length) * 0.1);

  return { matched: true, score, indices };
}
