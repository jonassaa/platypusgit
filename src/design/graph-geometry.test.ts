import { describe, expect, it } from "vitest";
import { DATE_FORMATS } from "@/lib/commitDate";
import {
  DATE_COL_W,
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

  // The Date column's width follows the user's date format (#354): a
  // "2026-08-14 13:42" stamp is 16 monospace characters and does not fit the
  // 90px a "3w ago" needs. The header and every row call THIS function with
  // the same width, which is what keeps them from drifting apart.
  it("defaults the date column to the relative width", () => {
    expect(DATE_COL_W.relative).toBe(90);
    expect(commitRowGrid(152)).toBe(commitRowGrid(152, DATE_COL_W.relative));
  });

  it("widens the date column for the stamp formats", () => {
    expect(DATE_COL_W.absolute).toBeGreaterThan(DATE_COL_W.relative);
    expect(DATE_COL_W.both).toBeGreaterThan(DATE_COL_W.absolute);
    expect(commitRowGrid(152, DATE_COL_W.absolute)).toBe(
      `152px 70px 1fr 150px ${DATE_COL_W.absolute}px`,
    );
    expect(commitRowGrid(0, DATE_COL_W.both)).toBe(`70px 1fr 150px ${DATE_COL_W.both}px`);
  });

  // Fixed-width monospace: the widest string the mode can produce has to fit,
  // or the stamp is clipped mid-minute on every row at once.
  it("gives every format room for the widest string it can render", () => {
    const CH = 7.25; // --fs-12 monospace advance, measured
    const widest = {
      relative: "12mo ago".length,
      absolute: "2026-08-14 13:42".length,
      both: "2026-08-14 13:42 (12mo ago)".length,
    };
    for (const mode of DATE_FORMATS) {
      expect(DATE_COL_W[mode]).toBeGreaterThanOrEqual(Math.ceil(widest[mode] * CH));
    }
  });
});
