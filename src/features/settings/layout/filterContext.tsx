import React from "react";

/**
 * The set of row ids a search left visible, or `null` for "no search active —
 * render everything".
 *
 * A SET rather than the query string: matching happens once, up front, against
 * the declared index (`nav/pages.ts`), so a card can decide whether to render
 * its header BEFORE its children render. Letting each row test the query itself
 * would mean a card only learns whether it is empty after the fact, which costs
 * a second render pass and an effect-ordering hazard for no benefit.
 */
const SettingsFilterContext = React.createContext<ReadonlySet<string> | null>(null);

export function SettingsFilterProvider({
  visibleRowIds,
  children,
}: {
  visibleRowIds: ReadonlySet<string> | null;
  children: React.ReactNode;
}) {
  return (
    <SettingsFilterContext.Provider value={visibleRowIds}>
      {children}
    </SettingsFilterContext.Provider>
  );
}

export function useSettingsFilter(): ReadonlySet<string> | null {
  return React.useContext(SettingsFilterContext);
}
