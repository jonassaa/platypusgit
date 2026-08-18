import { describe, expect, it } from "vitest";
import {
  clampPaneSize,
  DEFAULT_SIBLING_MIN,
  PANE_HANDLE_PX,
  paneMaxSize,
} from "./paneSize";

// The clamp is the whole of #162: the maximum is the container minus what the
// other side needs, so there is no arbitrary ceiling — and the two cases that
// break it if they are wrong are an UNMEASURED container (0) and a container
// too small to satisfy both floors.
describe("paneMaxSize", () => {
  const base = { min: 180, siblingMin: 320, container: 1200 };

  it("is the container minus the sibling floor and the handle", () => {
    expect(paneMaxSize(base)).toBe(1200 - 320 - PANE_HANDLE_PX);
  });

  it("grows with the container — there is no fixed ceiling", () => {
    const small = paneMaxSize({ ...base, container: 1200 });
    const large = paneMaxSize({ ...base, container: 5120 });
    expect(large).toBe(small + (5120 - 1200));
    // The old hard-coded maxima topped out at 800px for the largest pane.
    expect(large).toBeGreaterThan(800);
  });

  it("subtracts the other fixed panes in a three-pane container", () => {
    // RepoBrowser: tree | handle | preview (flexible) | handle | inspector.
    const reserve = 260 + PANE_HANDLE_PX;
    expect(paneMaxSize({ ...base, reserve })).toBe(
      1200 - 320 - reserve - PANE_HANDLE_PX,
    );
  });

  // The negative case. container - siblingMin - handle is below `min` (and can
  // be negative outright); the pane's own floor has to win, or a narrow window
  // collapses every pane to nothing and takes the handle off screen with it.
  it("never returns less than the pane's own minimum", () => {
    expect(paneMaxSize({ ...base, container: 400 })).toBe(180);
    expect(paneMaxSize({ ...base, container: 1 })).toBe(180);
    expect(paneMaxSize({ min: 180, siblingMin: 320, container: 300 })).toBe(180);
  });

  // The unmeasured case. 0 is "we do not know yet", NOT "no space": returning
  // `container - siblingMin` here would be negative, so every clamp would snap
  // to `min` and the persist path would write that over the user's size.
  it("is unbounded while the container is unmeasured", () => {
    expect(paneMaxSize({ ...base, container: 0 })).toBe(Infinity);
    expect(paneMaxSize({ ...base, container: -1 })).toBe(Infinity);
    expect(paneMaxSize({ ...base, container: NaN })).toBe(Infinity);
  });
});

describe("clampPaneSize", () => {
  const clamp = { min: 180, siblingMin: 320, container: 1200 };

  it("passes a size that already fits", () => {
    expect(clampPaneSize(400, clamp)).toBe(400);
  });

  it("caps at the container-relative maximum", () => {
    expect(clampPaneSize(5000, clamp)).toBe(1200 - 320 - PANE_HANDLE_PX);
  });

  it("floors at the minimum", () => {
    expect(clampPaneSize(10, clamp)).toBe(180);
  });

  it("leaves an oversized value alone while the container is unmeasured", () => {
    // A size persisted on a big display, read back before layout: it must
    // survive to be clamped by a REAL measurement, not by a 0.
    expect(clampPaneSize(720, { ...clamp, container: 0 })).toBe(720);
  });

  it("collapses to the minimum when the container cannot fit both floors", () => {
    expect(clampPaneSize(720, { ...clamp, container: 400 })).toBe(180);
  });

  it("falls back to the minimum for a non-finite size", () => {
    // A localStorage value can be anything; NaN in a style is an invisible pane.
    expect(clampPaneSize(NaN, clamp)).toBe(180);
  });

  it("has a defensible sibling default", () => {
    expect(clampPaneSize(5000, { min: 180, container: 1200, siblingMin: DEFAULT_SIBLING_MIN }))
      .toBe(1200 - DEFAULT_SIBLING_MIN - PANE_HANDLE_PX);
  });
});

// The three-pane layouts (RepoBrowser, CommitPanel) let the pane declared FIRST
// reserve only the second one's minimum, while the second reserves the first's
// actual size. That asymmetry is what keeps the two clamps from being circular —
// and this is the arithmetic proving the flexible middle still keeps its floor
// when the first pane takes everything it is allowed to.
describe("three-pane invariant", () => {
  it("leaves the middle pane its minimum even at the first pane's maximum", () => {
    const container = 1200;
    const middleMin = 320;
    const first = { min: 220, siblingMin: middleMin };
    const second = { min: 280, siblingMin: middleMin };

    const firstMax = paneMaxSize({
      ...first,
      reserve: second.min + PANE_HANDLE_PX,
      container,
    });
    // The second pane re-clamps against the first pane's NEW size in the same
    // render, so read its cap from `firstMax`, not from its own preference.
    const secondMax = paneMaxSize({
      ...second,
      reserve: firstMax + PANE_HANDLE_PX,
      container,
    });
    const middle = container - firstMax - secondMax - 2 * PANE_HANDLE_PX;

    expect(secondMax).toBe(second.min);
    expect(middle).toBe(middleMin);
  });
});
