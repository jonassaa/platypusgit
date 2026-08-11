import { describe, expect, it } from "vitest";
import type { CommitInfo } from "@/lib/types";
import { createAncestryResolver } from "./graphAncestry";

/** Fake CommitInfo — only `oid` and `parents` are semantically used here. */
function c(oid: string, parents: string[] = []): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary: oid,
    body: null,
    author: "t",
    email: "t@t",
    timestamp: 0,
    parents,
    refs: [],
  };
}

describe("createAncestryResolver", () => {
  it("keeps a visible parent as a direct, non-elided link", () => {
    const all = [c("A", ["B"]), c("B", [])];
    const r = createAncestryResolver(all, all);
    expect(r.resolve("A")).toEqual([{ oid: "B", elided: false }]);
  });

  it("rewrites a filtered-out parent onto the nearest visible ancestor", () => {
    // Full history A → B → C; only A and C survive the filter.
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"]), c("C", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "C", elided: true }]);
  });

  it("spans a long elided run", () => {
    // A → M0 → … → M11 → Z, with only A and Z visible (the 12-elided case
    // drawn in the issue).
    const mid = Array.from({ length: 12 }, (_, i) => `M${i}`);
    const all: CommitInfo[] = [
      c("A", ["M0"]),
      ...mid.map((m, i) => c(m, [i === mid.length - 1 ? "Z" : `M${i + 1}`])),
      c("Z", []),
    ];
    const visible = [c("A", ["M0"]), c("Z", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "Z", elided: true }]);
  });

  it("reports no link when no ancestor is visible (truncated)", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([]);
  });

  it("reports no link for a true root, and no true parents either", () => {
    const all = [c("R", [])];
    const r = createAncestryResolver(all, all);
    expect(r.resolve("R")).toEqual([]);
    expect(r.trueParents("R")).toEqual([]);
  });

  it("rewrites BOTH sides of a merge whose parents are filtered out", () => {
    // M merges T and F; T → TT, F → FF; only M, TT, FF visible.
    const all = [
      c("M", ["T", "F"]),
      c("T", ["TT"]),
      c("F", ["FF"]),
      c("TT", []),
      c("FF", []),
    ];
    const visible = [c("M", ["T", "F"]), c("TT", []), c("FF", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("M")).toEqual([
      { oid: "TT", elided: true },
      { oid: "FF", elided: true },
    ]);
  });

  it("dedupes when both parents rewrite to the same ancestor", () => {
    // M merges T and F, both children of one visible ancestor P.
    const all = [c("M", ["T", "F"]), c("T", ["P"]), c("F", ["P"]), c("P", [])];
    const visible = [c("M", ["T", "F"]), c("P", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("M")).toEqual([{ oid: "P", elided: true }]);
    // The commit is still a merge — node shape reads trueParents, not resolve.
    expect(r.trueParents("M")).toEqual(["T", "F"]);
  });

  it("prefers the nearer ancestor when two are reachable", () => {
    // A → B → V2 → V1, V1 and V2 both visible. B is filtered out.
    const all = [c("A", ["B"]), c("B", ["V2"]), c("V2", ["V1"]), c("V1", [])];
    const visible = [c("A", ["B"]), c("V2", ["V1"]), c("V1", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "V2", elided: true }]);
  });

  it("falls back to the visible commits' own parents when ancestry is omitted", () => {
    const visible = [c("A", ["B"]), c("B", [])];
    const r = createAncestryResolver(visible);
    expect(r.resolve("A")).toEqual([{ oid: "B", elided: false }]);
    expect(r.trueParents("A")).toEqual(["B"]);
  });

  it("treats an oid outside the loaded window as a dead end", () => {
    // A's parent B is not in the window at all — no entry in the map.
    const visible = [c("A", ["B"])];
    const r = createAncestryResolver(visible, visible);
    expect(r.resolve("A")).toEqual([]);
  });

  it("terminates on a cyclic map instead of hanging", () => {
    // Malformed input: X and Y each claim the other as parent. Real git has no
    // cycles, but the resolver must not spin on bad data.
    const all = [c("A", ["X"]), c("X", ["Y"]), c("Y", ["X"])];
    const visible = [c("A", ["X"])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([]);
  });

  it("returns a stable memoized result for repeated queries", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"]), c("C", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toBe(r.resolve("A"));
  });
});
