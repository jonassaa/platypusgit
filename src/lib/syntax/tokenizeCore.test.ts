// The packed representation tokens cross the worker boundary in.
//
// Returning SyntaxLine[] directly would structured-clone hundreds of thousands
// of small objects for a large file, moving the cost onto the main thread instead
// of removing it. These tests pin that packing is lossless.
import { describe, expect, it } from "vitest";
import { packLines, unpackLines } from "./tokenizeCore";
import type { SyntaxLine } from "./tokenizeCore";

const lines: SyntaxLine[] = [
  [
    { start: 0, end: 5, cls: "syn-keyword" },
    { start: 6, end: 7, cls: "syn-ident" },
  ],
  [],
  [{ start: 0, end: 3, cls: "syn-keyword" }],
];

describe("packed syntax transfer", () => {
  it("round-trips tokens through the flat arrays", () => {
    expect(unpackLines(packLines(lines))).toEqual(lines);
  });

  it("dedupes class names into a table so the payload stays small", () => {
    const p = packLines(lines);
    expect(p.classes).toEqual(["syn-keyword", "syn-ident"]);
    expect(p.data).toBeInstanceOf(Int32Array);
    expect(p.lineStarts).toBeInstanceOf(Int32Array);
    // 3 tokens total across 3 lines.
    expect(p.data).toHaveLength(3 * 3);
    expect(p.lineStarts).toHaveLength(lines.length + 1);
  });

  it("preserves empty lines rather than collapsing them", () => {
    expect(unpackLines(packLines([[], [], []]))).toEqual([[], [], []]);
  });

  it("round-trips an empty file", () => {
    expect(unpackLines(packLines([]))).toEqual([]);
  });
});
