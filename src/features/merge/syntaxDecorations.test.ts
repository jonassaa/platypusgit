import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { buildSyntaxDecorations } from "./syntaxDecorations";

function ranges(set: DecorationSet) {
  const out: Array<{ from: number; to: number }> = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({ from: iter.from, to: iter.to });
    iter.next();
  }
  return out;
}

describe("buildSyntaxDecorations", () => {
  it("maps line-relative tokens onto absolute document ranges", () => {
    const state = EditorState.create({ doc: "let a\nlet b" });
    const set = buildSyntaxDecorations(state, [
      [{ start: 0, end: 3, cls: "syn-keyword" }],
      [{ start: 4, end: 5, cls: "syn-var" }],
    ]);
    // Second line starts at offset 6, so its 4-5 becomes 10-11.
    expect(ranges(set)).toEqual([
      { from: 0, to: 3 },
      { from: 10, to: 11 },
    ]);
  });

  it("clamps a token that overruns its line instead of bleeding into the next", () => {
    const state = EditorState.create({ doc: "ab\ncd" });
    const set = buildSyntaxDecorations(state, [[{ start: 0, end: 99, cls: "syn-type" }]]);
    expect(ranges(set)).toEqual([{ from: 0, to: 2 }]);
  });

  it("ignores token lines beyond the document", () => {
    const state = EditorState.create({ doc: "ab" });
    const set = buildSyntaxDecorations(state, [
      [{ start: 0, end: 1, cls: "syn-var" }],
      [{ start: 0, end: 1, cls: "syn-var" }],
    ]);
    expect(ranges(set)).toHaveLength(1);
  });

  it("drops zero-width tokens, which CodeMirror rejects as mark ranges", () => {
    const state = EditorState.create({ doc: "ab" });
    const set = buildSyntaxDecorations(state, [[{ start: 1, end: 1, cls: "syn-var" }]]);
    expect(ranges(set)).toHaveLength(0);
  });

  it("returns an empty set for no tokens", () => {
    const state = EditorState.create({ doc: "ab" });
    expect(ranges(buildSyntaxDecorations(state, []))).toHaveLength(0);
  });
});
