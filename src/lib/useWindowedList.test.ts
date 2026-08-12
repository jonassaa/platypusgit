// Windowing math for fixed-pitch lists (#68 G10, #61 A8).
//
// The padded-height invariant is the one that matters beyond aesthetics:
// FocusableScroll implements End as `scrollTop = scrollHeight` and PageUp/Dn
// off clientHeight, so a scroll body shorter than the real list breaks both.
import { describe, expect, it } from "vitest";
import { windowRange } from "./useWindowedList";

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
