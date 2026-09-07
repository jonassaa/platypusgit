import React from "react";
import { PGButton, PGPrimarySidebar, PGSearchInput, PGSidebarGroup, PGSidebarRow } from "@/design";

import { GROUPS, PAGES } from "./pages";
import type { SettingsGroup } from "./pages";
import type { SettingsGroupId, SettingsPageId } from "./types";

/**
 * The settings side menu: search box, the three grouped page trees, and a
 * footer holding "Reset to defaults" (moved out of the page header — see
 * `screens/Settings.tsx`).
 *
 * One clear responsibility: render the tree and report a page selection
 * upward. It does not decide which page renders — that stays in
 * `SettingsScreen`, which passes `null` for `matchCounts` outside a search.
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

  // SettingsNav owns every group's open/closed state and always passes a
  // real boolean `open` to `PGSidebarGroup` — never `undefined` — so a
  // keyboard collapse/expand has something to command without reaching into
  // that component's internals. All three start open, matching its
  // `defaultOpen` behaviour. `PGSidebarGroup`'s own uncontrolled path stays
  // in place for other future callers; nothing here uses it any more.
  const [localOpen, setLocalOpen] = React.useState<Record<SettingsGroupId, boolean>>(
    () => Object.fromEntries(GROUPS.map((g) => [g.id, true])) as Record<SettingsGroupId, boolean>,
  );

  // Guarded so a header click during an active search never writes
  // `localOpen`: while searching, `groupOpen` below ignores `localOpen`
  // entirely (the displayed state is derived from `matchCounts`), so letting
  // a click write it anyway would silently corrupt the state the user gets
  // back once the query clears — the whole point of `localOpen` being
  // untouched by search is that groups "spring back" to what the user set.
  const setGroupOpen = (groupId: SettingsGroupId, open: boolean) => {
    if (matchCounts) return;
    setLocalOpen((m) => ({ ...m, [groupId]: open }));
  };

  // While a search is active, EVERY group forces open, regardless of
  // `localOpen` (which a search never touches — clearing the query reveals
  // exactly whatever the user last set by hand). Not just groups with hits:
  // the whole point of a zero-hit PAGE staying listed-but-dimmed rather than
  // hidden (see `visible` below) falls apart one level up if its whole GROUP
  // collapses instead — a group with no hits anywhere in it would take every
  // one of its pages down with it, hidden rather than dimmed.
  const groupOpen = (group: SettingsGroup): boolean =>
    matchCounts ? true : localOpen[group.id];

  const groupOf = (id: SettingsPageId): SettingsGroup =>
    GROUPS.find((g) => g.pages.includes(id))!;

  // A collapsed group's pages are not in the DOM at all, so both the arrow-
  // key traversal below and the roving-tabindex fallback further down must
  // agree with `groupOpen` on what is actually rendered. `matchCounts` does
  // NOT filter this further: a zero-hit page stays listed (dimmed, not
  // hidden) so mouse and keyboard agree on what is clickable/focusable —
  // excluding it here would let arrow keys skip a row the user can still
  // click, and would leave `visible.indexOf(id)` at -1 for a page the
  // keyboard handler below is not written to survive.
  const visible = GROUPS.filter((g) => groupOpen(g)).flatMap((g) => g.pages);

  // The roving tabindex normally follows the selected page, but that page's
  // row may not be rendered (its group collapsed after selection, e.g. via a
  // direct header click) — fall back to the first visible row so the tree
  // always has exactly one Tab stop.
  const tabbablePageId = visible.includes(pageId) ? pageId : visible[0];

  const focusRow = (id: SettingsPageId) => {
    treeRef.current
      ?.querySelector<HTMLElement>(`[data-testid="settings-nav-${id}"]`)
      ?.focus();
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
      // A row only renders while its group is open, so reaching this from a
      // treeitem always means "collapse". Focus moves to the tree root
      // afterwards so it is not left on a node that just unmounted.
      e.preventDefault();
      setGroupOpen(groupOf(id).id, false);
      treeRef.current?.focus();
    } else if (e.key === "ArrowRight") {
      // A leaf treeitem's group is definitionally already open (a closed
      // group renders no rows to focus), so this is a no-op in practice —
      // kept for symmetry with Left and for a future parent-node treeitem.
      e.preventDefault();
      setGroupOpen(groupOf(id).id, true);
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
            open={groupOpen(group)}
            // `setGroupOpen` itself no-ops while `matchCounts` is set, so a
            // header click on a group a search forced open does not write
            // `localOpen` — see the comment on `setGroupOpen` above.
            onOpenChange={(open) => setGroupOpen(group.id, open)}
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
                    tabIndex={id === tabbablePageId ? 0 : -1}
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
