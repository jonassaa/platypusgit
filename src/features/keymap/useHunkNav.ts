// useHunkNav — F7/⇧F7 diff-change navigation (Rider NextDiff/PreviousDiff).
// Keeps a hunk cursor for a diff screen, registered for every pane the screen
// owns (file list AND diff view), so the chord works wherever focus sits.
// Cursor starts at -1: the first F7 lands on the FIRST hunk. The screen
// renders the cursor as `data-hunk-active` on its `[data-hunk-index]` wrapper;
// this hook scrolls that wrapper into view.

import React from "react";
import { useAction } from "./useAction";

export function useHunkNav(opts: {
  /** Panes this diff screen owns — the handler answers from any of them. */
  paneIds: string[];
  /** Hunk count of the currently viewed file. */
  count: number;
  /** Cursor resets when this changes (the viewed file). */
  resetKey: unknown;
}): number {
  const { paneIds, count, resetKey } = opts;
  const [cursor, setCursor] = React.useState(-1);

  React.useEffect(() => {
    setCursor(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const go = (delta: 1 | -1) => (): boolean => {
    if (count === 0) return false;
    const next = Math.max(0, Math.min(count - 1, cursor + delta));
    setCursor(next);
    for (const paneId of paneIds) {
      const el = document.querySelector<HTMLElement>(
        `[data-pg-pane="${paneId}"] [data-hunk-index="${next}"]`,
      );
      if (el) {
        el.scrollIntoView?.({ block: "start" });
        break;
      }
    }
    return true;
  };

  for (const paneId of paneIds) {
    // Static list per call site — hooks-in-loop is safe and keeps one
    // registration per (action, pane).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAction("diff.nextChange", go(1), [cursor, count], { paneId });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAction("diff.prevChange", go(-1), [cursor, count], { paneId });
  }

  return cursor;
}
