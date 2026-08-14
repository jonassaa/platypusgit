import React from "react";

/**
 * Measured height of a scroll container, for the windowing helpers.
 *
 * Deliberately does NOT depend on ResizeObserver for correctness. Each diff
 * surface used to write this inline as
 *
 *   if (!el || typeof ResizeObserver === "undefined") return;
 *   setViewportH(el.clientHeight);
 *
 * — the guard came first, so on a webview without ResizeObserver the initial
 * measurement never ran and the height stayed 0. `windowVariable` then fell back
 * to a 400px viewport, so in a taller pane the rows past 400px were never
 * mounted and the bottom of the diff rendered blank. WebKitGTK 605, which is the
 * Linux webview and the e2e target, is exactly such a webview. Short chunked
 * diffs always fit inside the fallback, which is why it went unnoticed until
 * whole-file diffs made the row list long.
 *
 * `remeasure` is for the scroll handler: it reads the DOM only while the height
 * is still unknown, so the common case costs nothing and no forced layout
 * happens on every scroll event.
 */
export function useViewportH(
  ref: React.RefObject<HTMLElement | null>,
  /** Re-measure when any of these change — a mode switch, or a new row list. */
  deps: React.DependencyList = [],
): { viewportH: number; remeasure: () => void } {
  const [viewportH, setViewportH] = React.useState(0);

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (el) setViewportH(el.clientHeight);
  }, [ref]);

  React.useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setViewportH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  const remeasure = React.useCallback(() => {
    if (viewportH === 0) measure();
  }, [viewportH, measure]);

  return { viewportH, remeasure };
}
