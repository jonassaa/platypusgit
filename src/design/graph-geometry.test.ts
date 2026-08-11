import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_W,
  GRAPH_PAD,
  LANE_W,
  commitRowGrid,
  graphWidth,
  isGraphClamped,
  laneX,
  maxVisibleCol,
} from "./graph-geometry";

describe("graph geometry", () => {
  it("pins the lane constants", () => {
    // Literals, not derived: if any of these move, the SVG path math and the
    // row grids must be re-checked together.
    expect(GRAPH_PAD).toBe(12);
    expect(LANE_W).toBe(16);
    expect(GRAPH_MAX_W).toBe(240);
  });

  it("places lane centres 16px apart from a 12px pad", () => {
    expect(laneX(0)).toBe(12);
    expect(laneX(1)).toBe(28);
    expect(laneX(8)).toBe(140);
  });

  it("sizes a single-lane log to fit its dot", () => {
    expect(graphWidth(0)).toBe(24);
  });

  // THE G1 REGRESSION. The old gutter was a fixed 140px while lane 8 sits at
  // x=140 — the dot (r=4) was half-cut and lane 9+ vanished entirely.
  it("gives column 8 room the old fixed 140px did not", () => {
    expect(graphWidth(8)).toBe(152);
    expect(graphWidth(8)).toBeGreaterThan(140);
    expect(laneX(8) + 4).toBeLessThanOrEqual(graphWidth(8));
  });

  it("keeps every node dot inside the gutter up to the clamp", () => {
    for (let col = 0; col <= maxVisibleCol(); col++) {
      expect(laneX(col) + 4).toBeLessThanOrEqual(graphWidth(col));
    }
  });

  it("clamps runaway lane counts instead of growing without bound", () => {
    expect(maxVisibleCol()).toBe(13);
    expect(graphWidth(13)).toBe(232);
    expect(isGraphClamped(13)).toBe(false);
    expect(graphWidth(14)).toBe(GRAPH_MAX_W);
    expect(isGraphClamped(14)).toBe(true);
    expect(graphWidth(100)).toBe(GRAPH_MAX_W);
    expect(isGraphClamped(100)).toBe(true);
  });

  it("builds a five-column grid with the graph, four without", () => {
    expect(commitRowGrid(152)).toBe("152px 70px 1fr 150px 90px");
    // graphW of 0 means "no graph column at all" (Reflog), which is NOT the
    // same as graphWidth(0)=24, a real one-lane log.
    expect(commitRowGrid(0)).toBe("70px 1fr 150px 90px");
    expect(commitRowGrid(0).split(" ")).toHaveLength(4);
  });
});
