import React from "react";
import { tokenizeFile } from "./tokenize";
import type { SyntaxLine } from "./tokenize";

/**
 * Tokens for a file, or null while they are pending or unavailable.
 *
 * Deliberately never blocks first paint: the caller renders plain text on the
 * null, and re-renders with spans when this resolves. Span-ification does not
 * change row geometry, so there is no layout shift to hide behind a spinner.
 */
export function useSyntax(
  path: string | null,
  text: string | null,
): SyntaxLine[] | null {
  const [lines, setLines] = React.useState<SyntaxLine[] | null>(null);

  React.useEffect(() => {
    setLines(null);
    if (!path || text == null) return;
    let cancelled = false;
    tokenizeFile(path, text).then((result) => {
      if (!cancelled) setLines(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path, text]);

  return lines;
}
