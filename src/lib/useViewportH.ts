import React from "react";

/**
 * How many frames to keep re-reading a container that measured 0 — the same
 * bound, for the same reason, as `useElementSize`'s: a pre-layout read is fixed
 * by the next frame, and the bound is what stops a genuinely hidden container
 * from polling for the lifetime of the mount.
 */
const MAX_MEASURE_FRAMES = 10;

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
 *
 * **The container usually mounts AFTER this hook does**, and that is the second
 * half of the same trap. Every diff surface renders its scroll container only
 * once the diff has arrived (`isTextualDiff(diff) && …`), so the mount-time
 * `measure()` reads a `ref.current` of `null` and the mount-time effect never
 * runs again: its deps have not changed. On a webview WITH `ResizeObserver`
 * there is no observer either — there was no element to observe. So the height
 * stayed 0 until the reader happened to scroll (which is what `remeasure`
 * rescues), `windowVariable` fell back to its 400px viewport, and anything that
 * treats 0 as "not measured" (`scrollTopForRow`, `diffOpenReady`) simply never
 * fired. Hence the node-attach effect below: it runs after EVERY render, does
 * nothing but compare `ref.current` to the node it last saw, and measures when
 * that changes — the RefObject equivalent of `useElementSize`'s ref callback,
 * plus that hook's bounded rAF poll for a read that lands before layout.
 *
 * 0 therefore means "no measured container right now", covering both "not yet"
 * and "not any more" — never "no space". Callers must treat it that way.
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

  // Node-attach detection, on EVERY render — see the note above. Cheap: one
  // property read and one comparison unless the element actually changed, and
  // `setViewportH` with an equal number is a no-op React bails out of, so this
  // cannot loop.
  const seen = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el === seen.current) return;
    seen.current = el;
    // A container that goes AWAY reports 0, i.e. UNMEASURED — not its last known
    // height. Keeping the stale number is what let the issue-188 auto-open fire
    // into a pane that was not on screen: the diff surfaces unmount their scroll
    // container while `diffLoading`, the diff and the file text can both land
    // before that flag clears, and every other readiness term was then satisfied
    // with `scrollRef.current === null`. The scroll silently did nothing, the
    // once-per-file budget was spent, and the file stayed at line 1. 0 is the
    // honest answer and it is the one term that comes BACK when the container
    // does, which is what makes the open retry at the right moment.
    if (!el) {
      setViewportH(0);
      return;
    }
    // Effects run after the DOM is committed, so this forces layout and reads
    // the real box — the same thing useElementSize's attach-time read relies on.
    setViewportH(el.clientHeight);
    if (el.clientHeight > 0 || typeof requestAnimationFrame !== "function") return;
    let raf = 0;
    let frames = 0;
    const poll = () => {
      raf = 0;
      if (ref.current !== el) return;
      setViewportH(el.clientHeight);
      if (el.clientHeight > 0 || ++frames >= MAX_MEASURE_FRAMES) return;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  });

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
