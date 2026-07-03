import { describe, it, expect } from "vitest";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  type Selection,
} from "./selection";

const order = ["a", "b", "c", "d", "e"];

describe("clickSelection", () => {
  it("plain click selects a single row and moves the anchor", () => {
    const s1 = clickSelection(order, emptySelection, "b");
    expect(s1).toEqual({ keys: ["b"], anchor: "b" });
    const s2 = clickSelection(order, s1, "d");
    expect(s2).toEqual({ keys: ["d"], anchor: "d" });
  });

  it("ctrl-click toggles rows in and moves the anchor", () => {
    let s: Selection = clickSelection(order, emptySelection, "a");
    s = clickSelection(order, s, "c", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c"], anchor: "c" });
    s = clickSelection(order, s, "e", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c", "e"], anchor: "e" });
  });

  it("ctrl-click toggles a selected row out, keeping the anchor if it survives", () => {
    let s: Selection = { keys: ["a", "c", "e"], anchor: "e" };
    s = clickSelection(order, s, "c", { toggle: true });
    expect(s).toEqual({ keys: ["a", "e"], anchor: "e" });
  });

  it("ctrl-click toggling the anchor out re-homes it to the last selected row", () => {
    let s: Selection = { keys: ["a", "c", "e"], anchor: "e" };
    s = clickSelection(order, s, "e", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c"], anchor: "c" });
  });

  it("ctrl-click toggling the only row out empties the selection", () => {
    const s = clickSelection(order, { keys: ["b"], anchor: "b" }, "b", {
      toggle: true,
    });
    expect(s).toEqual({ keys: [], anchor: null });
  });

  it("shift-click selects the range from the anchor, forward", () => {
    const start = clickSelection(order, emptySelection, "b");
    const s = clickSelection(order, start, "d", { range: true });
    expect(s).toEqual({ keys: ["b", "c", "d"], anchor: "b" });
  });

  it("shift-click selects the range from the anchor, backward", () => {
    const start = clickSelection(order, emptySelection, "d");
    const s = clickSelection(order, start, "a", { range: true });
    expect(s).toEqual({ keys: ["a", "b", "c", "d"], anchor: "d" });
  });

  it("successive shift-clicks re-extend from the same anchor", () => {
    let s = clickSelection(order, emptySelection, "c");
    s = clickSelection(order, s, "e", { range: true });
    expect(s.keys).toEqual(["c", "d", "e"]);
    s = clickSelection(order, s, "a", { range: true });
    expect(s).toEqual({ keys: ["a", "b", "c"], anchor: "c" });
  });

  it("shift-click without an anchor behaves like a plain click", () => {
    const s = clickSelection(order, emptySelection, "c", { range: true });
    expect(s).toEqual({ keys: ["c"], anchor: "c" });
  });

  it("shift-click with a vanished anchor degrades to plain click", () => {
    const s = clickSelection(order, { keys: ["zz"], anchor: "zz" }, "b", {
      range: true,
    });
    expect(s).toEqual({ keys: ["b"], anchor: "b" });
  });

  it("range wins when both modifiers are held", () => {
    const start = clickSelection(order, emptySelection, "a");
    const s = clickSelection(order, start, "c", { range: true, toggle: true });
    expect(s.keys).toEqual(["a", "b", "c"]);
  });
});

describe("pruneSelection", () => {
  it("returns the same reference when nothing changed", () => {
    const s: Selection = { keys: ["a", "b"], anchor: "a" };
    expect(pruneSelection(s, new Set(order))).toBe(s);
  });

  it("drops keys that no longer exist", () => {
    const s: Selection = { keys: ["a", "b", "c"], anchor: "a" };
    expect(pruneSelection(s, new Set(["a", "c"]))).toEqual({
      keys: ["a", "c"],
      anchor: "a",
    });
  });

  it("re-homes a vanished anchor to the last surviving key", () => {
    const s: Selection = { keys: ["a", "b", "c"], anchor: "b" };
    expect(pruneSelection(s, new Set(["a", "c"]))).toEqual({
      keys: ["a", "c"],
      anchor: "c",
    });
  });

  it("empties out entirely when no keys survive", () => {
    const s: Selection = { keys: ["a"], anchor: "a" };
    expect(pruneSelection(s, new Set())).toEqual({ keys: [], anchor: null });
  });
});

describe("primarySelectedKey", () => {
  it("prefers the anchor while selected", () => {
    expect(primarySelectedKey({ keys: ["a", "b"], anchor: "a" })).toBe("a");
  });

  it("falls back to the last selected key", () => {
    expect(primarySelectedKey({ keys: ["a", "b"], anchor: "zz" })).toBe("b");
  });

  it("is null for an empty selection", () => {
    expect(primarySelectedKey(emptySelection)).toBeNull();
  });
});
