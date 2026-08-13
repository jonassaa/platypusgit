// Windowing math for fixed-pitch lists (#68 G10, #61 A8).
//
// The padded-height invariant is the one that matters beyond aesthetics:
// FocusableScroll implements End as `scrollTop = scrollHeight` and PageUp/Dn
// off clientHeight, so a scroll body shorter than the real list breaks both.
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWindowedList, windowRange } from "./useWindowedList";

describe("windowRange", () => {
  it("returns the visible slice plus overscan", () => {
    const r = windowRange({
      scrollTop: 0, viewportH: 100, rowHeight: 10, count: 100, overscan: 2,
    });
    expect(r.start).toBe(0);
    // 10 visible + overscan on BOTH sides. `start` is clamped at 0, so the
    // leading overscan has nowhere to go and the window is simply deeper.
    expect(r.end).toBe(14);
  });

  it("clamps at both ends", () => {
    expect(
      windowRange({ scrollTop: 0, viewportH: 100, rowHeight: 10, count: 3, overscan: 8 }).end,
    ).toBe(3);
    const tail = windowRange({
      scrollTop: 990, viewportH: 100, rowHeight: 10, count: 100, overscan: 2,
    });
    expect(tail.end).toBe(100);
    expect(tail.start).toBeLessThan(100);
  });

  it("keeps total padded height equal to the full list height", () => {
    const r = windowRange({
      scrollTop: 300, viewportH: 100, rowHeight: 10, count: 100, overscan: 2,
    });
    expect(r.topPad + (r.end - r.start) * 10 + r.bottomPad).toBe(1000);
  });

  it("keeps the invariant at the very end of the list", () => {
    const r = windowRange({
      scrollTop: 900, viewportH: 100, rowHeight: 10, count: 100, overscan: 8,
    });
    expect(r.topPad + (r.end - r.start) * 10 + r.bottomPad).toBe(1000);
    expect(r.bottomPad).toBe(0);
  });

  it("survives a zero viewport (first paint, before layout)", () => {
    const r = windowRange({
      scrollTop: 0, viewportH: 0, rowHeight: 10, count: 50, overscan: 2,
    });
    expect(r.end).toBeGreaterThan(r.start);
  });

  it("renders nothing for an empty list without going negative", () => {
    const r = windowRange({
      scrollTop: 0, viewportH: 100, rowHeight: 10, count: 0, overscan: 8,
    });
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
    expect(r.topPad).toBe(0);
    expect(r.bottomPad).toBe(0);
  });
});

describe("useWindowedList viewport ownership (#61 A8)", () => {
  it("uses a caller-supplied viewport instead of creating one", () => {
    // RepoBrowser already owns its scroll div (the empty state and spinner are
    // siblings of the tree inside it), so the hook must observe that element
    // rather than demanding ownership of one.
    const external = { current: document.createElement("div") };
    const { result } = renderHook(() =>
      useWindowedList({ count: 100, rowHeight: 10, viewportRef: external }),
    );
    expect(result.current.viewportRef).toBe(external);
  });

  it("still provides its own viewport when the caller supplies none", () => {
    const { result } = renderHook(() =>
      useWindowedList({ count: 100, rowHeight: 10 }),
    );
    expect(result.current.viewportRef).toBeTruthy();
    expect(result.current.viewportRef.current).toBeNull();
  });

  it("reads the caller's element when scrolling to an index", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
    const external = { current: el };
    const { result } = renderHook(() =>
      useWindowedList({ count: 100, rowHeight: 10, viewportRef: external }),
    );

    // Row 50 sits at 500..510, far below a 100px viewport at scrollTop 0.
    result.current.scrollToIndex(50);
    expect(el.scrollTop).toBe(510 - 100);
  });
});
