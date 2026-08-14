// The one place Shiki is actually called.
//
// Split out from tokenizeCore.ts so the main bundle does not have to contain the
// highlighter: the worker imports this eagerly, and tokenize.ts imports it
// dynamically, only if the worker turns out to be unavailable. In the normal case
// the main thread never loads Shiki at all.
import { SENTINEL_THEME_NAME, ensureLanguage, getHighlighter } from "./shiki";
import { langForPath } from "./langs";
import {
  packLines,
  skipHighlight,
  toLineRelative,
  type PackedSyntax,
  type RawToken,
} from "./tokenizeCore";

/**
 * Tokenize a whole file to the packed shape.
 *
 * Resolves null whenever highlighting is not available or not worth it — unknown
 * language, oversized input, or any Shiki failure. Callers render plain text.
 */
export async function tokenizeToPacked(
  path: string,
  text: string,
): Promise<PackedSyntax | null> {
  const lang = langForPath(path);
  if (!lang || skipHighlight(path, text)) return null;
  if (!(await ensureLanguage(lang))) return null;
  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(text, {
      lang,
      theme: SENTINEL_THEME_NAME,
    }) as { tokens: RawToken[][] };
    return packLines(toLineRelative(tokens));
  } catch {
    return null;
  }
}
