import React from "react";
import { peekTokens, tokenizeFile } from "./tokenize";
import type { SyntaxLine } from "./tokenize";

interface Resolved {
  path: string;
  text: string;
  lines: SyntaxLine[] | null;
}

/**
 * Tokens for a file, or null while they are pending or unavailable.
 *
 * Deliberately never blocks first paint: the caller renders plain text on the
 * null, and re-renders with spans when this resolves. Span-ification does not
 * change row geometry, so there is no layout shift to hide behind a spinner.
 *
 * Already-cached tokens are read SYNCHRONOUSLY (peekTokens), so revisiting a
 * file highlights on the first paint with no plain-text flash and no extra
 * render pass. The async state is keyed by the (path, text) it answered, which
 * also keeps a stale resolution — or the previous file's tokens during the one
 * render before an effect could clear them — from ever being returned against
 * different text.
 */
export function useSyntax(
  path: string | null,
  text: string | null,
): SyntaxLine[] | null {
  const cached = React.useMemo(
    () => (path && text != null ? peekTokens(path, text) : null),
    [path, text],
  );
  const [res, setRes] = React.useState<Resolved | null>(null);

  React.useEffect(() => {
    if (cached || !path || text == null) return;
    let cancelled = false;
    tokenizeFile(path, text).then((lines) => {
      if (!cancelled) setRes({ path, text, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [path, text, cached]);

  if (cached) return cached;
  return res && res.path === path && res.text === text ? res.lines : null;
}
