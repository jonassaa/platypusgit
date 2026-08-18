import React from "react";

/**
 * How many frames to keep re-reading an element that measured 0. A pre-layout
 * read is normally fixed by the very next frame; the bound is what keeps a
 * genuinely hidden container (`display: none`, a collapsed detail panel) from
 * polling for the lifetime of the mount.
 */
const MAX_MEASURE_FRAMES = 10;

export type ElementSize = {
  /**
   * Attach to the element to measure. A ref CALLBACK, not a RefObject, so a
   * container that unmounts and remounts (History's detail panel switching
   * between the below/beside layouts) is re-measured and re-observed without
   * the caller having to maintain a dependency list.
   */
  ref: (node: HTMLElement | null) => void;
  /** `clientWidth`, or 0 while unmeasured. */
  width: number;
  /** `clientHeight`, or 0 while unmeasured. */
  height: number;
};

/**
 * Measured content box of an element, on BOTH axes — the width analogue of
 * `useViewportH`, generalised.
 *
 * Same rule as that hook, for the same reason: **the first measurement never
 * sits behind a `typeof ResizeObserver` guard.** WebKitGTK 605 (the Linux
 * webview, and the e2e target) has no `ResizeObserver`, so a guard placed before
 * the initial read leaves the size 0 forever there — and 0 is not a harmless
 * "unknown" for a pane clamp: `container - siblingMin` goes negative, every
 * clamp collapses to its minimum, and a persisted size would be overwritten with
 * that. So the read comes first and the observer is a bonus.
 *
 * Three things can deliver a new measurement, in order of how much they cover:
 *
 * 1. `window`'s `resize` event — universal, and the case the pane clamp exists
 *    for (a window moved to a smaller display, or resized). This is the whole
 *    re-clamp path on a webview with no `ResizeObserver`.
 * 2. `ResizeObserver`, when the webview has one — catches a container that
 *    changed size without the window changing (a sibling panel appearing).
 * 3. A bounded `requestAnimationFrame` poll while the size still reads 0 —
 *    covers a commit-time read that landed before layout, which is otherwise
 *    invisible to both of the above.
 *
 * 0 means "not measured yet" and callers must treat it as "no constraint known",
 * never as "no space".
 */
export function useElementSize(): ElementSize {
  const [size, setSize] = React.useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // The node lives in state as well as being measured on attach, so the effect
  // below re-runs (re-observes, re-measures) when the element is replaced.
  const [node, setNode] = React.useState<HTMLElement | null>(null);

  const apply = React.useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const ref = React.useCallback(
    (next: HTMLElement | null) => {
      setNode(next);
      // Measure on attach — before any capability check, and before paint, so a
      // clamp has a real number on the first render that can use one.
      apply(next);
    },
    [apply],
  );

  React.useEffect(() => {
    if (!node) return;
    const measure = () => apply(node);
    // Again after paint: the attach-time read can precede layout.
    measure();

    window.addEventListener("resize", measure);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(node);
    }

    let raf = 0;
    let frames = 0;
    const canAnimate = typeof requestAnimationFrame === "function";
    const poll = () => {
      raf = 0;
      measure();
      if (node.clientWidth > 0 && node.clientHeight > 0) return;
      if (++frames >= MAX_MEASURE_FRAMES) return;
      raf = requestAnimationFrame(poll);
    };
    if (canAnimate && (node.clientWidth === 0 || node.clientHeight === 0)) {
      raf = requestAnimationFrame(poll);
    }

    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [node, apply]);

  return { ref, width: size.width, height: size.height };
}
