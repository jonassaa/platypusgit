import { describe, expect, it } from "vitest";
import { buildMergeModel, resolutionLines, splitLines } from "./mergeModel";
import type { ConflictSides } from "@/lib/types";

function sides(base: string | null, ours: string | null, theirs: string | null): ConflictSides {
  return { path: "f.txt", base, ours, theirs, binary: false };
}

describe("splitLines", () => {
  it("drops the trailing empty segment of newline-terminated text", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });
  it("keeps a non-terminated last line", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });
  it("empty text has no lines", () => {
    expect(splitLines("")).toEqual([]);
  });
  it("strips a trailing CR so CRLF lines carry no \\r", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
  });
});

describe("buildMergeModel", () => {
  it("returns null for binary and deleted-side conflicts", () => {
    expect(buildMergeModel({ ...sides("b\n", "o\n", "t\n"), binary: true })).toBeNull();
    expect(buildMergeModel(sides("b\n", null, "t\n"))).toBeNull();
    expect(buildMergeModel(sides("b\n", "o\n", null))).toBeNull();
  });

  it("single conflicting line: one conflict region, base as placeholder", () => {
    const m = buildMergeModel(sides("base\n", "ours change\n", "theirs change\n"))!;
    expect(m.conflicts).toHaveLength(1);
    const c = m.conflicts[0];
    expect(c.ours.lines).toEqual(["ours change"]);
    expect(c.base.lines).toEqual(["base"]);
    expect(c.theirs.lines).toEqual(["theirs change"]);
    expect(m.initialResult).toBe("base");
    expect(m.resultRegions).toEqual([{ id: 0, from: 0, to: 4 }]);
    expect(m.trailingNewline).toBe(true);
  });

  it("auto-applies non-conflicting changes around a conflict", () => {
    // Changed lines must be separated by untouched lines — diff3 merges
    // ADJACENT change hunks into a single region. Here: ours edits line 0,
    // theirs edits line 4 (both non-conflicting), both edit line 2 (conflict);
    // lines 1 and 3 are untouched separators.
    const base = "one\ntwo\nthree\nfour\nfive\n";
    const ours = "ONE\ntwo\nC-ours\nfour\nfive\n";
    const theirs = "one\ntwo\nC-theirs\nfour\nFIVE\n";
    const m = buildMergeModel(sides(base, ours, theirs))!;
    expect(m.conflicts).toHaveLength(1);
    // Non-conflicting edits from BOTH sides land in the initial result;
    // the conflict placeholder is the base line "three".
    expect(m.initialResult.split("\n")).toEqual(["ONE", "two", "three", "four", "FIVE"]);
    const r = m.resultRegions[0];
    expect(m.initialResult.slice(r.from, r.to)).toBe("three");
    // Side line ranges point into the full side files.
    expect(m.conflicts[0].ours).toEqual({ start: 2, lines: ["C-ours"] });
    expect(m.conflicts[0].theirs).toEqual({ start: 2, lines: ["C-theirs"] });
  });

  it("both-added conflict (no base) yields an empty placeholder region", () => {
    const m = buildMergeModel(sides(null, "mine\n", "yours\n"))!;
    expect(m.conflicts).toHaveLength(1);
    expect(m.conflicts[0].base.lines).toEqual([]);
    const r = m.resultRegions[0];
    expect(r.from).toBe(r.to);
    expect(m.initialResult).toBe("");
  });

  it("identical non-conflicting texts produce zero conflicts", () => {
    const m = buildMergeModel(sides("a\nb\n", "a\nb\n", "a\nb\n"))!;
    expect(m.conflicts).toHaveLength(0);
    expect(m.initialResult).toBe("a\nb");
  });

  it("detects LF eol on newline-normalized fixtures", () => {
    const m = buildMergeModel(sides("base\n", "ours\n", "theirs\n"))!;
    expect(m.eol).toBe("\n");
  });

  it("CRLF sides: eol \\r\\n, no \\r in result, offsets valid for a multi-line conflict", () => {
    // Both sides replace the SAME two base lines differently → one multi-line
    // conflict region (base placeholder spans 2 lines). Pre-fix, splitLines
    // kept the \r on each line so offsets counted stripped chars and the
    // region `to` overran CM's normalized doc.
    const base = "a\r\nb\r\nc\r\nd\r\n";
    const ours = "a\r\nB1\r\nB2\r\nd\r\n";
    const theirs = "a\r\nX1\r\nX2\r\nd\r\n";
    const m = buildMergeModel(sides(base, ours, theirs))!;
    expect(m.eol).toBe("\r\n");
    // Model works in LF space — CM strips \r on load, so must the model.
    expect(m.initialResult).not.toContain("\r");
    expect(m.conflicts).toHaveLength(1);
    expect(m.conflicts[0].base.lines).toEqual(["b", "c"]);
    const r = m.resultRegions[0];
    // Offsets are valid against the LF-normalized initialResult (no overrun).
    expect(r.to).toBeLessThanOrEqual(m.initialResult.length);
    expect(m.initialResult.slice(r.from, r.to)).toBe("b\nc");
    expect(r.to - r.from).toBe("b\nc".length);
    expect(m.trailingNewline).toBe(true);
  });

  it("multiple conflicts keep document order and distinct offsets", () => {
    const base = "h1\nx\nmid\ny\nt1\n";
    const ours = "h1\nx-ours\nmid\ny-ours\nt1\n";
    const theirs = "h1\nx-theirs\nmid\ny-theirs\nt1\n";
    const m = buildMergeModel(sides(base, ours, theirs))!;
    expect(m.conflicts.map((c) => c.id)).toEqual([0, 1]);
    const [r0, r1] = m.resultRegions;
    expect(r0.to).toBeLessThanOrEqual(r1.from);
    expect(m.initialResult.slice(r0.from, r0.to)).toBe("x");
    expect(m.initialResult.slice(r1.from, r1.to)).toBe("y");
  });
});

describe("resolutionLines", () => {
  const c = {
    id: 0,
    ours: { start: 0, lines: ["O1", "O2"] },
    base: { start: 0, lines: ["B"] },
    theirs: { start: 0, lines: ["T"] },
  };
  it("ours / theirs / both", () => {
    expect(resolutionLines(c, "ours")).toEqual(["O1", "O2"]);
    expect(resolutionLines(c, "theirs")).toEqual(["T"]);
    expect(resolutionLines(c, "both")).toEqual(["O1", "O2", "T"]);
  });
});
