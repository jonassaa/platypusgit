// Fixed-pitch list windowing (#68 G10, and the History half of #61 A8).
//
// Kept generic and free of commit-graph knowledge so the file tree can adopt
// the same helper rather than growing a second implementation.
//
// Row pitch is always passed in by the caller — History derives it from
// COMMIT_ROW_BASE_H + useDensityStep(). A literal here would silently desync
// the window from the rows at any non-compact density (#70).
import React from "react";

export interface WindowRange {
  /** First rendered index, inclusive. */
  start: number;
  /** Last rendered index, exclusive. */
  end: number;
  /** Spacer height above the rendered slice, in px. */
  topPad: number;
  /** Spacer height below it. topPad + rendered + bottomPad === count * rowHeight. */
  bottomPad: number;
}

export function windowRange(o: {
  scrollTop: number;
  viewportH: number;
  rowHeight: number;
  count: number;
  overscan: number;
}): WindowRange {
  const { scrollTop, viewportH, rowHeight, count, overscan } = o;
  if (count <= 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  // Before first layout the viewport measures 0. Render a screenful anyway so
  // the list is never blank on first paint and e2e can find a row immediately.
  const visible = Math.max(1, Math.ceil((viewportH || rowHeight * 20) / rowHeight));
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, start + visible + overscan * 2);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (count - end) * rowHeight),
  };
}

export function useWindowedList<T extends HTMLElement = HTMLDivElement>(o: {
  count: number;
  rowHeight: number;
  overscan?: number;
  /**
   * Scroll element to observe. Omit and the hook provides its own ref for the
   * caller to attach. Supply one when the caller already owns the scroller —
   * RepoBrowser's tree scrolls in a div that also holds the empty state and
   * spinner, so ownership cannot move into here without restructuring it.
   *
   * Generic over the element type so each caller keeps its concrete ref type
   * (a `<div>` ref stays `RefObject<HTMLDivElement>`).
   */
  viewportRef?: React.RefObject<T | null>;
}) {
  const { count, rowHeight, overscan = 8 } = o;
  const ownRef = React.useRef<T>(null);
  const viewportRef = o.viewportRef ?? ownRef;
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);

  // Measure + observe the scroll element, re-binding whenever it CHANGES.
  //
  // Deliberately has no dependency array. A ref's `.current` is not reactive, so
  // an `[]` effect that bailed on a null ref would never retry: a caller whose
  // scroller mounts later (behind a loading guard) or swaps element identity
  // would be left with viewportH === 0 forever, permanently falling back to the
  // `rowHeight * 20` screenful in `windowRange` — a tall window renders blank
  // below that and resizing never fixes it. Running every render costs one ref
  // comparison, and the identity guard keeps it from re-creating the observer.
  const observedRef = React.useRef<T | null>(null);
  const roRef = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => {
    const el = viewportRef.current;
    if (el === observedRef.current) return;
    roRef.current?.disconnect();
    roRef.current = null;
    observedRef.current = el;
    if (!el) return;
    setViewportH(el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    roRef.current = ro;
  });

  // Unmount-only teardown. The measuring effect above cannot own this: with no
  // dependency array its cleanup would run after every render.
  React.useEffect(
    () => () => {
      roRef.current?.disconnect();
      roRef.current = null;
      observedRef.current = null;
    },
    [],
  );

  const onScroll = React.useCallback(() => {
    const el = viewportRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  /**
   * Scroll a row into view BY INDEX. Must not go through the DOM: under
   * windowing the target row is usually not mounted, so a querySelector would
   * find nothing and keyboard navigation would silently stop scrolling.
   */
  const scrollToIndex = React.useCallback(
    (i: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const top = i * rowHeight;
      const bottom = top + rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight;
      }
    },
    [rowHeight],
  );

  const range = windowRange({ scrollTop, viewportH, rowHeight, count, overscan });
  return { ...range, onScroll, viewportRef, scrollToIndex };
}
