import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { buildMergeModel } from "./mergeModel";
import { createResultEditor, type EditorHandle } from "./resultEditor";
import type { ConflictSides } from "@/lib/types";

function makeEditor(base: string, ours: string, theirs: string) {
  const sides: ConflictSides = { path: "f.txt", base, ours, theirs, binary: false };
  const model = buildMergeModel(sides)!;
  const onChange = vi.fn();
  const handle = createResultEditor({
    model,
    parent: document.createElement("div"),
    onChange,
  });
  return { model, handle, onChange };
}

let h: EditorHandle | null = null;
afterEach(() => {
  h?.destroy();
  h = null;
});

describe("createResultEditor", () => {
  it("seeds doc with initialResult and one unresolved region", () => {
    const { model, handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    expect(handle.view.state.doc.toString()).toBe(model.initialResult);
    expect(handle.regions()).toEqual([
      { id: 0, from: 0, to: 4, resolution: null },
    ]);
  });

  it("accept('ours') replaces region text and marks it resolved", () => {
    const { handle, onChange } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "ours");
    expect(handle.view.state.doc.toString()).toBe("ours change");
    expect(handle.regions()[0]).toMatchObject({ resolution: "ours", from: 0, to: 11 });
    expect(onChange).toHaveBeenCalled();
  });

  it("accept('both') concatenates ours then theirs", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "both");
    expect(handle.view.state.doc.toString()).toBe("ours change\ntheirs change");
    expect(handle.regions()[0].resolution).toBe("both");
  });

  it("hand-editing inside an unresolved region marks it manual", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    // Simulate a user edit (no programmaticAccept annotation).
    handle.view.dispatch({ changes: { from: 0, to: 4, insert: "hand" } });
    expect(handle.regions()[0].resolution).toBe("manual");
  });

  it("editing OUTSIDE regions does not resolve anything but maps offsets", () => {
    const base = "one\ntwo\nthree\n";
    const ours = "one\ntwo-ours\nthree\n";
    const theirs = "one\ntwo-theirs\nthree\n";
    const { handle } = makeEditor(base, ours, theirs);
    h = handle;
    const before = handle.regions()[0];
    // Insert at doc start (before the conflict region).
    handle.view.dispatch({ changes: { from: 0, to: 0, insert: "// header\n" } });
    const after = handle.regions()[0];
    expect(after.resolution).toBeNull();
    expect(after.from).toBe(before.from + "// header\n".length);
  });

  it("undo after accept restores text AND unresolved status", () => {
    const { handle } = makeEditor("base\n", "ours change\n", "theirs change\n");
    h = handle;
    handle.accept(0, "theirs");
    expect(handle.regions()[0].resolution).toBe("theirs");
    undo(handle.view); // add `import { undo } from "@codemirror/commands"` at top
    expect(handle.view.state.doc.toString()).toBe("base");
    expect(handle.regions()[0].resolution).toBeNull();
  });

  it("empty-base region accept inserts whole lines with separators", () => {
    const { handle } = makeEditor("", "mine\n", "yours\n");
    h = handle;
    handle.accept(0, "both");
    expect(handle.view.state.doc.toString()).toBe("mine\nyours");
    expect(handle.regions()[0].resolution).toBe("both");
  });

  it("re-accepting a both-added conflict keeps its line separators (no fusing)", () => {
    // A both-added conflict (empty base) sitting BETWEEN stable lines: the
    // placeholder is zero-length, so the first accept pads separators. A
    // second accept must replace only the content, not eat the separators.
    const { handle } = makeEditor("a\nb\n", "a\nMINE\nb\n", "a\nYOURS\nb\n");
    h = handle;
    handle.accept(0, "ours");
    expect(handle.view.state.doc.toString()).toBe("a\nMINE\nb");
    handle.accept(0, "theirs"); // re-accept: must NOT produce "a\nYOURSb"
    expect(handle.view.state.doc.toString()).toBe("a\nYOURS\nb");
    expect(handle.regions()[0].resolution).toBe("theirs");
  });
});
