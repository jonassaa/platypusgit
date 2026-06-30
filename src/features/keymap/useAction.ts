// useAction — register a handler for an action id while the component is
// mounted. Components dispatch action ids, never raw keys. Last mounted handler
// for an action wins (innermost component handles it).

import { useEffect } from "react";
import { useKeymapStore, type ActionHandler } from "./useKeymapStore";
import type { ActionId } from "./registry";

export function useAction(
  id: ActionId,
  handler: ActionHandler,
  deps: unknown[],
): void {
  useEffect(() => {
    return useKeymapStore.getState().register(id, handler);
    // Handler identity is captured per-deps by the caller; re-register when
    // deps change so the latest closure is invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
