import { describe, it, expect } from "vitest";
import { pickNeighbor, topLeftmost, type Rect } from "./spatial";

const r = (left: number, top: number, w: number, h: number): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

// Layout: bar | tree | preview | inspector  (a horizontal row), each 100 wide.
const bar = { id: "bar", rect: r(0, 0, 44, 600) };
const tree = { id: "tree", rect: r(44, 0, 200, 600) };
const preview = { id: "preview", rect: r(244, 0, 400, 600) };
const inspector = { id: "inspector", rect: r(644, 0, 200, 600) };
const all = [bar, tree, preview, inspector];

describe("pickNeighbor", () => {
  it("moves right to the adjacent pane", () => {
    expect(pickNeighbor(tree.rect, all, "right")).toBe("preview");
  });
  it("moves left to the adjacent pane", () => {
    expect(pickNeighbor(preview.rect, all, "left")).toBe("tree");
  });
  it("leftmost content pane finds the bar on the left", () => {
    expect(pickNeighbor(tree.rect, all, "left")).toBe("bar");
  });
  it("returns null past the edge", () => {
    expect(pickNeighbor(inspector.rect, all, "right")).toBe(null);
    expect(pickNeighbor(bar.rect, all, "left")).toBe(null);
  });
  it("prefers the vertically-aligned pane when stacked options exist", () => {
    // Two panes to the right: one aligned, one far off vertically.
    const curR = r(0, 100, 50, 50);
    const aligned = { id: "aligned", rect: r(100, 100, 50, 50) };
    const offset = { id: "offset", rect: r(90, 900, 50, 50) };
    expect(pickNeighbor(curR, [aligned, offset], "right")).toBe("aligned");
  });
});

describe("topLeftmost", () => {
  it("picks topmost then leftmost", () => {
    const a = { id: "a", rect: r(200, 0, 50, 50) };
    const b = { id: "b", rect: r(0, 0, 50, 50) };
    const c = { id: "c", rect: r(0, 100, 50, 50) };
    expect(topLeftmost([a, b, c])).toBe("b");
  });
});
