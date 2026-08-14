// useAction — register a handler for an action id while the component is
// mounted. Components dispatch action ids, never raw keys. Last mounted handler
// for an action wins (innermost component handles it). Pass `paneId` for
// pane-scoped actions — the dispatcher only delivers those while that pane
// holds focus. `paneId` also takes a LIST of panes, so a screen whose chord
// answers from any of its panes registers once instead of once per pane.

import { useEffect } from "react";
import { useKeymapStore, type ActionHandler } from "./useKeymapStore";
import type { ActionId } from "./actions";

/** Pane scopes are compared by CONTENT, not identity: a multi-pane caller
 *  builds a fresh array every render, and keying the effect on the array itself
 *  would unregister and re-register the handler on every render. Keyed by
 *  content, the scope the effect captured always matches the current one. */
function scopeKey(paneId: string | readonly string[] | undefined): string | undefined {
  if (paneId === undefined || typeof paneId === "string") return paneId;
  // NUL separator: no pane id contains one, so no two scopes collide.
  return paneId.join("\u0000");
}

export function useAction(
  id: ActionId,
  handler: ActionHandler,
  deps: unknown[],
  opts?: { paneId?: string | readonly string[] },
): void {
  const paneId = opts?.paneId;
  const paneKey = scopeKey(paneId);
  useEffect(() => {
    return useKeymapStore.getState().register(id, handler, { paneId });
    // Handler identity is captured per-deps by the caller; re-register when
    // deps change so the latest closure is invoked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, paneKey]);
}
