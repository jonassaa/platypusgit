// Scroll → window state for the variable-height diff surfaces, without a
// re-render per scroll pixel.
//
// The four diff surfaces used to keep raw `scrollTop` in state and derive the
// window in a memo: correct, but a trackpad fires 100+ scroll events a second
// and every one re-rendered the whole owning screen — toolbar, file list and
// all — even though the derived window only changes when the scroll crosses a
// row boundary (and with overscan, usually not even then). This hook keeps
// scrollTop in a ref and stores the WINDOW, updating state only when the range
// actually differs, so scrolling inside the overscan band costs zero renders.
import React from "react";
import { windowVariable } from "./diffRows";
import type { WindowRange } from "./useWindowedList";

function sameRange(a: WindowRange, b: WindowRange): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.topPad === b.topPad &&
    a.bottomPad === b.bottomPad
  );
}

/**
 * Exact variable-height window over `heights`, bound to a scroll container.
 *
 * Returns the window plus the scroll handler to attach. The window is
 * recomputed on scroll (from the ref, no state write unless it changed) and
 * whenever `heights` / `viewportH` change (new file, syntax arrival, layout).
 */
export function useVariableWindow(o: {
  heights: number[];
  viewportH: number;
  overscan?: number;
  scrollRef: React.RefObject<HTMLElement | null>;
}): { win: WindowRange; onScroll: () => void } {
  const { heights, viewportH, overscan = 8, scrollRef } = o;
  const scrollTopRef = React.useRef(0);
  const [win, setWin] = React.useState<WindowRange>(() =>
    windowVariable(heights, { scrollTop: 0, viewportH, overscan }),
  );

  // Inputs changed (rows rebuilt, viewport measured): recompute DURING render —
  // React's derive-state-in-render pattern — so a new file's rows are never
  // committed against the previous file's window, even for one frame. An
  // effect here would paint that stale frame first.
  const prev = React.useRef({ heights, viewportH, overscan });
  if (
    prev.current.heights !== heights ||
    prev.current.viewportH !== viewportH ||
    prev.current.overscan !== overscan
  ) {
    prev.current = { heights, viewportH, overscan };
    scrollTopRef.current = scrollRef.current?.scrollTop ?? scrollTopRef.current;
    const next = windowVariable(heights, {
      scrollTop: scrollTopRef.current,
      viewportH,
      overscan,
    });
    if (!sameRange(win, next)) setWin(next);
  }

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    scrollTopRef.current = el.scrollTop;
    const next = windowVariable(heights, {
      scrollTop: el.scrollTop,
      viewportH,
      overscan,
    });
    setWin((p) => (sameRange(p, next) ? p : next));
  }, [heights, viewportH, overscan, scrollRef]);

  return { win, onScroll };
}
