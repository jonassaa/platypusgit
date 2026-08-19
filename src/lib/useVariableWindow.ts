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
 * Returns the window, the scroll handler to attach, and `scrollTo` — which a
 * PROGRAMMATIC scroll should go through. The window is recomputed on scroll (from
 * the ref, no state write unless it changed) and whenever `heights` / `viewportH`
 * change (new file, syntax arrival, layout).
 *
 * **A programmatic `scrollTop` write is not a scroll event you can count on**, and
 * that is why `scrollTo` exists (issue 188). MEASURED on WebKitGTK 605 under xvfb:
 * an `el.scrollTop = 1881` assignment made inside an effect left the DOM scrolled
 * and `win` still describing the TOP of the file — start 0, one spacer — for
 * seconds, until an unrelated re-render happened to recompute it during render.
 * The target row is unmounted for that whole time, so anything waiting on it (F7's
 * `data-hunk-active`, the line cursor's focus ring, the issue-188 auto-open) sees
 * nothing at all, on the engine CI runs. It works often enough elsewhere to look
 * fine: the syntax tokens usually land right after and rebuild `heights`, which
 * recomputes the window from the ref — but a cache hit removes even that.
 *
 * Two programmatic scrolls still write `scrollTop` directly and inherit the same
 * hazard, both outside this change's blast radius and neither yet observed to
 * misbehave: `FocusableScroll`'s Home/End and `DiffMinimap`'s scrub. Both would
 * need this handle threaded to them; route them through here when one of them is
 * next touched rather than as a drive-by.
 */
export function useVariableWindow(o: {
  heights: number[];
  viewportH: number;
  overscan?: number;
  scrollRef: React.RefObject<HTMLElement | null>;
}): { win: WindowRange; onScroll: () => void; scrollTo: (top: number) => void } {
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

  // Assign AND publish, in one call, so a programmatic scroll never depends on
  // the engine dispatching an event for it. A real user scroll still arrives
  // through `onScroll`; this is the same computation, just not waiting.
  const scrollTo = React.useCallback(
    (top: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = top;
      onScroll();
    },
    [onScroll, scrollRef],
  );

  return { win, onScroll, scrollTo };
}
