import React from "react";

/**
 * The active search terms, for `SettingsRow` to highlight in its label — a
 * SEPARATE context from `filterContext`'s `ReadonlySet<string> | null` of
 * visible row ids.
 *
 * Kept separate on purpose: `SettingsFilterContext` answers "is this row
 * visible at all" and is consumed at three existing call sites as a bare
 * `ReadonlySet<string> | null`; folding highlight terms into that shape would
 * change what every one of those call sites receives. Highlighting is a
 * strictly additive, cosmetic concern, so it gets its own context instead —
 * defaulting to `[]` (no terms, no highlighting) so a page rendered with no
 * provider at all (the single-page, non-searching branch) needs nothing extra
 * to render identically to today.
 */
const SettingsHighlightContext = React.createContext<string[]>([]);

export function SettingsHighlightProvider({
  terms,
  children,
}: {
  terms: string[];
  children: React.ReactNode;
}) {
  return (
    <SettingsHighlightContext.Provider value={terms}>
      {children}
    </SettingsHighlightContext.Provider>
  );
}

export function useSettingsHighlight(): string[] {
  return React.useContext(SettingsHighlightContext);
}
