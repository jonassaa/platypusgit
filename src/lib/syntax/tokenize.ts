import { classForColor } from "./scopes";
import { langForPath } from "./langs";
import { SENTINEL_THEME_NAME, ensureLanguage, getHighlighter } from "./shiki";

/** A syntax range over ONE line, in that line's own coordinates. */
export interface SyntaxToken {
  start: number;
  end: number;
  cls: string;
}

export type SyntaxLine = SyntaxToken[];

/** Files past either guard render plain — highlighting is a nicety, not a feature. */
export const MAX_HIGHLIGHT_BYTES = 1_000_000;
export const MAX_HIGHLIGHT_LINES = 20_000;

interface RawToken {
  content: string;
  offset: number;
  color?: string;
}

/**
 * Rebase Shiki's DOCUMENT-absolute offsets to line-relative ranges, and resolve
 * sentinel colours to classes.
 *
 * The rebase is the whole point: `WordSpan` from wordDiff.ts is line-relative,
 * and buildLineSpans intersects the two. Leaving absolute offsets in would put
 * every line after the first out of range, silently yielding no spans.
 */
export function toLineRelative(lines: RawToken[][]): SyntaxLine[] {
  return lines.map((tokens) => {
    const base = tokens.length > 0 ? tokens[0].offset : 0;
    const out: SyntaxLine = [];
    for (const t of tokens) {
      const cls = classForColor(t.color);
      if (!cls) continue; // unscoped text renders unstyled
      const start = t.offset - base;
      out.push({ start, end: start + t.content.length, cls });
    }
    return out;
  });
}

/** djb2. Enough to detect content change for a cache key; not a checksum. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CACHE_MAX = 24;
const cache = new Map<string, SyntaxLine[]>();

export function clearSyntaxCache(): void {
  cache.clear();
}

function remember(key: string, value: SyntaxLine[]): SyntaxLine[] {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/**
 * Tokenize a whole file. Resolves null whenever highlighting is not available
 * or not worth it — unknown language, oversized input, or any Shiki failure.
 * Callers treat null as "render plain text".
 */
export async function tokenizeFile(
  path: string,
  text: string,
): Promise<SyntaxLine[] | null> {
  const lang = langForPath(path);
  if (!lang) return null;
  if (text.length > MAX_HIGHLIGHT_BYTES) return null;
  const lineCount = text.split("\n").length;
  if (lineCount > MAX_HIGHLIGHT_LINES) return null;

  const key = `${lang}:${hash(text)}:${text.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!(await ensureLanguage(lang))) return null;
  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(text, {
      lang,
      theme: SENTINEL_THEME_NAME,
    }) as { tokens: RawToken[][] };
    return remember(key, toLineRelative(tokens));
  } catch {
    return null;
  }
}
