import { describe, it, expect } from "vitest";
import { buildRebasePlan } from "./buildRebasePlan";
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
const ROOT = "r".repeat(40);

/** Newest-first, as the log returns it. */
const log: CommitInfo[] = [
  mk(M, "Merge branch 'feature'", [C, F]),
  mk(C, "C on main", [A]),
  mk(F, "F on feature", [A]),
  mk(A, "A on main", [ROOT]),
  mk(ROOT, "root", []),
];

describe("buildRebasePlan with merges in range", () => {
  it("defaults a merge commit to Drop and keeps everything else a Pick", () => {
    const plan = buildRebasePlan(log, A, { kind: "edit-from" });
    expect(plan).not.toBeNull();
    expect(plan!.map((s) => [s.oid, s.action])).toEqual([
      [F, "Pick"],
      [C, "Pick"],
      [M, "Drop"],
    ]);
  });

  it("a merge is dropped even when it is the fixup target", () => {
    // Nothing in the UI offers this, but a plan is a plan — the backend rejects
    // Fixup on a merge, so the builder must not produce it.
    const plan = buildRebasePlan(log, A, { kind: "fixup", targetOid: M });
    expect(plan!.find((s) => s.oid === M)!.action).toBe("Drop");
  });

  it("leaves a merge-free range untouched", () => {
    const linear = [mk(C, "C", [A]), mk(A, "A", [ROOT]), mk(ROOT, "root", [])];
    const plan = buildRebasePlan(linear, A, { kind: "edit-from" });
    expect(plan!.map((s) => s.action)).toEqual(["Pick"]);
  });
});
