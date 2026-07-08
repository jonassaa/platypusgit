// usePaneList — standardizes arrow-key list/tree navigation for a pane. Up/down
// move selection, left/right collapse/expand, Enter activates, Space toggles
// (stage/unstage), Home/End jump. Handlers register with the pane's id, so the
// dispatcher only delivers them while that pane holds focus — multiple lists
// coexist without fighting over the arrow keys.
//
// The selected row is kept in view: rows opt in by carrying `data-pg-row` and
// `data-selected` attributes (also what the focus-aware selection CSS keys on).

import React from "react";
import { useFocusStore } from "./useFocusStore";
import { useKeymapStore } from "./useKeymapStore";
import { useSpeedSearchStore } from "./useSpeedSearchStore";
import { useAction } from "./useAction";

export function usePaneList(opts: {
  paneId: string;
  count: number;
  selectedIndex: number;
  onSelect: (i: number) => void;
  onActivate?: (i: number) => void;
  onExpand?: (i: number) => void;
  onCollapse?: (i: number) => void;
  onToggle?: (i: number) => void;
  /** Shift+↑/↓ — extend a multi-selection range from the anchor. Panes that
   *  don't support multi-select omit these and the chord falls through. */
  onExtendUp?: () => void;
  onExtendDown?: () => void;
  /** Opt into speed-search: row i's searchable text. Typing (unbound
   *  printable keys) jumps the selection to the first matching row. */
  searchText?: (i: number) => string;
}): void {
  const { paneId, count, selectedIndex } = opts;
  const isFocused = useFocusStore((s) => s.focused === paneId);
  const reg = { paneId };
  // Decline (return false) on empty lists so the key falls through.
  const guard = (fn: (() => void) | undefined) => (): boolean => {
    if (count === 0 || !fn) return false;
    fn();
    return true;
  };
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  const deps = [selectedIndex, count, isFocused];

  useAction("list.up", guard(() => opts.onSelect(clamp(selectedIndex - 1))), deps, reg);
  useAction("list.down", guard(() => opts.onSelect(clamp(selectedIndex + 1))), deps, reg);
  useAction("list.top", guard(() => opts.onSelect(0)), deps, reg);
  useAction("list.bottom", guard(() => opts.onSelect(count - 1)), deps, reg);
  useAction(
    "list.extendUp",
    opts.onExtendUp ? guard(() => opts.onExtendUp?.()) : () => false,
    deps,
    reg,
  );
  useAction(
    "list.extendDown",
    opts.onExtendDown ? guard(() => opts.onExtendDown?.()) : () => false,
    deps,
    reg,
  );
  useAction(
    "list.activate",
    opts.onActivate ? guard(() => opts.onActivate?.(selectedIndex)) : () => false,
    deps,
    reg,
  );
  useAction(
    "list.expand",
    opts.onExpand ? guard(() => opts.onExpand?.(selectedIndex)) : () => false,
    deps,
    reg,
  );
  useAction(
    "list.collapse",
    opts.onCollapse ? guard(() => opts.onCollapse?.(selectedIndex)) : () => false,
    deps,
    reg,
  );
  useAction(
    "list.toggle",
    opts.onToggle ? guard(() => opts.onToggle?.(selectedIndex)) : () => false,
    deps,
    reg,
  );

  // Keep the selected row visible while driving the list from the keyboard.
  React.useEffect(() => {
    if (!isFocused) return;
    const row = document.querySelector<HTMLElement>(
      `[data-pg-pane="${paneId}"] [data-pg-row][data-selected]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, isFocused, paneId]);

  // Speed-search: register with the dispatcher fallback, jump on query
  // change, and let Escape clear the query (claiming it before the overlay
  // chain) while one is active.
  const hasSearch = !!opts.searchText;
  const query = useSpeedSearchStore((s) =>
    hasSearch ? (s.queries[paneId] ?? "") : "",
  );
  React.useEffect(() => {
    if (!hasSearch) return;
    return useKeymapStore.getState().registerSpeedSearch(paneId);
  }, [paneId, hasSearch]);
  React.useEffect(() => {
    if (!hasSearch || !query) return;
    const q = query.toLowerCase();
    for (let i = 0; i < count; i++) {
      if (opts.searchText!(i).toLowerCase().includes(q)) {
        opts.onSelect(i);
        return;
      }
    }
    // No match: leave the selection where it is (JetBrains behavior).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useAction(
    "app.closeOverlay",
    () => {
      if (!isFocused || !query) return false;
      useSpeedSearchStore.getState().clear(paneId);
      return true;
    },
    [isFocused, query, paneId],
    reg,
  );
}
