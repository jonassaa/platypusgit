import React from "react";
import { PGButton, PGPrimarySidebar, PGSearchInput, PGSidebarGroup, PGSidebarRow } from "@/design";

import { GROUPS, PAGES } from "./pages";
import type { SettingsPageId } from "./types";

/**
 * The settings side menu: search box, the three grouped page trees, and a
 * footer holding "Reset to defaults" (moved out of the page header — see
 * `screens/Settings.tsx`).
 *
 * One clear responsibility: render the tree and report a page selection
 * upward. It does not decide which page renders — that stays in
 * `SettingsScreen` — and `matchCounts` stays `null` until search lands.
 */
export function SettingsNav({
  pageId,
  onSelect,
  query,
  onQueryChange,
  matchCounts,
  onReset,
}: {
  pageId: SettingsPageId;
  onSelect: (id: SettingsPageId) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Row hits per page while a search is active, else null. */
  matchCounts: ReadonlyMap<SettingsPageId, number> | null;
  onReset: () => void;
}) {
  const treeRef = React.useRef<HTMLDivElement>(null);

  // Groups with no hits collapse while a search is active, and spring back to
  // the user's own open/closed state when the query clears — `undefined`
  // hands control back to `PGSidebarGroup`'s own uncontrolled state, which is
  // deliberately NOT "fixed" to remember the forced-open state.
  const groupOpen = (groupPages: readonly SettingsPageId[]): boolean | undefined => {
    if (!matchCounts) return undefined;
    return groupPages.some((p) => (matchCounts.get(p) ?? 0) > 0);
  };

  const visible = GROUPS.flatMap((g) =>
    g.pages.filter((p) => !matchCounts || (matchCounts.get(p) ?? 0) > 0),
  );

  const focusRow = (id: SettingsPageId) => {
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-testid="settings-nav-${id}"]`)
      ?.focus();
  };

  /**
   * A row only renders while its enclosing group is open, so a keydown
   * reaching here always means "collapse". `PGSidebarGroup` is uncontrolled
   * here (see `groupOpen` above) and exposes no imperative API to close it
   * from outside — a synthetic click on its own header flips the same
   * internal state a mouse click would, without making the group controlled
   * (which would break the search spring-back behaviour). Focus moves to the
   * tree root afterwards so it is not left on a node that just unmounted.
   */
  const collapseEnclosingGroup = (rowEl: HTMLElement) => {
    const header = rowEl.closest('[role="group"]')?.parentElement?.parentElement
      ?.firstElementChild as HTMLElement | null;
    header?.click();
    treeRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, id: SettingsPageId) => {
    const i = visible.indexOf(id);
    if (e.key === "ArrowDown" && i < visible.length - 1) {
      e.preventDefault();
      const next = visible[i + 1];
      onSelect(next);
      focusRow(next);
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      const prev = visible[i - 1];
      onSelect(prev);
      focusRow(prev);
    } else if (e.key === "Enter" || e.key === " ") {
      // Rows are plain divs, not buttons, so activation needs an explicit
      // handler here.
      e.preventDefault();
      onSelect(id);
    } else if (e.key === "ArrowLeft") {
      // A leaf treeitem has nothing to expand into, so ArrowRight is a
      // no-op here (matching the ARIA tree pattern for end nodes); ArrowLeft
      // can still collapse the group it sits in.
      e.preventDefault();
      collapseEnclosingGroup(e.currentTarget as HTMLElement);
    }
  };

  return (
    <PGPrimarySidebar width={232}>
      <div style={{ padding: 8, borderBottom: "1px solid var(--border-0)" }}>
        <PGSearchInput
          value={query}
          onChange={onQueryChange}
          placeholder="Search settings"
          testId="settings-search"
        />
      </div>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Settings pages"
        tabIndex={-1}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {GROUPS.map((group) => (
          <PGSidebarGroup
            key={group.id}
            title={group.title}
            open={groupOpen(group.pages)}
          >
            <div role="group" aria-label={group.title}>
              {group.pages.map((id) => {
                const hits = matchCounts?.get(id) ?? null;
                return (
                  <PGSidebarRow
                    key={id}
                    icon={PAGES[id].meta.icon}
                    label={PAGES[id].meta.title}
                    selected={id === pageId}
                    ariaSelected={id === pageId}
                    role="treeitem"
                    tabIndex={id === pageId ? 0 : -1}
                    dimmed={matchCounts ? hits === 0 : undefined}
                    meta={hits ? String(hits) : undefined}
                    testId={`settings-nav-${id}`}
                    onClick={() => onSelect(id)}
                    onKeyDown={(e) => onKeyDown(e, id)}
                  />
                );
              })}
            </div>
          </PGSidebarGroup>
        ))}
      </div>
      <div style={{ padding: 8, borderTop: "1px solid var(--border-0)" }}>
        <PGButton size="sm" variant="ghost" onClick={onReset}>
          Reset to defaults
        </PGButton>
      </div>
    </PGPrimarySidebar>
  );
}
