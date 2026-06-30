// usePaneList — standardizes arrow-key list/tree navigation for a pane. Up/down
// move selection, left/right collapse/expand, Enter activates. Handlers only
// fire while the owning pane is focused, so multiple lists coexist without
// fighting over the arrow keys.

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
}): void {
  const isFocused = useFocusStore((s) => s.focused === opts.paneId);
  // Decline (return false) when this pane isn't focused so the key falls
  // through to another pane or the browser instead of being swallowed.
  const guard = (fn: () => void) => (): boolean => {
    if (!isFocused) return false;
    fn();
    return true;
  };
  const clamp = (i: number) => Math.max(0, Math.min(opts.count - 1, i));

  useAction(
    "list.up",
    guard(() => opts.onSelect(clamp(opts.selectedIndex - 1))),
    [isFocused, opts.selectedIndex, opts.count],
  );
  useAction(
    "list.down",
    guard(() => opts.onSelect(clamp(opts.selectedIndex + 1))),
    [isFocused, opts.selectedIndex, opts.count],
  );
  useAction(
    "list.activate",
    guard(() => opts.onActivate?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex],
  );
  useAction(
    "list.expand",
    guard(() => opts.onExpand?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex],
  );
  useAction(
    "list.collapse",
    guard(() => opts.onCollapse?.(opts.selectedIndex)),
    [isFocused, opts.selectedIndex],
  );
}
