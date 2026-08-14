import { describe, it, expect } from "vitest";
import { buildPreservePlan } from "./buildPreservePlan";
import type { CommitInfo } from "@/lib/types";

function mk(oid: string, summary: string, parents: string[]): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "t@e.com",
    timestamp: 0,
    parents,
    refs: [],
  };
}

const M = "m".repeat(40);
const C = "c".repeat(40);
const F = "f".repeat(40);
const A = "a".repeat(40);
const BASE = "0".repeat(40);

/** root..M, newest-first — the shape `commitsSince` returns. */
const range: CommitInfo[] = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", [BASE]),
];

describe("buildPreservePlan", () => {
  it("emits oldest-first steps that name their own base where it differs", () => {
    const plan = buildPreservePlan(range);
    expect(plan.map((s) => s.oid)).toEqual([A, F, C, M]);

    // A: its parent is below the range → linear default.
    expect(plan[0]).toMatchObject({ action: "Pick", onto: null, mergeParents: [] });
    // F: parent A is the previous step's result → linear default.
    expect(plan[1]).toMatchObject({ action: "Pick", onto: null });
    // C: parent A is NOT the previous step (F was) → must name it.
    expect(plan[2]).toMatchObject({ action: "Pick", onto: A });
    // M: first parent C is the previous step; the other parent is carried.
    expect(plan[3]).toMatchObject({ action: "Merge", onto: null, mergeParents: [F] });
  });

  it("leaves a linear range with no onto at all", () => {
    const linear = [mk(C, "C", [A]), mk(A, "A", [BASE])];
    const plan = buildPreservePlan(linear);
    expect(plan.map((s) => s.onto)).toEqual([null, null]);
    expect(plan.every((s) => s.action === "Pick")).toBe(true);
  });

  it("carries an out-of-range merge parent through unchanged", () => {
    // A parent that lives below the range was never rewritten; the engine falls
    // back to its original oid, so the plan just passes it along.
    const outside = "9".repeat(40);
    const withOutside = [mk(M, "Merge external", [C, outside]), mk(C, "C", [A])];
    const plan = buildPreservePlan(withOutside);
    const merge = plan.find((s) => s.oid === M)!;
    expect(merge.action).toBe("Merge");
    expect(merge.mergeParents).toEqual([outside]);
  });
});
