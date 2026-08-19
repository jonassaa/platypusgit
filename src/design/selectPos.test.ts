import { describe, expect, it } from "vitest";
import { selectPopoverPos } from "./selectPos";

const VP = { viewportW: 1200, viewportH: 800 };
const at = (left: number, top: number, h = 28) => ({ left, top, bottom: top + h });

describe("selectPopoverPos", () => {
  it("hangs below the trigger when there is room", () => {
    expect(
      selectPopoverPos({ anchor: at(100, 200), listW: 180, listH: 120, ...VP }),
    ).toEqual({ left: 100, top: 230 });
  });

  it("flips above the trigger when there is not", () => {
    // Trigger near the bottom: 700+28+2+120+4 > 800, so it goes up.
    expect(
      selectPopoverPos({ anchor: at(100, 700), listW: 180, listH: 120, ...VP }),
    ).toEqual({ left: 100, top: 578 });
  });

  it("clamps a wide list back inside the right edge", () => {
    expect(
      selectPopoverPos({ anchor: at(1100, 200), listW: 300, listH: 60, ...VP }).left,
    ).toBe(896);
  });

  it("keeps a left-edge trigger off the very edge", () => {
    expect(
      selectPopoverPos({ anchor: at(0, 200), listW: 180, listH: 60, ...VP }).left,
    ).toBe(4);
  });

  // The case a WebKitGTK screenshot found: Settings' keymap picker sat below the
  // fold of a scrolled pane, so BOTH candidate positions were off-screen and the
  // list rendered at y≈1130 in an 800px window. The shell is a fixed frame
  // (overflow: hidden), so nothing could ever scroll it into view.
  it("pulls the list back on screen when the ANCHOR itself is off the viewport", () => {
    const pos = selectPopoverPos({
      anchor: at(600, 1130),
      listW: 200,
      listH: 100,
      ...VP,
    });
    expect(pos.top).toBe(696);
    expect(pos.top + 100).toBeLessThanOrEqual(800);
  });

  it("does the same for an anchor scrolled off the TOP", () => {
    const pos = selectPopoverPos({
      anchor: at(600, -400),
      listW: 200,
      listH: 100,
      ...VP,
    });
    // -400+28+2 = -370 fits below, but is above the viewport — clamped to the edge.
    expect(pos.top).toBe(4);
  });

  it("pins a list taller than the viewport to the top edge rather than negative", () => {
    const pos = selectPopoverPos({
      anchor: at(100, 400),
      listW: 200,
      listH: 900,
      ...VP,
    });
    expect(pos.top).toBe(4);
  });

  it("treats an unmeasured list (0×0) as the plain below-the-trigger case", () => {
    // jsdom's every measurement. It must not resolve to something absurd — the
    // layout effect re-runs with real numbers on the next open.
    expect(
      selectPopoverPos({ anchor: at(50, 60), listW: 0, listH: 0, ...VP }),
    ).toEqual({ left: 50, top: 90 });
  });
});
