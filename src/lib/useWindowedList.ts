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

export function useWindowedList(o: {
  count: number;
  rowHeight: number;
  overscan?: number;
}) {
  const { count, rowHeight, overscan = 8 } = o;
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
