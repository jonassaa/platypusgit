import { PGButton } from "@/design";
import { SettingsFilterProvider } from "@/features/settings/layout/filterContext";
import { SettingsHighlightProvider } from "@/features/settings/layout/highlightContext";

import { queryTerms, type IndexedRow } from "./match";
import { PAGES } from "./pages";
import type { SettingsPageId } from "./types";

/**
 * The flat, Chrome-style search results pane: every matching row from every
 * page, grouped under a breadcrumb, each rendering its page's REAL component
 * under a filter context — so a result IS the row that changes the setting,
 * never a copy of it that could drift.
 */
export function SettingsResults({
  hits,
  query,
  onClear,
}: {
  hits: IndexedRow[];
  query: string;
  onClear: () => void;
}) {
  if (hits.length === 0) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--fg-2)" }}>
        <div style={{ fontSize: "var(--fs-13)", marginBottom: 12 }}>
          No settings match “{query}”.
        </div>
        <PGButton size="sm" variant="ghost" onClick={onClear}>
          Clear search
        </PGButton>
      </div>
    );
  }

  // Group hits by page. `hits` is already in registry (`PAGE_ORDER`) order —
  // `buildIndex` walks the pages in that order and `matchRows` is a plain
  // filter — so insertion order into this Map preserves it.
  const byPage = new Map<SettingsPageId, IndexedRow[]>();
  // Rows to actually reveal in the DOM: every literal hit, PLUS — for a
  // `dynamic` card (git.integrations' host list has no per-row ids to match)
  // — every row that card declares. Without that, a card that renders in
  // full via `cardHasVisibleRow` (any declared id present) could still have
  // its own conditionally-rendered `SettingsRow`s (e.g. "No forge detected")
  // self-hide because THEIR specific id was not the one that matched — which
  // is exactly the per-row filtering `dynamic` says to skip.
  const visibleRowIds = new Set<string>();
  for (const hit of hits) {
    const list = byPage.get(hit.pageId);
    if (list) list.push(hit);
    else byPage.set(hit.pageId, [hit]);

    visibleRowIds.add(hit.row.id);
    const card = PAGES[hit.pageId].meta.cards.find((c) => c.id === hit.cardId);
    if (card?.dynamic) {
      for (const row of card.rows) visibleRowIds.add(row.id);
    }
  }

  return (
    <SettingsHighlightProvider terms={queryTerms(query)}>
      <div style={{ margin: "0 0 16px", color: "var(--fg-2)", fontSize: "var(--fs-12)" }}>
        {hits.length} {hits.length === 1 ? "result" : "results"} for “{query}”
      </div>
      {[...byPage.entries()].map(([pageId, pageHits]) => {
        const { Page, meta } = PAGES[pageId];
        return (
          <div key={pageId} data-settings-result-page={pageId}>
            <div
              style={{
                marginTop: 20,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-11)",
                color: "var(--fg-2)",
              }}
            >
              {pageHits[0].groupTitle} › {meta.title}
            </div>
            {/* The page renders itself; the filter context hides the rows that
                did not match, so the controls here are the real ones. */}
            <SettingsFilterProvider visibleRowIds={visibleRowIds}>
              <Page />
            </SettingsFilterProvider>
          </div>
        );
      })}
    </SettingsHighlightProvider>
  );
}
