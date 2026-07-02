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
}
