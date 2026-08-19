// The regression this hook exists for: measuring must not depend on
// ResizeObserver. WebKitGTK 605 (the Linux webview) has none, and the previous
// inline version guarded before its initial measurement, leaving the height 0 —
// which made windowVariable fall back to a 400px viewport and render the bottom
// of a taller diff pane blank.
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { act, render, renderHook } from "@testing-library/react";
import { useViewportH } from "./useViewportH";
import { stubContainerSize } from "@/test/elementSize";

const realRO = globalThis.ResizeObserver;

afterEach(() => {
  globalThis.ResizeObserver = realRO;
});

function refTo(height: number): React.RefObject<HTMLElement | null> {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  return { current: el };
}

describe("useViewportH", () => {
  it("measures on mount when ResizeObserver exists", () => {
    const { result } = renderHook(() => useViewportH(refTo(704)));
    expect(result.current.viewportH).toBe(704);
  });

  it("still measures on mount with NO ResizeObserver", () => {
    // @ts-expect-error deliberately removing it, as the old webview does
    delete globalThis.ResizeObserver;
    const { result } = renderHook(() => useViewportH(refTo(704)));
    expect(result.current.viewportH).toBe(704);
  });

  // The other half of the same trap: every diff surface renders its scroll
  // container only once the diff has ARRIVED, so the mount-time measurement reads
  // a null ref and the mount-time effect never runs again — its deps have not
  // changed, and there was no element to observe either. The height then stayed 0
  // until the reader scrolled, which silently switched off everything that treats
  // 0 as "unmeasured" (`scrollTopForRow`, and the issue-188 auto-open).
  it("measures a container that mounts LATER, with no ResizeObserver and no dep change", () => {
    // @ts-expect-error deliberately removing it, as the old webview does
    delete globalThis.ResizeObserver;
    const restore = stubContainerSize({ height: 704 });
    try {
      let flip = () => {};
      let seen = -1;
      function Harness() {
        const ref = React.useRef<HTMLDivElement | null>(null);
        const [ready, setReady] = React.useState(false);
        flip = () => setReady(true);
        seen = useViewportH(ref).viewportH;
        // Deliberately NO deps argument, and the container is absent at mount —
        // exactly the shape all four diff surfaces have.
        return ready ? <div ref={ref} /> : null;
      }
      render(<Harness />);
      expect(seen).toBe(0);
      act(() => flip());
      expect(seen).toBe(704);
    } finally {
      restore();
    }
  });

  // The diff surfaces unmount their scroll container while the next file's diff is
  // in flight, and a stale height there reads as "measured" to everything that
  // gates on it — which is how the issue-188 auto-open came to fire into a pane
  // that was not on screen.
  it("goes back to 0 when the container UNMOUNTS, rather than keeping its height", () => {
    const restore = stubContainerSize({ height: 704 });
    try {
      let flip = () => {};
      let seen = -1;
      function Harness() {
        const ref = React.useRef<HTMLDivElement | null>(null);
        const [shown, setShown] = React.useState(true);
        flip = () => setShown((v) => !v);
        seen = useViewportH(ref).viewportH;
        return shown ? <div ref={ref} /> : null;
      }
      render(<Harness />);
      expect(seen).toBe(704);
      act(() => flip()); // container goes away
      expect(seen).toBe(0);
      act(() => flip()); // ...and comes back
      expect(seen).toBe(704);
    } finally {
      restore();
    }
  });

  it("reports 0 for a detached ref, rather than throwing", () => {
    const { result } = renderHook(() =>
      useViewportH({ current: null } as React.RefObject<HTMLElement | null>),
    );
    expect(result.current.viewportH).toBe(0);
  });
});
