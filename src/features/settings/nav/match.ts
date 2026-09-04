import { GROUPS, PAGES, PAGE_ORDER } from "./pages";
import type { SettingRowMeta, SettingsPageId } from "./types";

export interface IndexedRow {
  row: SettingRowMeta;
  cardId: string;
  cardTitle: string;
  pageId: SettingsPageId;
  pageTitle: string;
  groupTitle: string;
  /** Pre-lowercased match target. */
  haystack: string;
}

/**
 * Flatten the registry into a searchable index.
 *
 * The haystack folds in the CARD and PAGE titles as well as the row's own label
 * and keywords, deliberately: "diff" then matches every row on the Diff page,
 * which is what people expect, and it removes any need for a "the page title
 * matched but no rows did" special case. Group titles are NOT folded in — an
 * `IndexedRow` carries `groupTitle` only so a renderer can show a breadcrumb.
 *
 * Hints are NOT indexed — they are `React.ReactNode` and cannot be flattened to
 * text reliably. That is what `keywords` is for.
 */
export function buildIndex(gates: { updatable: boolean }): IndexedRow[] {
  const groupTitleOf = new Map(
    GROUPS.flatMap((g) => g.pages.map((p) => [p, g.title] as const)),
  );
  const out: IndexedRow[] = [];
  for (const pageId of PAGE_ORDER) {
    const { meta } = PAGES[pageId];
    for (const card of meta.cards) {
      for (const row of card.rows) {
        if (row.when === "updatable" && !gates.updatable) continue;
        out.push({
          row,
          cardId: card.id,
          cardTitle: card.title,
          pageId,
          pageTitle: meta.title,
          groupTitle: groupTitleOf.get(pageId) ?? "",
          haystack: [row.label, row.keywords ?? "", card.title, meta.title]
            .join(" ")
            .toLowerCase(),
        });
      }
    }
  }
  return out;
}

/**
 * Lowercased, whitespace-split search terms. Empty (never `[""]`) for an
 * empty or all-whitespace query — `"".split(/\s+/)` would otherwise produce
 * `[""]`, and `.filter(Boolean)` is what turns that into `[]`.
 */
export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every whitespace-separated term must appear. Substring, not fuzzy. */
export function matchRows(query: string, index: IndexedRow[]): IndexedRow[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  return index.filter((e) => terms.every((t) => e.haystack.includes(t)));
}

export function matchCountsByPage(
  hits: IndexedRow[],
): Map<SettingsPageId, number> {
  const counts = new Map<SettingsPageId, number>();
  for (const pageId of PAGE_ORDER) counts.set(pageId, 0);
  for (const hit of hits) counts.set(hit.pageId, (counts.get(hit.pageId) ?? 0) + 1);
  return counts;
}
