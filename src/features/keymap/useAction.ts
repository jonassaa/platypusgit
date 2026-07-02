// useAction — register a handler for an action id while the component is
// mounted. Components dispatch action ids, never raw keys. Last mounted handler
// for an action wins (innermost component handles it). Pass `paneId` for
// pane-scoped actions — the dispatcher only delivers those while that pane
// holds focus.

import { useEffect } from "react";
import { useKeymapStore, type ActionHandler } from "./useKeymapStore";
import type { ActionId } from "./actions";

export function useAction(
  id: ActionId,
  handler: ActionHandler,
  deps: unknown[],
  opts?: { paneId?: string },
): void {
  const paneId = opts?.paneId;
  useEffect(() => {
    return useKeymapStore.getState().register(id, handler, { paneId });
    // Handler identity is captured per-deps by the caller; re-register when
    // deps change so the latest closure is invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, paneId]);
}
