/**
 * Intra-line (word) diff for a removed/added line pair (#61 D8).
 *
 * Hand-rolled rather than pulled from a text-diff library: this needs exactly
 * one mode, and the repo's convention for logic like this is a tested pure
 * function (see graphLayout, buildRebasePlan, semver).
 */

/** Longest line this will diff. Beyond it, callers fall back to line colour. */
export const MAX_LINE_CHARS = 1000;
/** Largest token count per side — the LCS table is O(n·m). */
export const MAX_TOKENS = 200;
/** Minimum share of the shorter side's word tokens that must be common. */
export const MIN_SIMILARITY = 0.3;

export interface WordSpan {
  start: number;
  end: number;
  changed: boolean;
}

export interface WordDiffResult {
  old: WordSpan[];
  new: WordSpan[];
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Split into word runs, whitespace runs, and single punctuation characters. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index;
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Classic LCS table over token text. Returns matched index pairs. */
function lcsPairs(a: Token[], b: Token[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i].text === b[j].text
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Turn matched token indices into tiling spans: every character of `text` is
 * covered exactly once, in order, so a renderer needs no gap handling.
 */
function toSpans(text: string, tokens: Token[], matched: Set<number>): WordSpan[] {
  const out: WordSpan[] = [];
  let at = 0;
  const push = (start: number, end: number, changed: boolean) => {
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && last.changed === changed && last.end === start) {
      last.end = end;
      return;
    }
    out.push({ start, end, changed });
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // Any characters the tokenizer skipped stay unchanged filler.
    push(at, t.start, false);
    push(t.start, t.end, !matched.has(i));
    at = t.end;
  }
  push(at, text.length, false);
  return out;
}

/** True when a token carries a word or number (whitespace/punctuation do not). */
function isWordy(t: Token): boolean {
  return /[\p{L}\p{N}_]/u.test(t.text);
}

/**
 * Intra-line diff of a removed/added line pair.
 *
 * Returns `null` when the pair should render as a plain whole-line
 * add/remove: either a cost guard tripped, or the two lines are too dissimilar
 * to be "the same line edited" — highlighting unrelated rewrites at random
 * reads as noise and is worse than no word diff at all.
 */
export function wordDiff(oldText: string, newText: string): WordDiffResult | null {
  if (oldText.length > MAX_LINE_CHARS || newText.length > MAX_LINE_CHARS) {
    return null;
  }
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  const pairs = lcsPairs(a, b);

  // Similarity is measured over WORD tokens only: two lines sharing nothing but
  // spaces and brackets are not "the same line edited". When either side has no
  // word tokens at all (an empty or punctuation-only line) the gate does not
  // apply — there is nothing to be dissimilar to.
  const wordsA = a.filter(isWordy).length;
  const wordsB = b.filter(isWordy).length;
  const shorter = Math.min(wordsA, wordsB);
  if (shorter > 0) {
    const commonWords = pairs.filter(([i]) => isWordy(a[i])).length;
    if (commonWords / shorter < MIN_SIMILARITY) return null;
  }

  const matchedA = new Set(pairs.map(([i]) => i));
  const matchedB = new Set(pairs.map(([, j]) => j));
  return {
    old: toSpans(oldText, a, matchedA),
    new: toSpans(newText, b, matchedB),
  };
}
