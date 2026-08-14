// useHunkNav — F7/⇧F7 diff-change navigation (Rider NextDiff/PreviousDiff).
// Keeps a hunk cursor for a diff screen, scoped to every pane the screen owns
// (file list AND diff view), so the chord works wherever focus sits.
// Cursor starts at -1: the first F7 lands on the FIRST hunk. The screen
// renders the cursor as `data-hunk-active` on its `[data-hunk-index]` wrapper;
// this hook scrolls that wrapper into view.

import React from "react";
import { useAction } from "./useAction";

export function useHunkNav(opts: {
  /** Panes this diff screen owns — the handler answers from any of them. */
  paneIds: readonly string[];
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
    // Scroll the FIRST pane that actually renders the target hunk: the file
    // list has no `[data-hunk-index]` children at all, and a screen with two
    // diff panes wants the leading one.
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

  // ONE registration per action, carrying the whole pane list as its scope —
  // NOT a useAction call per pane, which was a rules-of-hooks violation that
  // only held together while every caller passed a constant-length literal.
  useAction("diff.nextChange", go(1), [cursor, count], { paneId: paneIds });
  useAction("diff.prevChange", go(-1), [cursor, count], { paneId: paneIds });

  return cursor;
}
