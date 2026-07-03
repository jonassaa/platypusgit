import { describe, it, expect, beforeEach } from "vitest";
import { usePaletteStore } from "./usePaletteStore";

const reset = () =>
  usePaletteStore.setState({
    open: false,
    stack: [{ kind: "root" }],
    query: "",
    activeChip: "all",
  });

describe("usePaletteStore", () => {
  beforeEach(reset);

  it("openPalette resets to a single root step", () => {
    usePaletteStore.setState({ query: "x", activeChip: "branch" });
    usePaletteStore.getState().openPalette();
    const s = usePaletteStore.getState();
    expect(s.open).toBe(true);
    expect(s.stack).toEqual([{ kind: "root" }]);
    expect(s.query).toBe("");
    expect(s.activeChip).toBe("all");
  });

  it("pushStep appends a step and clears the query", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().setQuery("merge");
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "Merge", items: [] });
    const s = usePaletteStore.getState();
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1].kind).toBe("pick");
    expect(s.query).toBe("");
  });

  it("pushStep reopens a closed palette (chained picks close before pushing)", () => {
    // Chain flows (e.g. reset → pick commit → pick mode) go through item
    // builders whose run() closes the palette before onPick pushes the next
    // step; the pushed step must still render.
    usePaletteStore.getState().openPalette();
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "Reset to commit", items: [] });
    usePaletteStore.getState().closePalette();
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "Reset mode", items: [] });
    const s = usePaletteStore.getState();
    expect(s.open).toBe(true);
    expect(s.stack).toHaveLength(3);
  });

  it("popStep removes the top step", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore
      .getState()
      .pushStep({ kind: "pick", title: "X", items: [] });
    usePaletteStore.getState().popStep();
    expect(usePaletteStore.getState().stack).toHaveLength(1);
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it("popStep at root closes the palette", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().popStep();
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it("setChip updates the active chip", () => {
    usePaletteStore.getState().setChip("file");
    expect(usePaletteStore.getState().activeChip).toBe("file");
  });

  it("pushStep with input step + initial seeds query to initial", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().setQuery("something");
    usePaletteStore.getState().pushStep({
      kind: "input", title: "Rename", placeholder: "name",
      initial: "foo",
      onSubmit: () => {},
    });
    expect(usePaletteStore.getState().query).toBe("foo");
  });

  it("pushStep with pick step clears query to empty string", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().setQuery("hello");
    usePaletteStore.getState().pushStep({ kind: "pick", title: "X", items: [] });
    expect(usePaletteStore.getState().query).toBe("");
  });

  it("pushStep with input step without initial clears query to empty string", () => {
    usePaletteStore.getState().openPalette();
    usePaletteStore.getState().setQuery("hello");
    usePaletteStore.getState().pushStep({
      kind: "input", title: "Create", placeholder: "name",
      onSubmit: () => {},
    });
    expect(usePaletteStore.getState().query).toBe("");
  });
});
