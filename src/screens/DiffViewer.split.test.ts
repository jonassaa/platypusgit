// Split-view column alignment (and the word spans it enables).
//
// The old diffToSplit emitted each line as it came, padding whichever side was
// missing — so a hunk that mixed removals and additions drifted the two columns
// apart. Pairing runs fixes that AND is the precondition for intra-line diff,
// which needs to know which removal goes with which addition.
import { describe, expect, it } from "vitest";
import { diffToSplit } from "./DiffViewer";
import type { FileDiff } from "@/lib/types";

type Line = FileDiff["hunks"][number]["lines"][number];

const rem = (n: number, content: string): Line => ({
  kind: { kind: "Deletion" }, oldLineno: n, newLineno: null, content,
});
const add = (n: number, content: string): Line => ({
  kind: { kind: "Addition" }, oldLineno: null, newLineno: n, content,
});
const ctx = (n: number, content: string): Line => ({
  kind: { kind: "Context" }, oldLineno: n, newLineno: n, content,
});

const diff = (lines: Line[]): FileDiff => ({
  path: "a.ts",
  oldPath: null,
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [
    { header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines },
  ],
});

describe("diffToSplit", () => {
  it("puts a removal and its matching addition on the SAME row", () => {
    const { left, right } = diffToSplit(diff([rem(1, "let a"), add(1, "let b")]));
    // index 0 is the hunk header row on both sides
    expect(left[1]).toMatchObject({ kind: "rem", text: "let a" });
    expect(right[1]).toMatchObject({ kind: "add", text: "let b" });
    expect(left).toHaveLength(right.length);
  });

  it("pads the shorter side when the runs are uneven", () => {
    const { left, right } = diffToSplit(diff([rem(1, "a"), rem(2, "b"), add(1, "a2")]));
    expect(left).toHaveLength(right.length);
    expect(right[2]).toMatchObject({ kind: "empty" });
  });

  it("attaches word spans to paired rows", () => {
    const { left, right } = diffToSplit(diff([rem(1, "let a = 1"), add(1, "let a = 2")]));
    expect(left[1].spans?.some((s) => s.changed)).toBe(true);
    expect(right[1].spans?.some((s) => s.changed)).toBe(true);
  });

  it("keeps context rows aligned on both sides", () => {
    const { left, right } = diffToSplit(diff([ctx(1, "same"), rem(2, "x"), add(2, "y")]));
    expect(left[1]).toMatchObject({ kind: "ctx", text: "same" });
    expect(right[1]).toMatchObject({ kind: "ctx", text: "same" });
    expect(left).toHaveLength(right.length);
  });

  it("keeps the columns aligned across a mixed hunk, the case that used to drift", () => {
    const { left, right } = diffToSplit(
      diff([
        ctx(1, "keep"),
        rem(2, "gone"),
        add(2, "new1"),
        add(3, "new2"),
        ctx(4, "tail"),
      ]),
    );
    expect(left).toHaveLength(right.length);
    // Both columns must end on the same context line, at the same index.
    const lastLeft = left.length - 1;
    expect(left[lastLeft]).toMatchObject({ kind: "ctx", text: "tail" });
    expect(right[lastLeft]).toMatchObject({ kind: "ctx", text: "tail" });
  });

  it("returns empty columns for no diff", () => {
    expect(diffToSplit(null)).toEqual({ left: [], right: [] });
  });
});
